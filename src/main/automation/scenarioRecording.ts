import type { WebContents } from 'electron';
import { buildScenarioRecorderScript, buildScenarioStopScript } from '../../shared/automation/scenarioRecorderScript';
import type { ScenarioStep } from '../../shared/schemas/scenario';

interface TimestampedAction {
  type: 'click' | 'type' | 'navigate';
  t: number;
  x?: number;
  y?: number;
  text?: string;
  url?: string;
}

/** One active recording per webContentsId — a `did-navigate` listener (the
 * only thing that can see navigation from the main process, since the
 * in-page recorder script's own state doesn't survive a real page
 * navigation — see scenarioRecorderScript.ts's own top comment) plus the
 * function to stop it and get the merged, chronologically-ordered step
 * list back. */
export class ScenarioRecordingManager {
  private readonly sessions = new Map<number, { navigateEvents: TimestampedAction[]; onNavigate: (event: unknown, url: string) => void }>();

  async start(webContents: WebContents): Promise<{ ok: boolean }> {
    const id = webContents.id;
    if (this.sessions.has(id)) return { ok: false };

    const navigateEvents: TimestampedAction[] = [];
    const onNavigate = (_event: unknown, url: string): void => {
      navigateEvents.push({ type: 'navigate', url, t: Date.now() });
    };
    webContents.on('did-navigate', onNavigate);
    this.sessions.set(id, { navigateEvents, onNavigate });

    const result = (await webContents.executeJavaScript(buildScenarioRecorderScript())) as { ok: boolean };
    return result;
  }

  isRecording(webContentsId: number): boolean {
    return this.sessions.has(webContentsId);
  }

  /** Stops recording and returns the merged step list — in-page click/type
   * actions and main-process-observed navigations, sorted by their real
   * timestamp (both use the same process clock, so this is a safe
   * chronological merge) and converted from absolute timestamps to
   * relative delayMs (the shape ScenarioStepSchema/scenarioPlayer.ts
   * actually use). */
  async stop(webContents: WebContents): Promise<ScenarioStep[]> {
    const id = webContents.id;
    const session = this.sessions.get(id);
    if (!session) return [];
    webContents.removeListener('did-navigate', session.onNavigate);
    this.sessions.delete(id);

    const inPageActions = (await webContents.executeJavaScript(buildScenarioStopScript())) as TimestampedAction[];
    const merged = [...inPageActions, ...session.navigateEvents].sort((a, b) => a.t - b.t);

    let lastT: number | null = null;
    const steps: ScenarioStep[] = [];
    for (const action of merged) {
      const delayMs = lastT === null ? 0 : Math.max(0, action.t - lastT);
      lastT = action.t;
      if (action.type === 'click' && action.x !== undefined && action.y !== undefined) {
        steps.push({ type: 'click', x: action.x, y: action.y, delayMs });
      } else if (action.type === 'type' && action.text !== undefined) {
        steps.push({ type: 'type', text: action.text, delayMs });
      } else if (action.type === 'navigate' && action.url !== undefined) {
        steps.push({ type: 'navigate', url: action.url, delayMs });
      }
    }
    return steps;
  }
}
