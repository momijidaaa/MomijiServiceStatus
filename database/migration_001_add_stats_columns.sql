ALTER TABLE services ADD COLUMN last_response_time INTEGER;
ALTER TABLE services ADD COLUMN last_http_status INTEGER;
ALTER TABLE services ADD COLUMN last_checked_at INTEGER;
ALTER TABLE services ADD COLUMN uptime_24h REAL;
ALTER TABLE services ADD COLUMN uptime_7d REAL;
ALTER TABLE services ADD COLUMN uptime_30d REAL;
ALTER TABLE services ADD COLUMN stats_updated_at INTEGER;