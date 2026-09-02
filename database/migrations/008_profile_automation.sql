ALTER TABLE profiles ADD COLUMN automation_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN automation_port INTEGER;
ALTER TABLE profiles ADD COLUMN automation_token_encrypted BLOB;
