# Behavioral emulation — research and architecture

Investigates whether Goblin should offer human-like mouse movement and
typing patterns as an automation feature, to help defeat behavioral
detectors (DataDome, PerimeterX, Cloudflare Turnstile) that analyze *how*
a page is interacted with, not just the browser's fingerprint. This is a
different detection layer entirely from everything in
`docs/FINGERPRINT_AUDIT.md`: fingerprinting reads static/semi-static
properties of the browser (navigator fields, canvas, TLS handshake);
behavioral detection reads a time series of real input events during a
live session.

## Part 1 — what behavioral detectors actually check

Based on how these systems are publicly documented to work and how
automation frameworks are known to get flagged (this section is
literature/architecture research, not a from-scratch capture the way
`FINGERPRINT_AUDIT.md`'s findings are — no code has been written or
measured yet at this stage):

### Mouse movement

- **Trajectory shape.** A real hand-driven cursor traces a curve, not a
  straight line — the path between two points has some lateral deviation,
  usually approximable as a low-order Bezier curve. A perfectly straight
  line (or, worse, a single teleport) between click targets is one of the
  cheapest signals to check and one of the most common automation tells.
- **Velocity profile.** Real movement accelerates away from the start
  point and decelerates approaching the target (an "ease-in-ease-out"
  profile), rather than moving at constant pixel-per-frame speed.
  Constant-velocity movement is itself a signal, independent of the path
  shape.
- **Micro-jitter.** Human hands aren't perfectly steady — small,
  high-frequency deviations (a pixel or few) ride on top of the intended
  path. A mathematically clean curve with zero noise is unusual.
- **Overshoot and correction.** People frequently move slightly past the
  target and correct back onto it, especially at higher speed — a small
  reversal near the endpoint, not a monotonic approach.
- **Event density.** Real mouse movement generates many intermediate
  `mousemove` events (the OS reports pointer position continuously); a
  script that fires only a single move-then-click with no intermediate
  events at all is a strong signal on its own, separate from path shape.

### Typing

- **Inter-keystroke timing.** Real typing has variable delays between
  keydown events, not a fixed interval — commonly modeled as roughly
  normally distributed around a mean that reflects typing speed, not
  uniform.
- **Speed variation over the session.** Typing speed isn't constant
  within one string either — short common sequences are typed faster than
  awkward ones, and there's often a brief slow-down after a pause.
- **Occasional real mistakes.** A wrong key hit followed by backspace and
  correction is a human pattern; flawless, instant, uniformly-paced text
  entry is not something a real keyboard user produces at any real speed.
- **Event completeness.** A real keystroke is a `keydown`/`keypress`(where
  applicable)/`keyup` sequence with real timing between them, not a single
  synthetic "set the value" DOM mutation — the latter is trivially
  distinguishable and is exactly what naive automation (`element.value =
  ...`) produces.

### Scroll

- **Non-uniform speed.** Real scrolling (wheel or trackpad) moves in
  bursts with pauses, not a constant per-frame delta.
- **Overscroll/settle.** Momentum-based scrolling (trackpads, and some
  wheel implementations) overshoots slightly and settles, similar in
  spirit to mouse overshoot.

## Part 2 — architecture: where this logic should live

**This is deliberately not passive spoofing.** Every existing
Goblin capability (`docs/FINGERPRINT_AUDIT.md`'s whole scope) makes a
profile's *static* browser identity look like a real installation,
applied automatically and uniformly to every session regardless of who's
using it. Behavioral emulation is categorically different: it's a stream
of synthetic *input events*, meaningful only when something other than a
real human hand is producing input in the first place. A person manually
clicking around a profile in the GoblinAnty window already produces real,
naturally human mouse/keyboard behavior — layering synthetic "human-like"
movement on top of their actual movement would be pointless at best and
could visibly interfere with real interaction at worst. This capability
only has a use case when something automated is driving the page, i.e.
exactly the profiles that already have the CDP automation feature
(`automationProxy.ts`, README's "Automation" section) turned on.

### The proxy is a deliberate raw pipe — and that constrains the design

`automationProxy.ts`'s own module comment is explicit about this, and it
matters directly here:

> The WebSocket upgrade itself is proxied as a raw byte pipe once
> authenticated — CDP's own WebSocket framing is never parsed or
> reinterpreted, only forwarded, so this proxy can't itself become a
> source of CDP-protocol bugs.

That "never parsed" property is not an accident; it's the reason this
proxy is simple enough to reason about as a security boundary at all — a
token-gated pipe that forwards bytes has a small, auditable surface, and
anything wrong with it is a transport bug, never a CDP-semantics bug.

The option this document's request framed as (a) — teaching
`automationProxy.ts` to recognize new synthetic commands like
`"human-like click at X,Y"` inline in the CDP stream — would require this
proxy to start parsing and interpreting every WebSocket frame in both
directions to detect and intercept those custom commands, directly
undoing that property. It would turn a small, auditable byte-forwarder
into a CDP-protocol-aware component that has to correctly handle framing,
partial frames, binary vs. text messages, and the full CDP command/event
lifecycle — a large increase in attack surface and bug surface for a
component whose entire value today is being too simple to get wrong.
**Rejected for this reason, not because it's infeasible.**

### The chosen design: a client-side helper library over the existing CDP session

The alternative — and what this project implements — needs no changes to
`automationProxy.ts` at all. Anyone driving a profile over its existing
CDP endpoint (Puppeteer, Playwright, or a raw CDP client, per the README's
own "Connecting with Puppeteer/Playwright" examples) already has a real
CDP session capable of sending `Input.dispatchMouseEvent` and
`Input.dispatchKeyEvent` commands directly — that's the actual mechanism
both Puppeteer's and Playwright's own `.click()`/`.type()` helpers already
use under the hood, just with linear/instant timing. Human-like movement
is a matter of *how many* dispatch calls are sent and *with what timing*,
not a new protocol surface:

- A new module, `src/shared/automation/humanInput.ts`, exports pure
  functions that compute the actual sequence of points/timings a human-like
  interaction should send:
  - `buildHumanMousePath(from, to, options)` → an ordered array of
    `{x, y, delayMs}` points along a cubic Bezier curve with jitter and an
    eased velocity profile (Part 3).
  - `buildHumanTypingPlan(text, options)` → an ordered array of
    `{key, delayMs}` keystroke events with Gaussian-distributed timing
    (Part 4).
  - Both are pure data-generation functions — no CDP calls inside them —
    specifically so their math is unit-testable in complete isolation
    (no Electron, no real browser, no mocked WebSocket) the same way
    `profileWindowLogic.ts`'s extraction was justified earlier in this
    project's history.
- A thin driver, `src/main/browser/humanInputDriver.ts`, consumes those
  plans and actually calls `Input.dispatchMouseEvent`/
  `Input.dispatchKeyEvent` in sequence with real `await sleep(delayMs)`
  waits between them, over a CDP session it opens itself. This is the one
  piece that needs a real CDP connection, kept deliberately thin (sequence
  the dispatch calls, nothing else) so the interesting logic — the curve
  and timing math — stays in the pure, fully-tested module above it.
- Exposed as two new automation-facing entry points,
  `humanClick(x, y, options)` and `humanType(selector, text, options)`,
  connecting to the profile's own CDP endpoint (the same one
  `automationProxy.ts` already fronts) the same way an external Puppeteer
  script would, and documented in README's Automation section as
  higher-level helpers built on top of the existing raw-CDP connection —
  not a new server-side capability, a client-side convenience layer any
  automation script can use (and, per Part 5, one this project ships
  as a small helper so users don't have to reimplement the curve/timing
  math themselves).

**The trade-off, stated plainly:** this design adds zero new attack
surface to the always-on parts of the app (`automationProxy.ts` is
untouched) at the cost of the human-like behavior only being available to
whatever already holds a CDP session — which is exactly right, since that
is also exactly the set of things that could plausibly need it (nothing
about a real human's own mouse in the GoblinAnty UI goes through this path
at all). No compromise was made on the "raw pipe" security property to
get here.

## Part 3 — mouse movement generation (implementation notes)

- **Curve**: a cubic Bezier with 2 control points, placed off the
  straight line between `from` and `to` by a randomized perpendicular
  offset (proportional to the distance, capped) — this is what produces a
  visible, natural-looking arc rather than a straight segment.
- **Jitter**: after computing each point on the curve, add a small random
  offset (a few pixels, configurable) independently per point — high
  enough frequency relative to the curve's own scale that it reads as
  hand tremor, not as a second, larger curve.
- **Velocity/easing**: points along the curve are NOT evenly spaced in
  time — an ease-in-ease-out function (e.g. cubic ease) maps a uniform
  `t ∈ [0,1]` parameter to a non-uniform time delta between points, so
  motion is slower near both endpoints and faster in the middle.
- **Overshoot**: optionally, the generated path target is placed a few
  pixels past the real destination, with 1-2 extra correction points
  added afterward that move back onto the real target — modeling the
  "reach past and correct" pattern.
- **Dispatch**: each point becomes one real `Input.dispatchMouseEvent`
  (`type: 'mouseMoved'`) call, with a real `await sleep()` for that
  point's delay before the next — followed by real `mousePressed`/
  `mouseReleased` events at the final position for the actual click, not
  a single synthetic click at the destination with no preceding movement.

## Part 4 — typing generation (implementation notes)

- **Per-keystroke delay**: sampled from a Gaussian distribution centered
  on a configurable mean (derived from a "typing speed" setting) with a
  configurable standard deviation — clamped to a sane minimum so an
  unlucky sample never produces a negative or zero delay.
- **Mistake injection (opt-in, default off)**: with a small configurable
  probability per character, first dispatch a plausible wrong key (e.g. a
  QWERTY-adjacent key to the intended one), followed by a `Backspace` and
  then the correct key — each with its own realistic delay. Off by
  default specifically because adjacency-mapping and "what counts as a
  plausible mistake" adds real complexity for a secondary behavior, per
  this document's own request.
- **Dispatch**: each character becomes a real `keyDown` + `keyUp` CDP
  event pair (with `text`/`key`/`code` fields set correctly for the
  character), not a single value-mutation — this is the property that
  actually distinguishes it from naive automation (Part 1's "event
  completeness" point).

## Part 5 — verification: what could and couldn't be checked

`docs/FINGERPRINT_AUDIT.md`'s established standard is real captures only
— no claim without a live test proving it. That standard is only
partially achievable here, and this section says plainly which parts:

- **What CAN be verified directly, and will be, once implemented**: that
  `buildHumanMousePath()`'s output actually forms a curve through the
  given control points (not a straight line), that consecutive points
  don't exceed a physically-plausible per-step distance, and that the
  velocity profile is non-uniform (a statistical check on the generated
  deltas) — all pure math, checkable in a unit test with zero browser
  involvement. Same for `buildHumanTypingPlan()`'s delay distribution
  (mean/variance land where configured, not literally constant). An E2E
  test can additionally confirm, against a real running profile, that
  `humanClick`/`humanType` genuinely dispatch multiple intermediate CDP
  events over real wall-clock time rather than one instant action — that
  the *mechanism* fires the way it claims to.
- **What CANNOT be verified directly in this environment, stated
  honestly rather than glossed over**: whether this measurably changes a
  real detector's (DataDome/PerimeterX/Turnstile's) actual bot score.
  Those are closed, commercial, frequently-updated systems with no public
  test endpoint that returns a bot-confidence score the way
  `tls.peet.ws` or CreepJS return a raw fingerprint for the fingerprint
  work — there is no equivalent "make a real request and read back an
  honest number" step available here. Any claim about real-world
  effectiveness against a specific named vendor would be asserting
  something this project has no way to actually check, which is exactly
  the kind of unverified claim `FINGERPRINT_AUDIT.md`'s own methodology
  exists to rule out. This stays an open, acknowledged limitation of this
  feature rather than a claim of any kind about real detector outcomes.
