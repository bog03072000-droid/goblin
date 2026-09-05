import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Fingerprint, FingerprintInput } from '../../shared/schemas/fingerprint';

interface FingerprintRow {
  id: string;
  name: string;
  os: string;
  os_version: string;
  browser_version: string;
  user_agent: string;
  platform: string;
  locale: string;
  languages: string;
  timezone: string;
  screen_width: number;
  screen_height: number;
  device_scale_factor: number;
  hardware_concurrency: number;
  device_memory: number;
  webgl_vendor: string;
  webgl_renderer: string;
  canvas_mode: string;
  audio_mode: string;
  webrtc_mode: string;
  fonts_mode: string;
  media_devices_mode: string;
  webgl_spoofing_mode: string;
  geolocation_mode: string;
  geolocation_latitude: number;
  geolocation_longitude: number;
  permissions_mode: string;
  service_worker_mode: string;
  seed: string;
  created_at: string;
  updated_at: string;
}

function rowToFingerprint(row: FingerprintRow): Fingerprint {
  let languages: string[];
  try {
    languages = JSON.parse(row.languages) as string[];
  } catch {
    // A malformed `languages` column (hand-edited DB, disk corruption, a
    // partial write) must never crash the whole app on read — surfaced as
    // a specific, translatable error instead of an unhandled JSON.parse throw.
    throw new Error('Corrupted fingerprint data');
  }
  return {
    id: row.id,
    name: row.name,
    os: row.os as Fingerprint['os'],
    osVersion: row.os_version,
    browserVersion: row.browser_version,
    userAgent: row.user_agent,
    platform: row.platform,
    locale: row.locale,
    languages,
    timezone: row.timezone,
    screenWidth: row.screen_width,
    screenHeight: row.screen_height,
    deviceScaleFactor: row.device_scale_factor,
    hardwareConcurrency: row.hardware_concurrency,
    deviceMemory: row.device_memory,
    webglVendor: row.webgl_vendor,
    webglRenderer: row.webgl_renderer,
    canvasMode: row.canvas_mode as Fingerprint['canvasMode'],
    audioMode: row.audio_mode as Fingerprint['audioMode'],
    webrtcMode: row.webrtc_mode as Fingerprint['webrtcMode'],
    fontsMode: row.fonts_mode as Fingerprint['fontsMode'],
    mediaDevicesMode: row.media_devices_mode as Fingerprint['mediaDevicesMode'],
    webglSpoofingMode: row.webgl_spoofing_mode as Fingerprint['webglSpoofingMode'],
    geolocationMode: row.geolocation_mode as Fingerprint['geolocationMode'],
    geolocationLatitude: row.geolocation_latitude,
    geolocationLongitude: row.geolocation_longitude,
    permissionsMode: row.permissions_mode as Fingerprint['permissionsMode'],
    serviceWorkerMode: row.service_worker_mode as Fingerprint['serviceWorkerMode'],
    seed: row.seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FingerprintRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: FingerprintInput): Fingerprint {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO fingerprints (
          id, name, os, os_version, browser_version, user_agent, platform, locale,
          languages, timezone, screen_width, screen_height, device_scale_factor,
          hardware_concurrency, device_memory, webgl_vendor, webgl_renderer,
          canvas_mode, audio_mode, webrtc_mode, fonts_mode, media_devices_mode,
          webgl_spoofing_mode, geolocation_mode, geolocation_latitude, geolocation_longitude,
          permissions_mode, service_worker_mode, seed, created_at, updated_at
        ) VALUES (@id, @name, @os, @osVersion, @browserVersion, @userAgent, @platform, @locale,
          @languages, @timezone, @screenWidth, @screenHeight, @deviceScaleFactor,
          @hardwareConcurrency, @deviceMemory, @webglVendor, @webglRenderer,
          @canvasMode, @audioMode, @webrtcMode, @fontsMode, @mediaDevicesMode,
          @webglSpoofingMode, @geolocationMode, @geolocationLatitude, @geolocationLongitude,
          @permissionsMode, @serviceWorkerMode, @seed, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        ...input,
        languages: JSON.stringify(input.languages),
        createdAt: now,
        updatedAt: now,
      });
    return this.getById(id)!;
  }

  getById(id: string): Fingerprint | null {
    const row = this.db.prepare('SELECT * FROM fingerprints WHERE id = ?').get(id) as
      | FingerprintRow
      | undefined;
    return row ? rowToFingerprint(row) : null;
  }

  update(id: string, patch: Partial<FingerprintInput>): Fingerprint {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Fingerprint not found: ${id}`);
    const merged: FingerprintInput = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE fingerprints SET name=@name, os=@os, os_version=@osVersion,
          browser_version=@browserVersion, user_agent=@userAgent, platform=@platform,
          locale=@locale, languages=@languages, timezone=@timezone,
          screen_width=@screenWidth, screen_height=@screenHeight,
          device_scale_factor=@deviceScaleFactor, hardware_concurrency=@hardwareConcurrency,
          device_memory=@deviceMemory, webgl_vendor=@webglVendor, webgl_renderer=@webglRenderer,
          canvas_mode=@canvasMode, audio_mode=@audioMode, webrtc_mode=@webrtcMode,
          fonts_mode=@fontsMode, media_devices_mode=@mediaDevicesMode,
          webgl_spoofing_mode=@webglSpoofingMode, geolocation_mode=@geolocationMode,
          geolocation_latitude=@geolocationLatitude, geolocation_longitude=@geolocationLongitude,
          permissions_mode=@permissionsMode, service_worker_mode=@serviceWorkerMode, seed=@seed,
          updated_at=@updatedAt WHERE id=@id`,
      )
      .run({
        id,
        ...merged,
        languages: JSON.stringify(merged.languages),
        updatedAt: new Date().toISOString(),
      });
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM fingerprints WHERE id = ?').run(id);
  }

  list(): Fingerprint[] {
    const rows = this.db.prepare('SELECT * FROM fingerprints ORDER BY created_at DESC').all() as FingerprintRow[];
    return rows.map(rowToFingerprint);
  }
}
