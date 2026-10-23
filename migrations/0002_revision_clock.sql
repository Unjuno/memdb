-- Revisions must not be reused when a frozen path is recreated (ABA protection).
-- This singleton survives page deletion. Treat revisions as opaque numbers;
-- updates may skip numbers because the sequence is shared across all pages.
CREATE TABLE IF NOT EXISTS revision_clock (
  id INTEGER PRIMARY KEY CHECK(id=1),
  value INTEGER NOT NULL CHECK(value>=0 AND value<=9007199254740991)
);
INSERT OR IGNORE INTO revision_clock(id,value)
SELECT 1,COALESCE(MAX(version),0) FROM pages;
CREATE TRIGGER IF NOT EXISTS revision_after_insert AFTER INSERT ON pages
BEGIN
  UPDATE revision_clock SET value=MAX(value,NEW.version) WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS revision_after_update AFTER UPDATE OF content_md ON pages
BEGIN
  UPDATE revision_clock SET value=MAX(value,NEW.version) WHERE id=1;
END;
