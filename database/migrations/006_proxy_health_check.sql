ALTER TABLE proxies ADD COLUMN last_check_status TEXT;
ALTER TABLE proxies ADD COLUMN last_checked_at TEXT;
ALTER TABLE proxies ADD COLUMN last_check_latency_ms INTEGER;
