import type { WebContents } from 'electron';
import { humanClick, humanType, type CdpSession } from '../../shared/automation/humanInputDriver';
import type { Point } from '../../shared/automation/humanInput';
import { loadWithTimeout } from '../browser/warmupOrchestrator';
import type { ScenarioStep } from '../../shared/schemas/scenario';

/** Caps how long playback waits between two steps, regardless of how long
 * the real gap was while recording — a person pausing to think for 30
 * real seconds shouldn't make every future replay wait 30 seconds too.
 * Short recorded gaps (the normal case — someone clicking then typing)
 * pass through unchanged. */
const MAX_STEP_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface ScenarioPlayProgressEvent {
  index: number;
  total: number;
  step: ScenarioStep;
}

/**
 * Replays a recorded scenario against a real running profile — clicks and
 * typed text go through the same humanClick/humanType primitives every
 * other automation feature in this app already uses (not a re-implemented,
 * instant version), navigation goes through the same loadWithTimeout()
 * warmupOrchestrator.ts's Cookie-Robot-style feature already uses. One
 * step failing (e.g. a click coordinate that no longer matches the current
 * page layout — a real MVP limitation, see docs/SCENARIO_BUILDER.md) stops
 * the whole scenario rather than continuing into steps that assumed it
 * succeeded — unlike warmup's "one bad URL doesn't stop the rest" batch,
 * a scenario's steps are NOT independent of each other by design (a typed
 * value assumes the click before it actually focused the right field).
 */
export async function playScenario(
  webContents: WebContents,
  session: CdpSession,
  steps: ScenarioStep[],
  onProgress?: (event: ScenarioPlayProgressEvent) => void,
): Promise<void> {
  let lastPos: Point = { x: 0, y: 0 };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    await sleep(Math.min(step.delayMs, MAX_STEP_DELAY_MS));
    onProgress?.({ index: i, total: steps.length, step });

    if (step.type === 'click') {
      const to: Point = { x: step.x, y: step.y };
      await humanClick(session, lastPos, to, { overshoot: true });
      lastPos = to;
    } else if (step.type === 'type') {
      await humanType(session, step.text);
    } else if (step.type === 'navigate') {
      await loadWithTimeout(webContents, step.url, 20_000);
    }
  }
}
