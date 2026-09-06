ALTER TABLE profiles ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN schedule_time TEXT;
ALTER TABLE profiles ADD COLUMN schedule_days TEXT;
ALTER TABLE profiles ADD COLUMN schedule_last_triggered_at TEXT;
