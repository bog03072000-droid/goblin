CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE profiles ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_group_id ON profiles(group_id);
