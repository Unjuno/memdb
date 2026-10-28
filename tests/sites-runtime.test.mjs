import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { D1RateLimiter } from '../dist/sites.js';
import { LocalD1 } from './support.mjs';

test('Sites D1 rate limiter enforces atomic fixed windows and does not store input keys', async () => {
  const db = new LocalD1(); let now = 120;
  const limiter = new D1RateLimiter(db, 'write', 2, 60, () => now);
  assert.equal((await limiter.limit({ key: '秘密/alpha' })).success, true);
  assert.equal((await limiter.limit({ key: '秘密/alpha' })).success, true);
  assert.equal((await limiter.limit({ key: '秘密/alpha' })).success, false);
  const rows = db.sql.prepare('SELECT key_hash,count FROM request_limits').all();
  assert.equal(rows.length, 1); assert.match(rows[0].key_hash, /^[a-f0-9]{64}$/);
  now = 180;
  assert.equal((await limiter.limit({ key: '秘密/alpha' })).success, true);
  db.close();
});

test('Sites migrations apply atomically and leave 20 percent below the documented 10 GB ceiling', () => {
  const db = new DatabaseSync(':memory:');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) {
    const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) db.exec(statement);
  }
  const quota = db.prepare('SELECT max_pages,max_content_bytes FROM usage_quota WHERE id=1').get();
  assert.deepEqual({ max_pages: quota.max_pages, max_content_bytes: quota.max_content_bytes }, {
    max_pages: 244140, max_content_bytes: 8_000_000_000,
  });
  db.close();
});
