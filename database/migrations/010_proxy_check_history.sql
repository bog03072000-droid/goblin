CREATE TABLE proxy_check_history (
  id TEXT PRIMARY KEY,
  proxy_id TEXT NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  checked_at TEXT NOT NULL
);

-- Indexed on proxy_id alone, not (proxy_id, checked_at) — reads are
-- ordered by rowid (see proxyRepository.ts's recordCheckResult()/
-- listCheckHistory() for why: checked_at's millisecond resolution can tie
-- across two fast inserts, rowid can't), so a checked_at-ordered index
-- wouldn't actually match the query plan.
CREATE INDEX idx_proxy_check_history_proxy_id
  ON proxy_check_history(proxy_id);
