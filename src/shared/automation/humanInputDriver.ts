import { buildHumanMousePath, buildHumanTypingPlan, type Point, type HumanMousePathOptions, type HumanTypingOptions } from './humanInput';

/**
 * The minimal shape this module needs from a CDP session — deliberately
 * not tied to Puppeteer's or Playwright's own session types, so this file
 * has no dependency on either package. Puppeteer's `page._client()`,
 * Playwright's `CDPSession` (from `context.newCDPSession(page)`), and a
 * raw `chrome-remote-interface`/plain-`ws` client all satisfy this shape
 * already or with a one-line adapter — see README's Automation section
 * for a real usage example against each.
 */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Moves the mouse from `from` to `to` along a human-like path
 * (`buildHumanMousePath`) — a real `Input.dispatchMouseEvent('mouseMoved')`
 * call per intermediate point, each separated by real wall-clock delay —
 * then presses and releases the button at the final position. This is the
 * one piece that actually needs a live CDP session; all the interesting
 * curve/timing math lives in `humanInput.ts` and is tested there without
 * one.
 */
export async function humanClick(
  session: CdpSession,
  from: Point,
  to: Point,
  options: HumanMousePathOptions & { button?: 'left' | 'right' | 'middle' } = {},
): Promise<void> {
  const button = options.button ?? 'left';
  const path = buildHumanMousePath(from, to, options);

  for (const point of path) {
    await sleep(point.delayMs);
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
    });
  }

  const final = path[path.length - 1]!;
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: final.x,
    y: final.y,
    button,
    clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: final.x,
    y: final.y,
    button,
    clickCount: 1,
  });
}

/** `Input.dispatchKeyEvent` needs a Windows virtual-key code for
 * non-printable keys — only the handful this module actually generates
 * (Backspace, plus a couple of common navigation keys a caller might
 * reasonably want to send alongside typed text) are mapped. A printable
 * character is sent via its own `text`/`key` fields instead, which
 * doesn't need an entry here. */
const VIRTUAL_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
};

async function dispatchKeystroke(session: CdpSession, char: string): Promise<void> {
  const isSpecialKey = char in VIRTUAL_KEY_CODES;
  const baseParams: Record<string, unknown> = isSpecialKey
    ? { key: char, code: char, windowsVirtualKeyCode: VIRTUAL_KEY_CODES[char] }
    : { key: char, text: char };

  // For a printable character, a single 'keyDown' event carrying `text`
  // is what actually inserts it in real Chromium — a separate 'char'
  // event on top of that double-inserts (confirmed by a real E2E run
  // during development: input.value came back with every character
  // doubled). Non-printable keys (Backspace etc.) carry no `text` at all
  // and use 'rawKeyDown' instead, matching real Puppeteer/Playwright
  // behavior for the same key classes.
  await session.send('Input.dispatchKeyEvent', { type: isSpecialKey ? 'rawKeyDown' : 'keyDown', ...baseParams });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...baseParams });
}

/**
 * Types `text` into whatever element currently has focus, following a
 * human-like timing plan (`buildHumanTypingPlan`) — a real `keyDown`/
 * `char`/`keyUp` CDP event triplet per character (or `rawKeyDown`/`keyUp`
 * for Backspace), each separated by real wall-clock delay, rather than a
 * single instant value mutation. Does not itself focus or locate the
 * target element — same division of responsibility as CDP's own
 * `Input.dispatchKeyEvent`, which only ever types into whatever already
 * has focus.
 */
export async function humanType(session: CdpSession, text: string, options: HumanTypingOptions = {}): Promise<void> {
  const plan = buildHumanTypingPlan(text, options);
  for (const event of plan) {
    await sleep(event.delayMs);
    await dispatchKeystroke(session, event.char);
  }
}
