/** Bounded, read-only deployment probe. No fixtures, page creation or counted reads. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.env.MEMDB_PUBLIC_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://')) {
  throw new Error('MEMDB_PUBLIC_ORIGIN must be an exact HTTPS origin');
}
const request = (path, options = {}) => fetch(origin + path, {
  ...options, redirect:'error', signal:AbortSignal.timeout(15000)
});
const home = await request('/');
assert.equal(home.status, 200);
assert.match(await home.text(), /<html lang="en">/);
assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
const key = 'release-probe/' + randomUUID();
const status = await request('/api/status/' + key);
assert.equal(status.status, 200);
assert.equal((await status.json()).exists, false);
const tools = await request('/mcp', {
  method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json, text/event-stream',
    'MCP-Protocol-Version':'2026-07-28', 'Mcp-Method':'tools/list'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:{
    'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{},
    'io.modelcontextprotocol/clientInfo':{name:'memdb-release-probe',version:'0.1.0'}
  }}})
});
assert.equal(tools.status, 200);
assert.deepEqual((await tools.json()).result.tools.map(t => t.name).sort(),
  ['append_page','get_page_status','read_page','save_page']);
const denied = await request('/api/status/' + key, {headers:{Origin:'https://foreign.invalid'}});
assert.equal(denied.status, 403);
console.log('PASS: four read-only HTTPS deployment probes; no pages created or read.');
