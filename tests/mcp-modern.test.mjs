import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, env } from './support.mjs';
import { handleRequest } from '../dist/http.js';
import { handleMcp } from '../dist/mcp.js';

let sequence = 0;
async function modern(e, method, params = {}, headers = {}) {
  const id = ++sequence;
  const response = await handleRequest(new Request('https://memdb.test/mcp', {
    method: 'POST',
    headers: {'Content-Type':'application/json', Accept:'application/json, text/event-stream',
      'MCP-Protocol-Version':'2026-07-28', 'Mcp-Method':method,
      ...(params.name ? {'Mcp-Name':params.name} : {}), ...headers},
    body: JSON.stringify({jsonrpc:'2.0', id, method, params:{...params, _meta:{
      'io.modelcontextprotocol/protocolVersion':'2026-07-28',
      'io.modelcontextprotocol/clientCapabilities':{},
      'io.modelcontextprotocol/clientInfo':{name:'memdb-wire-client',version:'0.1.0'}
    }}})
  }), e, handleMcp);
  assert.equal(response.headers.get('mcp-session-id'), null);
  const wire = await response.json();
  assert.equal(response.status, 200, JSON.stringify(wire));
  assert.equal(wire.id, id);
  assert.ok(wire.result, JSON.stringify(wire));
  return wire.result;
}
const call = (e, name, args) => modern(e, 'tools/call', {name,arguments:args});
const data = result => JSON.parse(result.content[0].text);

test('modern discovery and tool list need no initialize or session', async () => {
  const db = new LocalD1(), e = env(db);
  try {
    const discovered = await modern(e, 'server/discover');
    assert.match(JSON.stringify(discovered), /2026-07-28/);
    const list = await modern(e, 'tools/list');
    assert.deepEqual(list.tools.map(t => t.name).sort(), ['append_page','get_page_status','read_page','save_page']);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM pages').get().n, 0);
  } finally { db.close(); }
});

test('modern direct calls share data and CAS rules without any handshake', async () => {
  const db = new LocalD1(), e = env(db);
  try {
    const saved = data(await call(e, 'save_page', {path:'modern/cafe',markdown:'# Note',expected_version:0}));
    const appended = data(await call(e, 'append_page', {path:saved.path,markdown:'\nNext',expected_version:saved.version}));
    const read = data(await call(e, 'read_page', {path:saved.path}));
    assert.equal(read.content_md, '# Note\nNext');
    assert.equal(read.untrusted, true);
    assert.equal(read.version, appended.version);
    const conflict = await call(e, 'save_page', {path:saved.path,markdown:'stale',expected_version:saved.version});
    assert.equal(conflict.isError, true);
    assert.equal(data(conflict).error.code, 'VERSION_CONFLICT');
    const status = data(await call(e, 'get_page_status', {path:saved.path}));
    assert.equal(status.reads_24h, 1);
  } finally { db.close(); }
});

test('modern missing-page tool errors are bounded and allocate nothing', async () => {
  const db = new LocalD1(), e = env(db);
  try {
    const result = await call(e, 'read_page', {path:'absent'});
    assert.equal(result.isError, true);
    assert.equal(data(result).error.code, 'NOT_FOUND');
    assert.doesNotMatch(JSON.stringify(result), /SELECT|SQLite|stack/);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM pages').get().n, 0);
  } finally { db.close(); }
});
