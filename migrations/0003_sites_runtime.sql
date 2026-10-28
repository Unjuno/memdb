-- D1-backed anonymous rate limiting and bounded request-driven maintenance for Sites.
CREATE TABLE IF NOT EXISTS request_limits (
    scope TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    window_start_s INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 1),
    PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS request_limits_expiry_idx ON request_limits(window_start_s);

CREATE TABLE IF NOT EXISTS maintenance_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    run_after_s INTEGER NOT NULL
);
INSERT OR IGNORE INTO maintenance_state(id, run_after_s) VALUES (1, 0);
