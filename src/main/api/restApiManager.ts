import type { SettingsRepository } from '../database/settingsRepository';
import { startRestApiServer, type RestApiServerDeps, type RestApiServerHandle } from './restApiServer';
import { log } from '../logger';

/**
 * Owns the REST API's actual running state (or lack of it) so
 * enabling/disabling it, changing its port, or regenerating its token from
 * the Settings page all take effect immediately — unlike the per-profile
 * automation proxy, which only reads its token once at that profile's own
 * process launch (see AdvancedTab.tsx's own comment on that limitation),
 * this is one long-lived server in the manager process, so there's no
 * "restart the profile" step needed for a change to apply.
 */
export class RestApiManager {
  private handle: RestApiServerHandle | null = null;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly deps: RestApiServerDeps,
  ) {}

  isRunning(): boolean {
    return this.handle !== null;
  }

  /** Starts (or restarts, if already running) the server using the current
   * settings/token — a no-op if the REST API isn't enabled or has no port
   * configured. Call this after any change that could affect the running
   * server: initial app boot, toggling restApiEnabled, changing
   * restApiPort, or regenerating the token. Failures are logged, not
   * thrown — a bad port (e.g. already in use) should not crash the whole
   * app, the same posture profileWindowEntry.ts already takes for its own
   * optional automation proxy. */
  async sync(): Promise<void> {
    this.stop();
    const settings = this.settings.getAll();
    if (!settings.restApiEnabled || !settings.restApiPort) return;

    let token = this.settings.getRestApiToken();
    if (!token) token = this.settings.regenerateRestApiToken();

    try {
      this.handle = await startRestApiServer({ port: settings.restApiPort, token, deps: this.deps });
    } catch (err) {
      log.error('[restApi] failed to start REST API server', err);
      this.handle = null;
    }
  }

  stop(): void {
    this.handle?.close();
    this.handle = null;
  }
}
