CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    url TEXT,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    maintenance INTEGER NOT NULL DEFAULT 0,
    maintenance_message TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    current_status TEXT NOT NULL DEFAULT 'unknown',
    threshold_degraded_ms INTEGER NOT NULL DEFAULT 2000,
    threshold_outage_ms INTEGER NOT NULL DEFAULT 10000,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    status TEXT NOT NULL,
    response_time INTEGER,
    http_status INTEGER,
    checked_at INTEGER NOT NULL,
    FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE INDEX IF NOT EXISTS idx_checks_service_time ON checks (service_id, checked_at);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    resolved_at INTEGER,
    notified_start INTEGER NOT NULL DEFAULT 0,
    notified_resolve INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_service ON incidents (service_id);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents (started_at);

INSERT OR IGNORE INTO services (id, name, category, url, description, enabled, sort_order) VALUES
('karocasi', 'KaroCasi', 'web', 'https://karocasi.momijiweb.jp', 'かろあーす内通貨で遊ぶカジノ系Webサービス', 1, 1),
('karo', 'Karo', 'web', 'https://karo.momijiweb.jp', 'かろあーす内通貨の寄付サイト', 1, 2),
('msb-sec', 'MSB Sec', 'bot', 'https://sec.momijiweb.jp', 'セキュリティBot', 1, 3),
('koyobot', 'Koyobot v2', 'bot', 'https://dashboard.momijiweb.jp', '多機能Discord Bot', 1, 4);
