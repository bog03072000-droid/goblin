import { describe, it, expect, vi } from 'vitest';
import { playScenario, type ScenarioPlayProgressEvent } from '../../src/main/automation/scenarioPlayer';
import type { CdpSession } from '../../src/shared/automation/humanInputDriver';
import type { ScenarioStep } from '../../src/shared/schemas/scenario';

function makeFakeWebContents(overrides: { loadURLImpl?: (url: string) => Promise<void> } = {}) {
  const loadURL = vi.fn(async (url: string) => {
    if (overrides.loadURLImpl) return overrides.loadURLImpl(url);
  });
  return { loadURL } as unknown as import('electron').WebContents & { loadURL: typeof loadURL };
}

function makeFakeSession(): CdpSession & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => ({})) };
}

describe('playScenario', () => {
  it('replays a click step via real Input.dispatchMouseEvent CDP calls at the recorded coordinates', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const steps: ScenarioStep[] = [{ type: 'click', x: 150, y: 200, delayMs: 0 }];

    await playScenario(wc, session, steps);

    const pressed = session.send.mock.calls.find(([, params]) => (params as { type?: string })?.type === 'mousePressed');
    expect(pressed).toBeTruthy();
    expect((pressed![1] as { x: number; y: number }).x).toBe(150);
    expect((pressed![1] as { x: number; y: number }).y).toBe(200);
  });

  it('replays a type step via real Input.dispatchKeyEvent CDP calls carrying the recorded text', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const steps: ScenarioStep[] = [{ type: 'type', text: 'hi', delayMs: 0 }];

    await playScenario(wc, session, steps);

    const keyEvents = session.send.mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent');
    // 2 characters x (keyDown + keyUp) = 4 events.
    expect(keyEvents.length).toBe(4);
  });

  it('replays a navigate step via webContents.loadURL with the recorded url', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const steps: ScenarioStep[] = [{ type: 'navigate', url: 'https://example.com/page', delayMs: 0 }];

    await playScenario(wc, session, steps);

    expect(wc.loadURL).toHaveBeenCalledWith('https://example.com/page');
  });

  it('replays steps in order and reports progress for each', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const steps: ScenarioStep[] = [
      { type: 'navigate', url: 'https://a.example', delayMs: 0 },
      { type: 'click', x: 10, y: 10, delayMs: 0 },
      { type: 'type', text: 'x', delayMs: 0 },
    ];
    const events: ScenarioPlayProgressEvent[] = [];

    await playScenario(wc, session, steps, (e) => events.push(e));

    expect(events.map((e) => e.step.type)).toEqual(['navigate', 'click', 'type']);
    expect(events.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(events.every((e) => e.total === 3)).toBe(true);
  });

  it('caps an unrealistically long recorded delay instead of actually waiting that long during playback', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    // A real 30-second recorded pause would make this test itself take 30s
    // if not capped — MAX_STEP_DELAY_MS (3000ms) should bound it.
    const steps: ScenarioStep[] = [{ type: 'click', x: 1, y: 1, delayMs: 30_000 }];

    const start = Date.now();
    await playScenario(wc, session, steps);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });

  it('a navigate step whose loadURL rejects propagates the error and stops the scenario', async () => {
    const wc = makeFakeWebContents({
      loadURLImpl: async () => {
        throw new Error('DNS failure');
      },
    });
    const session = makeFakeSession();
    const steps: ScenarioStep[] = [
      { type: 'navigate', url: 'https://broken.example', delayMs: 0 },
      { type: 'click', x: 1, y: 1, delayMs: 0 },
    ];

    await expect(playScenario(wc, session, steps)).rejects.toThrow(/DNS failure/);
    // The click step after the failed navigate never ran — unlike warmup's
    // independent URLs, a scenario's steps are NOT independent of each
    // other (see playScenario's own doc comment).
    const clickCalls = session.send.mock.calls.filter(([, params]) => (params as { type?: string })?.type === 'mousePressed');
    expect(clickCalls).toHaveLength(0);
  });

  it('an empty step list is a no-op', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    await playScenario(wc, session, []);
    expect(session.send).not.toHaveBeenCalled();
    expect(wc.loadURL).not.toHaveBeenCalled();
  });
});
