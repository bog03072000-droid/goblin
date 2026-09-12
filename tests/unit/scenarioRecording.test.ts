import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ScenarioRecordingManager } from '../../src/main/automation/scenarioRecording';

/** A fake WebContents exposing just what ScenarioRecordingManager actually
 * uses: `.id`, `.on`/`.removeListener` (real EventEmitter, so `did-navigate`
 * can be fired for real during a test), and `.executeJavaScript` (returns
 * whatever `inPageActions` currently holds — mutated by the test to
 * simulate the in-page recorder script accumulating actions). */
function makeFakeWebContents(id: number, inPageActionsRef: { current: unknown[] }) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    id,
    executeJavaScript: vi.fn(async (script: string) => {
      // buildScenarioRecorderScript()'s injected code returns { ok: true }
      // on start; buildScenarioStopScript()'s returns the actions array on
      // stop — distinguished here the same way the real scripts differ,
      // by a substring, since this fake never actually runs real JS.
      if (script.includes('already recording')) return { ok: true };
      return inPageActionsRef.current;
    }),
  }) as unknown as import('electron').WebContents & { executeJavaScript: ReturnType<typeof vi.fn> };
}

describe('ScenarioRecordingManager', () => {
  it('start() returns ok:true and marks the tab as recording', async () => {
    const manager = new ScenarioRecordingManager();
    const wc = makeFakeWebContents(1, { current: [] });

    const result = await manager.start(wc);

    expect(result).toEqual({ ok: true });
    expect(manager.isRecording(1)).toBe(true);
  });

  it('starting twice on the same tab without stopping is a no-op the second time', async () => {
    const manager = new ScenarioRecordingManager();
    const wc = makeFakeWebContents(1, { current: [] });

    await manager.start(wc);
    const second = await manager.start(wc);

    expect(second).toEqual({ ok: false });
  });

  it('stop() on a tab that was never recording returns an empty list, not an error', async () => {
    const manager = new ScenarioRecordingManager();
    const wc = makeFakeWebContents(1, { current: [] });

    expect(await manager.stop(wc)).toEqual([]);
  });

  it('merges in-page click/type actions with main-process-observed navigation, in chronological order', async () => {
    const manager = new ScenarioRecordingManager();
    const actionsRef = { current: [] as unknown[] };
    const wc = makeFakeWebContents(1, actionsRef);

    await manager.start(wc);
    const t0 = Date.now();
    actionsRef.current = [
      { type: 'click', x: 10, y: 20, t: t0 },
      { type: 'type', text: 'hello', t: t0 + 200 },
    ];
    // A real did-navigate fired between the click and the type, timestamp-
    // wise — the merge must interleave it correctly by time, not just
    // append navigation events at the end.
    wc.emit('did-navigate', {}, 'https://example.com/page2');

    const steps = await manager.stop(wc);

    expect(steps.map((s) => s.type)).toEqual(['click', 'navigate', 'type']);
    expect(steps[0]).toMatchObject({ type: 'click', x: 10, y: 20 });
    expect(steps[1]).toMatchObject({ type: 'navigate', url: 'https://example.com/page2' });
    expect(steps[2]).toMatchObject({ type: 'type', text: 'hello' });
  });

  it('stop() computes delayMs as the real gap from the previous step, 0 for the first', async () => {
    const manager = new ScenarioRecordingManager();
    const actionsRef = { current: [] as unknown[] };
    const wc = makeFakeWebContents(1, actionsRef);

    await manager.start(wc);
    const t0 = Date.now();
    actionsRef.current = [
      { type: 'click', x: 1, y: 1, t: t0 },
      { type: 'click', x: 2, y: 2, t: t0 + 150 },
    ];

    const steps = await manager.stop(wc);

    expect(steps[0]!.delayMs).toBe(0);
    expect(steps[1]!.delayMs).toBe(150);
  });

  it('stop() unregisters the did-navigate listener so a later navigation is not recorded', async () => {
    const manager = new ScenarioRecordingManager();
    const wc = makeFakeWebContents(1, { current: [] });

    await manager.start(wc);
    await manager.stop(wc);
    expect(manager.isRecording(1)).toBe(false);

    // A navigation after stop() must not throw or otherwise misbehave —
    // there's no listener left to react to it.
    expect(() => wc.emit('did-navigate', {}, 'https://after-stop.example')).not.toThrow();
  });

  it('tracks multiple tabs independently by webContents id', async () => {
    const manager = new ScenarioRecordingManager();
    const wc1 = makeFakeWebContents(1, { current: [] });
    const wc2 = makeFakeWebContents(2, { current: [] });

    await manager.start(wc1);
    expect(manager.isRecording(1)).toBe(true);
    expect(manager.isRecording(2)).toBe(false);

    await manager.start(wc2);
    expect(manager.isRecording(2)).toBe(true);

    await manager.stop(wc1);
    expect(manager.isRecording(1)).toBe(false);
    expect(manager.isRecording(2)).toBe(true);
  });
});
