/**
 * In-page recorder for the no-code Scenario Builder's MVP (see
 * docs/SCENARIO_BUILDER.md for the full recording/playback design and its
 * real limits). Injected via `webContents.executeJavaScript()` — the same
 * mechanism the "Test human input" button already uses (see
 * profileWindowEntry.ts's `pf:test-human-input` handler) — rather than
 * CDP's `Page.addScriptToEvaluateOnNewDocument`, since a recorder only
 * needs to run in the page the user is CURRENTLY on, not survive
 * navigation: this MVP records a single page's worth of actions
 * (documented limitation, not an oversight — see the doc above).
 *
 * Deliberately listens for 'change', not 'input', on text fields: 'input'
 * fires once per keystroke, which would record "h", "he", "hel", ... as
 * separate typed-text actions and replay them as a stutter; 'change' fires
 * once when the field is committed (blur or Enter for most inputs), giving
 * exactly one action carrying the field's final value — a real MVP
 * tradeoff (a field never blurred before recording stops won't be
 * captured), not a bug.
 */
export function buildScenarioRecorderScript(): string {
  return `(function () {
    if (window.__pfScenarioRecording) return { ok: false, reason: 'already recording' };
    window.__pfScenarioActions = [];
    window.__pfScenarioRecording = true;

    window.__pfScenarioClickHandler = function (e) {
      window.__pfScenarioActions.push({ type: 'click', x: Math.round(e.clientX), y: Math.round(e.clientY), t: Date.now() });
    };
    window.__pfScenarioChangeHandler = function (e) {
      var el = e.target;
      if (el && typeof el.value === 'string') {
        window.__pfScenarioActions.push({ type: 'type', text: el.value, t: Date.now() });
      }
    };
    document.addEventListener('click', window.__pfScenarioClickHandler, true);
    document.addEventListener('change', window.__pfScenarioChangeHandler, true);
    return { ok: true };
  })();`;
}

/** Detaches the listeners and returns the recorded actions (each still
 * carrying its own absolute `t: Date.now()` timestamp — merged with any
 * navigation events the main process recorded separately, then converted
 * to relative delayMs, by the caller; see profileWindowEntry.ts's
 * `pf:scenario-record-stop` handler). Safe to call even if recording was
 * never started (returns an empty array). */
export function buildScenarioStopScript(): string {
  return `(function () {
    var actions = window.__pfScenarioActions || [];
    if (window.__pfScenarioClickHandler) document.removeEventListener('click', window.__pfScenarioClickHandler, true);
    if (window.__pfScenarioChangeHandler) document.removeEventListener('change', window.__pfScenarioChangeHandler, true);
    window.__pfScenarioRecording = false;
    window.__pfScenarioActions = [];
    return actions;
  })();`;
}
