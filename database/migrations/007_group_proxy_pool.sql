ALTER TABLE groups ADD COLUMN proxy_rotation_cursor INTEGER NOT NULL DEFAULT 0;

CREATE TABLE group_proxy_pool (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  proxy_id TEXT NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (group_id, proxy_id)
);
CREATE INDEX idx_group_proxy_pool_group_id ON group_proxy_pool(group_id);
