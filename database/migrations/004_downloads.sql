CREATE TABLE downloads (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  save_path TEXT NOT NULL,
  url TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_downloads_profile_id ON downloads(profile_id);
CREATE INDEX idx_downloads_created_at ON downloads(created_at);
