import { describe, it, expect, vi } from 'vitest';
import { humanClick, humanType, type CdpSession } from '../../src/shared/automation/humanInputDriver';

function makeFakeSession(): { session: CdpSession; calls: Array<{ method: string; params?: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const session: CdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      return {};
    }),
  };
  return { session, calls };
}

describe('humanClick', () => {
  it('dispatches multiple mouseMoved events before the final press/release — not one instant jump', async () => {
    const { session, calls } = makeFakeSession();
    await humanClick(session, { x: 0, y: 0 }, { x: 300, y: 300 }, { steps: 10, durationMs: 0 });

    const moveEvents = calls.filter((c) => c.method === 'Input.dispatchMouseEvent' && c.params?.type === 'mouseMoved');
    // steps: 10 -> 11 points total (0..10 inclusive).
    expect(moveEvents.length).toBe(11);
  });

  it('presses and releases at the exact final position, in that order, after every move event', async () => {
    const { session, calls } = makeFakeSession();
    await humanClick(session, { x: 0, y: 0 }, { x: 50, y: 80 }, { steps: 3, durationMs: 0 });

    const pressIndex = calls.findIndex((c) => c.params?.type === 'mousePressed');
    const releaseIndex = calls.findIndex((c) => c.params?.type === 'mouseReleased');
    expect(pressIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(pressIndex);
    expect(releaseIndex).toBe(calls.length - 1);
    expect(calls[pressIndex]!.params).toMatchObject({ x: 50, y: 80, button: 'left' });
    expect(calls[releaseIndex]!.params).toMatchObject({ x: 50, y: 80, button: 'left' });
  });

  it('honors a non-default button', async () => {
    const { session, calls } = makeFakeSession();
    await humanClick(session, { x: 0, y: 0 }, { x: 10, y: 10 }, { button: 'right', durationMs: 0 });
    const press = calls.find((c) => c.params?.type === 'mousePressed');
    expect(press!.params!.button).toBe('right');
  });

  it('actually waits real wall-clock time between move events matching the configured duration', async () => {
    const { session } = makeFakeSession();
    const start = Date.now();
    await humanClick(session, { x: 0, y: 0 }, { x: 200, y: 0 }, { steps: 5, durationMs: 100 });
    const elapsed = Date.now() - start;
    // 100ms spread across 5 steps — allow generous slack for CI timer
    // granularity, but this would fail instantly (near 0ms) if the driver
    // silently skipped the delays.
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });
});

describe('humanType', () => {
  it('dispatches a keyDown+keyUp pair (with `text` set) for each printable character, in order', async () => {
    const { session, calls } = makeFakeSession();
    await humanType(session, 'ab', { mistakeProbability: 0, meanDelayMs: 1, stdDevMs: 0, minDelayMs: 0 });

    const types = calls.map((c) => `${c.params!.type}:${c.params!.key}`);
    // No separate 'char' event: a 'keyDown' carrying `text` already
    // inserts the character in real Chromium — an extra 'char' event on
    // top double-inserts (a real bug caught by the E2E test, not a
    // hypothetical).
    expect(types).toEqual(['keyDown:a', 'keyUp:a', 'keyDown:b', 'keyUp:b']);
    expect(calls[0]!.params!.text).toBe('a');
  });

  it('a Backspace event uses rawKeyDown/keyUp only, no char event, and the right virtual key code', async () => {
    const { session, calls } = makeFakeSession();
    await humanType(session, '', {}); // sanity: empty text dispatches nothing
    expect(calls.length).toBe(0);

    const rng = () => 0; // forces mistake injection at probability 1
    const { session: session2, calls: calls2 } = makeFakeSession();
    await humanType(session2, 'a', { mistakeProbability: 1, rng, meanDelayMs: 1, stdDevMs: 0, minDelayMs: 0 });

    const backspaceEvents = calls2.filter((c) => c.params!.key === 'Backspace');
    expect(backspaceEvents.map((c) => c.params!.type)).toEqual(['rawKeyDown', 'keyUp']);
    expect(backspaceEvents[0]!.params!.windowsVirtualKeyCode).toBe(8);
    expect(calls2.some((c) => c.params!.type === 'char' && c.params!.key === 'Backspace')).toBe(false);
  });

  it('actually waits real wall-clock time between keystrokes matching the configured mean delay', async () => {
    const { session } = makeFakeSession();
    const start = Date.now();
    await humanType(session, 'abcde', { meanDelayMs: 50, stdDevMs: 0, minDelayMs: 50, mistakeProbability: 0 });
    const elapsed = Date.now() - start;
    // 4 delays of ~50ms between 5 characters (first is instant).
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });
});
