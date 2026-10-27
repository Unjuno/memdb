-- Test-only fixture. Apply after both migrations to a disposable local D1 instance.
-- No production database must ever load this file.
INSERT INTO pages(path,content_md,content_bytes,version,state,created_at_s,updated_at_s,locked_since_s)
VALUES('fixture/cold','cold',4,(SELECT value+1 FROM revision_clock WHERE id=1),'active',
       CAST(strftime('%s','now') AS INTEGER)-90000,CAST(strftime('%s','now') AS INTEGER)-90000,NULL);
INSERT INTO pages(path,content_md,content_bytes,version,state,created_at_s,updated_at_s,locked_since_s)
VALUES('fixture/hot','hot',3,(SELECT value+1 FROM revision_clock WHERE id=1),'write_locked',
       CAST(strftime('%s','now') AS INTEGER)-90000,CAST(strftime('%s','now') AS INTEGER)-90000,
       CAST(strftime('%s','now') AS INTEGER)-46800);
WITH RECURSIVE hours(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM hours WHERE n<5)
INSERT INTO page_hits(path,hour_start_s,accepted_reads)
SELECT 'fixture/hot',CAST(CAST(strftime('%s','now') AS INTEGER)/3600 AS INTEGER)*3600-n*3600,50 FROM hours;
UPDATE usage_quota SET max_pages=2,max_content_bytes=7 WHERE id=1;
