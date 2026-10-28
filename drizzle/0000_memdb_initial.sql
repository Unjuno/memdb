CREATE TABLE IF NOT EXISTS usage_quota (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_pages INTEGER NOT NULL CHECK (max_pages > 0),
    max_content_bytes INTEGER NOT NULL CHECK (max_content_bytes > 0),
    used_pages INTEGER NOT NULL DEFAULT 0 CHECK (used_pages >= 0),
    used_content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_content_bytes >= 0)
);
--> statement-breakpoint
INSERT OR IGNORE INTO usage_quota (id, max_pages, max_content_bytes)
VALUES (1, 10000, 134217728);
--> statement-breakpoint
-- logical content, 128 MiB (not actual D1 file size)

CREATE TABLE IF NOT EXISTS pages (
    path TEXT PRIMARY KEY COLLATE BINARY,
    content_md TEXT NOT NULL,
    content_bytes INTEGER NOT NULL CHECK (
        content_bytes >= 1 AND content_bytes <= 32768
        AND content_bytes = length(CAST(content_md AS BLOB))
    ),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'write_locked')),
    created_at_s INTEGER NOT NULL,
    updated_at_s INTEGER NOT NULL,
    locked_since_s INTEGER,
    CHECK (updated_at_s >= created_at_s),
    CHECK ((state = 'active' AND locked_since_s IS NULL)
       OR (state = 'write_locked' AND locked_since_s IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pages_pressure_idx
ON pages(state, locked_since_s, created_at_s);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tombstones (
    path TEXT PRIMARY KEY COLLATE BINARY,
    frozen_at_s INTEGER NOT NULL,
    blocked_until_s INTEGER NOT NULL,
    CHECK (blocked_until_s > frozen_at_s)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tombstones_expiry_idx
ON tombstones(blocked_until_s);
--> statement-breakpoint
-- One row per path and hour, not one row per request.
-- Keep >=72 hours of buckets to evaluate two complete UTC days after midnight.
CREATE TABLE IF NOT EXISTS page_hits (
    path TEXT NOT NULL,
    hour_start_s INTEGER NOT NULL,
    accepted_reads INTEGER NOT NULL DEFAULT 0 CHECK (accepted_reads >= 0),
    PRIMARY KEY (path, hour_start_s),
    FOREIGN KEY (path) REFERENCES pages(path) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS page_hits_expiry_idx ON page_hits(hour_start_s);
--> statement-breakpoint
-- A deleted key cannot be recreated during its 7-day freeze period.
CREATE TRIGGER IF NOT EXISTS page_prevent_frozen_create
BEFORE INSERT ON pages
WHEN EXISTS (
    SELECT 1 FROM tombstones
    WHERE path = NEW.path
      AND blocked_until_s > CAST(strftime('%s', 'now') AS INTEGER)
)
BEGIN
    SELECT RAISE(ABORT, 'path_frozen');
END;
--> statement-breakpoint
-- Logical quota is enforced by database constraints/triggers, not just app checks.
CREATE TRIGGER IF NOT EXISTS page_before_insert_quota
BEFORE INSERT ON pages
WHEN EXISTS (
    SELECT 1 FROM usage_quota
    WHERE id = 1 AND (
        used_pages + 1 > max_pages
        OR used_content_bytes + NEW.content_bytes > max_content_bytes
    )
)
BEGIN
    SELECT RAISE(ABORT, 'quota_exceeded');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS page_after_insert_usage
AFTER INSERT ON pages
BEGIN
    UPDATE usage_quota
       SET used_pages = used_pages + 1,
           used_content_bytes = used_content_bytes + NEW.content_bytes
     WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS page_before_update_quota
BEFORE UPDATE OF content_md, content_bytes ON pages
WHEN EXISTS (
    SELECT 1 FROM usage_quota
    WHERE id = 1 AND (
        used_content_bytes + NEW.content_bytes - OLD.content_bytes > max_content_bytes
    )
)
BEGIN
    SELECT RAISE(ABORT, 'quota_exceeded');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS page_after_update_usage
AFTER UPDATE OF content_md, content_bytes ON pages
BEGIN
    UPDATE usage_quota
       SET used_content_bytes = used_content_bytes
                              + NEW.content_bytes - OLD.content_bytes
     WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS page_after_delete_usage
AFTER DELETE ON pages
BEGIN
    UPDATE usage_quota
       SET used_pages = used_pages - 1,
           used_content_bytes = used_content_bytes - OLD.content_bytes
     WHERE id = 1;
END;
--> statement-breakpoint
-- ALL application-side physical DELETEs freeze the key (including pressure GC and
-- scheduled 2-day GC). Only the private operator maintenance path may override.
-- Exact 7*86400 seconds. Uses DB clock; time is never provided by the caller.
CREATE TRIGGER IF NOT EXISTS page_after_delete_tombstone
AFTER DELETE ON pages
BEGIN
    INSERT INTO tombstones(path, frozen_at_s, blocked_until_s)
    VALUES (
        OLD.path,
        CAST(strftime('%s', 'now') AS INTEGER),
        CAST(strftime('%s', 'now') AS INTEGER) + 604800
    )
    ON CONFLICT(path) DO UPDATE SET
        frozen_at_s = excluded.frozen_at_s,
        blocked_until_s = excluded.blocked_until_s;
END;
--> statement-breakpoint
-- Revisions must not be reused when a frozen path is recreated (ABA protection).
-- This singleton survives page deletion. Treat revisions as opaque numbers;
-- updates may skip numbers because the sequence is shared across all pages.
CREATE TABLE IF NOT EXISTS revision_clock (
  id INTEGER PRIMARY KEY CHECK(id=1),
  value INTEGER NOT NULL CHECK(value>=0 AND value<=9007199254740991)
);
--> statement-breakpoint
INSERT OR IGNORE INTO revision_clock(id,value)
SELECT 1,COALESCE(MAX(version),0) FROM pages;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS revision_after_insert AFTER INSERT ON pages
BEGIN
  UPDATE revision_clock SET value=MAX(value,NEW.version) WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS revision_after_update AFTER UPDATE OF content_md ON pages
BEGIN
  UPDATE revision_clock SET value=MAX(value,NEW.version) WHERE id=1;
END;
--> statement-breakpoint
-- D1-backed anonymous rate limiting and bounded request-driven maintenance for Sites.
CREATE TABLE IF NOT EXISTS request_limits (
    scope TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    window_start_s INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 1),
    PRIMARY KEY (scope, key_hash)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_limits_expiry_idx ON request_limits(window_start_s);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS maintenance_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    run_after_s INTEGER NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO maintenance_state(id, run_after_s) VALUES (1, 0);
