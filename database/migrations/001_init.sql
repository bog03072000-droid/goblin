CREATE TABLE fingerprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  os TEXT NOT NULL,
  os_version TEXT NOT NULL,
  browser_version TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  platform TEXT NOT NULL,
  locale TEXT NOT NULL,
  languages TEXT NOT NULL,
  timezone TEXT NOT NULL,
  screen_width INTEGER NOT NULL,
  screen_height INTEGER NOT NULL,
  device_scale_factor REAL NOT NULL,
  hardware_concurrency INTEGER NOT NULL,
  device_memory INTEGER NOT NULL,
  webgl_vendor TEXT NOT NULL,
  webgl_renderer TEXT NOT NULL,
  canvas_mode TEXT NOT NULL,
  audio_mode TEXT NOT NULL,
  webrtc_mode TEXT NOT NULL,
  fonts_mode TEXT NOT NULL,
  media_devices_mode TEXT NOT NULL,
  seed TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proxies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  encrypted_password BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  profile_path TEXT NOT NULL UNIQUE,
  fingerprint_id TEXT NOT NULL REFERENCES fingerprints(id) ON DELETE RESTRICT,
  proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'STOPPED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_started_at TEXT,
  last_stopped_at TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE profile_tags (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, tag_id)
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  profile_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_name ON profiles(name);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
