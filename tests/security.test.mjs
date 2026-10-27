import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, env } from './support.mjs';
import { handleRequest } from '../dist/http.js';
import { PageStore } from '../dist/store.js';

test('same-site subdomains cannot cause counted API or raw reads', async () => {
  const db = new LocalD1(), e = env(db), store = new PageStore(db);
  try {
    await store.save('protected', 'unchanged', 0);
    for (const route of ['/api/pages/protected', '/raw/protected']) {
      const r = await handleRequest(new Request('https://memdb.test' + route, {
        headers: {'Sec-Fetch-Site': 'same-site'}
      }), e);
      assert.equal(r.status, 403, route);
    }
    assert.equal((await store.status('protected')).reads_24h, 0);
  } finally { db.close(); }
});

test('same-origin browsers and metadata-free bots remain supported', async () => {
  const db = new LocalD1(), e = env(db), store = new PageStore(db);
  try {
    await store.save('public', 'text', 0);
    for (const headers of [{}, {'Sec-Fetch-Site':'same-origin'}, {'Sec-Fetch-Site':'none'}]) {
      assert.equal((await handleRequest(new Request('https://memdb.test/api/pages/public', {headers}), e)).status, 200);
    }
    assert.equal((await store.status('public')).reads_24h, 3);
  } finally { db.close(); }
});
