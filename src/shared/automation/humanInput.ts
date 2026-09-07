/**
 * Pure data-generation for human-like mouse/keyboard input, deliberately
 * containing zero CDP calls — see docs/BEHAVIORAL_EMULATION.md's Part 2 for
 * why this lives here rather than inside automationProxy.ts (a raw byte
 * pipe by design) or a driver module. Every function here just computes
 * *what* to send and *when*; `humanInputDriver.ts` is the thin layer that
 * actually dispatches it over a real CDP session.
 */

export interface Point {
  x: number;
  y: number;
}

export interface MousePathPoint extends Point {
  /** Milliseconds to wait after the previous point before dispatching this
   * one. Always 0 for the first point (dispatch immediately). */
  delayMs: number;
}

export interface HumanMousePathOptions {
  /** Number of intermediate points along the curve. Defaults to a value
   * proportional to distance (longer moves get more points), clamped to
   * [MIN_STEPS, MAX_STEPS] either way. */
  steps?: number;
  /** Total wall-clock time the movement should take, spread evenly across
   * `steps` (see the module comment on why per-step delay is uniform while
   * the eased *curve* parameter is what actually varies the visible
   * speed). Defaults to a value proportional to distance, clamped to
   * [MIN_DURATION_MS, MAX_DURATION_MS]. */
  durationMs?: number;
  /** Max random per-point deviation (pixels) added on top of the smooth
   * curve, simulating hand tremor. 0 disables jitter entirely. */
  jitterPx?: number;
  /** How far the curve's two control points are pushed perpendicular to
   * the straight line between `from` and `to`, in pixels — this is what
   * actually bows the path into a visible arc instead of a straight line.
   * Defaults to a value proportional to distance, clamped to
   * [MIN_CURVE_OFFSET_PX, MAX_CURVE_OFFSET_PX]. */
  curveOffsetPx?: number;
  /** When true, the path deliberately passes a few pixels beyond `to` and
   * adds 1-2 correction points moving back onto it — the "reach past and
   * correct" pattern real pointing devices commonly produce. The very
   * last point in the returned array is always exactly `to` regardless of
   * this setting. */
  overshoot?: boolean;
  /** Source of randomness, called with no arguments and expected to
   * return a value in [0, 1) — injectable so tests can assert exact,
   * reproducible output instead of only statistical properties. Defaults
   * to `Math.random`. */
  rng?: () => number;
}

const MIN_STEPS = 8;
const MAX_STEPS = 40;
const MIN_DURATION_MS = 150;
const MAX_DURATION_MS = 900;
const MIN_CURVE_OFFSET_PX = 5;
const MAX_CURVE_OFFSET_PX = 60;
const DEFAULT_JITTER_PX = 1.2;
const OVERSHOOT_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Cubic ease-in-out: slow at both ends, fast through the middle — the
 * same general shape a real hand's velocity profile follows when moving
 * between two points, per docs/BEHAVIORAL_EMULATION.md's Part 3. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Generates the ordered sequence of intermediate mouse positions and
 * per-step delays a human-like move from `from` to `to` should send —
 * intended to become a real `Input.dispatchMouseEvent('mouseMoved', ...)`
 * call per point (see humanInputDriver.ts), not a single instant jump.
 *
 * Guarantees: the first point is always exactly `from` (delayMs: 0) and
 * the last point is always exactly `to`, regardless of jitter/overshoot —
 * jitter and overshoot only affect points strictly between them.
 */
export function buildHumanMousePath(from: Point, to: Point, options: HumanMousePathOptions = {}): MousePathPoint[] {
  const rng = options.rng ?? Math.random;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return [{ x: from.x, y: from.y, delayMs: 0 }];
  }

  const steps = Math.round(options.steps ?? clamp(distance / 8, MIN_STEPS, MAX_STEPS));
  const durationMs = options.durationMs ?? clamp(distance * 2, MIN_DURATION_MS, MAX_DURATION_MS);
  const jitterPx = options.jitterPx ?? DEFAULT_JITTER_PX;
  const curveOffsetPx = options.curveOffsetPx ?? clamp(distance * 0.15, MIN_CURVE_OFFSET_PX, MAX_CURVE_OFFSET_PX);

  // Perpendicular unit vector to the from->to line, used to bow the two
  // control points off the straight path.
  const perpX = -dy / distance;
  const perpY = dx / distance;

  const offset1 = (rng() * 2 - 1) * curveOffsetPx;
  const offset2 = (rng() * 2 - 1) * curveOffsetPx;
  const control1: Point = {
    x: from.x + dx * (1 / 3) + perpX * offset1,
    y: from.y + dy * (1 / 3) + perpY * offset1,
  };
  const control2: Point = {
    x: from.x + dx * (2 / 3) + perpX * offset2,
    y: from.y + dy * (2 / 3) + perpY * offset2,
  };

  const perStepDelay = durationMs / steps;
  const points: MousePathPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = easeInOutCubic(t);
    const base = cubicBezier(from, control1, control2, to, eased);
    const isEndpoint = i === 0 || i === steps;
    const jitterX = isEndpoint || jitterPx === 0 ? 0 : (rng() * 2 - 1) * jitterPx;
    const jitterY = isEndpoint || jitterPx === 0 ? 0 : (rng() * 2 - 1) * jitterPx;
    points.push({
      x: base.x + jitterX,
      y: base.y + jitterY,
      delayMs: i === 0 ? 0 : perStepDelay,
    });
  }

  if (options.overshoot) {
    // Push the real target further out along the direction of travel, use
    // that as the path's second-to-last stop, then correct back onto the
    // exact real target as the true final point.
    const dirX = dx / distance;
    const dirY = dy / distance;
    const overshootPoint: MousePathPoint = {
      x: to.x + dirX * OVERSHOOT_PX,
      y: to.y + dirY * OVERSHOOT_PX,
      delayMs: perStepDelay,
    };
    points[points.length - 1] = overshootPoint;
    points.push({ x: to.x, y: to.y, delayMs: perStepDelay * 0.6 });
  }

  return points;
}

export interface KeystrokeEvent {
  /** The character to type. For a synthetic "wrong key" event (see
   * `mistake` below) this is the wrong character actually pressed, not
   * the intended one. */
  char: string;
  /** Milliseconds to wait after the previous event before dispatching
   * this one. Always 0 for the very first event. */
  delayMs: number;
  /** Present and true only on a deliberately-injected wrong keystroke —
   * absent (not just false) on every normal event, so consumers can use a
   * plain truthiness check. */
  mistake?: true;
  /** Present and true only on the corrective Backspace that follows a
   * mistake — `char` is the literal string `'Backspace'` on this event. */
  backspace?: true;
}

export interface HumanTypingOptions {
  /** Mean delay between keystrokes, in milliseconds — roughly what a
   * "typing speed" setting would control. */
  meanDelayMs?: number;
  /** Standard deviation of that per-keystroke delay — larger values
   * produce more variable, less metronomic timing. */
  stdDevMs?: number;
  /** Hard floor under which a sampled delay is never allowed to fall
   * (a Gaussian sample can otherwise go negative or implausibly small). */
  minDelayMs?: number;
  /** Probability (0-1) that any given lowercase a-z character is preceded
   * by a plausible wrong keystroke + backspace correction. 0 (the
   * default) disables mistake injection entirely — see
   * docs/BEHAVIORAL_EMULATION.md's Part 4 for why this stays opt-in.
   * Only applies to lowercase a-z; every other character always types
   * cleanly regardless of this setting, since a meaningful adjacency map
   * only exists for letters here. */
  mistakeProbability?: number;
  /** Source of randomness, called with no arguments and expected to
   * return a value in [0, 1) — same contract as
   * `HumanMousePathOptions.rng`, injectable for reproducible tests.
   * Defaults to `Math.random`. */
  rng?: () => number;
}

const DEFAULT_MEAN_DELAY_MS = 110;
const DEFAULT_STD_DEV_MS = 40;
const DEFAULT_MIN_DELAY_MS = 25;

/** Adjacent-on-a-real-QWERTY-keyboard letters for the handful of common
 * lowercase keys most likely to be hit by accident — deliberately small
 * and English-QWERTY-specific rather than a full physical keyboard model,
 * matching this feature's own stated scope (a plausible mistake, not a
 * layout simulator). Characters with no entry here never get a synthetic
 * mistake, regardless of `mistakeProbability`. */
const QWERTY_NEIGHBORS: Record<string, string[]> = {
  a: ['s', 'q', 'z'],
  b: ['v', 'n', 'g'],
  c: ['x', 'v', 'd'],
  d: ['s', 'f', 'e'],
  e: ['w', 'r', 'd'],
  f: ['d', 'g', 'r'],
  g: ['f', 'h', 't'],
  h: ['g', 'j', 'y'],
  i: ['u', 'o', 'k'],
  j: ['h', 'k', 'u'],
  k: ['j', 'l', 'i'],
  l: ['k', 'o'],
  m: ['n', 'j'],
  n: ['b', 'm', 'h'],
  o: ['i', 'p', 'l'],
  p: ['o', 'l'],
  q: ['w', 'a'],
  r: ['e', 't', 'f'],
  s: ['a', 'd', 'w'],
  t: ['r', 'y', 'g'],
  u: ['y', 'i', 'j'],
  v: ['c', 'b', 'f'],
  w: ['q', 'e', 's'],
  x: ['z', 'c', 's'],
  y: ['t', 'u', 'h'],
  z: ['a', 'x'],
};

/** Box-Muller transform: turns two uniform [0,1) samples from `rng` into
 * one standard-normal sample, then scales/shifts it to the requested
 * mean/stddev — the standard way to get Gaussian-distributed timing out
 * of a plain uniform random source. */
function sampleGaussian(rng: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), Number.EPSILON); // avoid log(0)
  const u2 = rng();
  const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + standardNormal * stdDev;
}

/**
 * Generates the ordered sequence of keystroke events a human-like typing
 * of `text` should send — intended to become a real `keyDown`+`keyUp` CDP
 * event pair per character (see humanInputDriver.ts), each separated by
 * real wall-clock delay, rather than one instant value mutation.
 */
export function buildHumanTypingPlan(text: string, options: HumanTypingOptions = {}): KeystrokeEvent[] {
  const rng = options.rng ?? Math.random;
  const meanDelayMs = options.meanDelayMs ?? DEFAULT_MEAN_DELAY_MS;
  const stdDevMs = options.stdDevMs ?? DEFAULT_STD_DEV_MS;
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const mistakeProbability = options.mistakeProbability ?? 0;

  function nextDelay(): number {
    return Math.max(minDelayMs, sampleGaussian(rng, meanDelayMs, stdDevMs));
  }

  const events: KeystrokeEvent[] = [];
  for (const char of text) {
    const neighbors = QWERTY_NEIGHBORS[char.toLowerCase()];
    const shouldMistype = mistakeProbability > 0 && neighbors && rng() < mistakeProbability;

    if (shouldMistype && neighbors) {
      const wrongChar = neighbors[Math.floor(rng() * neighbors.length)]!;
      events.push({ char: wrongChar, delayMs: events.length === 0 ? 0 : nextDelay(), mistake: true });
      events.push({ char: 'Backspace', delayMs: nextDelay(), backspace: true });
    }

    events.push({ char, delayMs: events.length === 0 ? 0 : nextDelay() });
  }

  return events;
}

export interface ScrollEvent {
  /** Pixels to scroll in this one wheel event. Positive scrolls down,
   * negative scrolls up — same sign convention as CDP's own
   * `Input.dispatchMouseEvent('mouseWheel')` `deltaY`. */
  deltaY: number;
  /** Milliseconds to wait after the previous event before dispatching
   * this one. Always 0 for the first event. */
  delayMs: number;
}

export interface HumanScrollPlanOptions {
  /** Number of discrete wheel events the total distance is split across.
   * Defaults to a value proportional to distance, clamped to
   * [MIN_SCROLL_STEPS, MAX_SCROLL_STEPS]. */
  steps?: number;
  /** Total wall-clock time the scroll should take, before any extra
   * pauses (see `pauseProbability`) are added on top. Defaults to a value
   * proportional to distance, clamped to
   * [MIN_SCROLL_DURATION_MS, MAX_SCROLL_DURATION_MS]. */
  durationMs?: number;
  /** Probability (0-1) that any given step (other than the first) gets an
   * extra pause added to its delay — simulating a moment spent actually
   * reading the page rather than continuously scrolling. 0 disables
   * pauses entirely. */
  pauseProbability?: number;
  /** Extra delay (milliseconds) added on top of a step's normal delay
   * when a pause is triggered. */
  pauseMs?: number;
  /** When true, the plan scrolls slightly past the requested total
   * distance and adds one corrective event scrolling back — the same
   * "overshoot and settle" pattern momentum-based (trackpad/some wheel)
   * scrolling produces. The events' deltaY always sums to exactly
   * `totalDeltaY` regardless of this setting. */
  overshoot?: boolean;
  /** Source of randomness, same [0, 1) contract as
   * `HumanMousePathOptions.rng`. Defaults to `Math.random`. */
  rng?: () => number;
}

const MIN_SCROLL_STEPS = 4;
const MAX_SCROLL_STEPS = 24;
const MIN_SCROLL_DURATION_MS = 120;
const MAX_SCROLL_DURATION_MS = 1000;
const SCROLL_OVERSHOOT_FRACTION = 0.12; // how far past the target, as a fraction of total distance
const DEFAULT_PAUSE_MS = 220;

/**
 * Generates the ordered sequence of discrete wheel-scroll events a
 * human-like scroll of `totalDeltaY` pixels should send — intended to
 * become a real `Input.dispatchMouseEvent('mouseWheel')` call per event
 * (see `humanInputDriver.ts`), each separated by real wall-clock delay,
 * rather than a single instant jump to the final scroll position.
 *
 * The non-uniform speed comes from the same technique
 * `buildHumanMousePath` uses: events are spaced at uniform wall-clock
 * time steps, but each step's *distance* is derived from an eased
 * (slow-fast-slow) curve parameter — so the same fixed time step covers
 * less distance near the start/end and more in the middle, i.e. the
 * scroll visibly speeds up then slows down, without needing per-step
 * variable delays for that effect alone (pauses are the one thing that
 * does still vary delay directly, on top of this).
 */
export function buildHumanScrollPlan(totalDeltaY: number, options: HumanScrollPlanOptions = {}): ScrollEvent[] {
  const rng = options.rng ?? Math.random;
  const direction = totalDeltaY < 0 ? -1 : 1;
  const absTotal = Math.abs(totalDeltaY);

  if (absTotal === 0) return [];

  const steps = Math.round(options.steps ?? clamp(absTotal / 120, MIN_SCROLL_STEPS, MAX_SCROLL_STEPS));
  const durationMs = options.durationMs ?? clamp(absTotal * 1.5, MIN_SCROLL_DURATION_MS, MAX_SCROLL_DURATION_MS);
  const pauseProbability = options.pauseProbability ?? 0;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const perStepDelay = durationMs / steps;

  // Scroll `mainDistance` first (past the real target when overshoot is
  // on), then append one corrective event bringing the cumulative total
  // back to exactly `absTotal`.
  const mainDistance = options.overshoot ? absTotal * (1 + SCROLL_OVERSHOOT_FRACTION) : absTotal;

  const events: ScrollEvent[] = [];
  let cumulative = 0;
  for (let i = 1; i <= steps; i++) {
    const eased = easeInOutCubic(i / steps);
    const targetCumulative = eased * mainDistance;
    const stepDistance = targetCumulative - cumulative;
    cumulative = targetCumulative;

    let delayMs = i === 1 ? 0 : perStepDelay;
    if (i > 1 && rng() < pauseProbability) delayMs += pauseMs;

    events.push({ deltaY: direction * stepDistance, delayMs });
  }

  if (options.overshoot) {
    const overshootAmount = mainDistance - absTotal;
    events.push({ deltaY: direction * -overshootAmount, delayMs: perStepDelay * 0.6 });
  }

  return events;
}
