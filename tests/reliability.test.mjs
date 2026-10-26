import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, env } from './support.mjs';
import { PageStore } from '../dist/store.js';
import { handleRequest } from '../dist/http.js';

const origin = 'https://memdb.test';
function request(path, method = 'GET', body) {
  return new Request(origin + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
  });
}
function dbRows(db, table) { return db.sql.prepare(`SELECT * FROM ${table}`).all(); }
function assertQuotaConsistent(db) {
  const used = db.sql.prepare('SELECT * FROM usage_quota WHERE id=1').get();
  const exact = db.sql.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(content_bytes),0) AS bytes FROM pages').get();
  assert.equal(used.used_pages, exact.n);
  assert.equal(used.used_content_bytes, exact.bytes);
  assert.ok(used.used_pages <= used.max_pages);
  assert.ok(used.used_content_bytes <= used.max_content_bytes);
  const rows = dbRows(db, 'pages');
  for (const page of rows) assert.equal(page.content_bytes, Buffer.byteLength(page.content_md, 'utf8'));
  const rev = db.sql.prepare('SELECT value FROM revision_clock WHERE id=1').get().value;
  for (const page of rows) assert.ok(page.version <= rev);
}

test('preview rejects ill-formed Unicode without changing storage', async () => {
  const db = new LocalD1();
  try {
    const res = await handleRequest(request('/api/preview', 'POST', { markdown: '\ud800' }), env(db));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).error, { code: 'INVALID_INPUT' });
    assert.equal(dbRows(db, 'pages').length, 0);
    assert.equal(dbRows(db, 'page_hits').length, 0);
  } finally { db.close(); }
});

test('preview of empty new page remains valid and allocates nothing', async () => {
  const db = new LocalD1();
  try {
    const res = await handleRequest(request('/api/preview', 'POST', { markdown: '' }), env(db));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).html, '');
    assertQuotaConsistent(db);
    assert.equal(dbRows(db, 'pages').length, 0);
  } finally { db.close(); }
});

test('old reads expire; lock lifts without deleting cold page', async () => {
  const db = new LocalD1();
  try {
    let now = Math.floor(Date.now() / 3600000) * 3600;
    const store = new PageStore(db, () => now);
    await store.save('quiet-after-peak', 'hello', 0);
    for (let i=0; i<100; i++) await store.read('quiet-after-peak');
    assert.equal((await store.status('quiet-after-peak')).state, 'write_locked');
    now += 26*3600;
    await store.maintenance();
    const status = await store.status('quiet-after-peak');
    assert.equal(status.exists, true);
    assert.equal(status.state, 'active');
    assert.equal(status.reads_24h, 0);
    assertQuotaConsistent(db);
  } finally { db.close(); }
});

test('quota and revisions remain consistent across 250 deterministic mixed operations', async () => {
  const db = new LocalD1();
  try {
    db.sql.exec('UPDATE usage_quota SET max_pages=6,max_content_bytes=120');
    const store = new PageStore(db);
    let seed=0x11c0ffee;
    const pick=(n)=>{seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed>>>0)%n;};
    for(let i=0;i<250;i++){
      const key=`item-${pick(12)}`;
      const status=await store.status(key);
      const body='€'.repeat(1+pick(9));
      const action=pick(4);
      try{
        if(action===0) await store.read(key);
        else if(action===1) await store.save(key, body, status.exists ? status.version : 0);
        else if(action===2) await store.append(key, body, status.exists ? status.version : 0);
        else await store.status(key);
      }catch(error){
        assert.ok(['STORAGE_FULL','NOT_FOUND','WRITE_LOCKED','PAGE_TOO_LARGE','VERSION_CONFLICT'].includes(error.code),`Unexpected: ${error.code}`);
      }
      assertQuotaConsistent(db);
    }
  } finally { db.close(); }
});
