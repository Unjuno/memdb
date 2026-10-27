// Test a disposable local Wrangler Worker + D1. Never write to production.
// Requires tests/fixtures/policy-c.sql to have been applied after migrations.
import assert from 'node:assert/strict';
const origin=process.env.MEMDB_SMOKE_ORIGIN;
let url;
try {url=new URL(origin);}catch{throw new Error('MEMDB_SMOKE_ORIGIN must be a URL');}
if(url.origin!==origin||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))
  throw new Error('Refusing non-local smoke target');
let steps=0;
async function req(path,method='GET',body,headers={}) {
 const response=await fetch(origin+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const ct=response.headers.get('content-type')||'';
 const text=await response.text();
 return {status:response.status, data:ct.includes('application/json')?JSON.parse(text):text,headers:response.headers};
}
async function isStatus(path,expected) {const x=await req(path);assert.equal(x.status,expected,JSON.stringify(x.data));steps++;return x;}
const home=await isStatus('/',200);
assert.match(home.data,/<html lang="en">/);
assert.match(home.headers.get('content-security-policy'),/default-src 'none'/);
const initial=await isStatus('/api/status/fixture/hot',200);
assert.equal(initial.data.state,'write_locked');assert.equal(initial.data.reads_24h,300);
const cold=await isStatus('/api/status/fixture/cold',200);
assert.equal(cold.data.state,'active');
const rejected=await req('/api/pages/fixture/too-big','PUT',{markdown:'xxxx',expected_version:0});
assert.equal(rejected.status,507,JSON.stringify(rejected.data));steps++;
assert.equal((await isStatus('/api/status/fixture/hot',200)).data.exists,true);
const created=await req('/api/pages/fixture/new','PUT',{markdown:'new',expected_version:0});
assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.content_md,'new');steps++;
const frozen=await isStatus('/api/status/fixture/hot',200);
assert.equal(frozen.data.state,'frozen');
assert.equal((await isStatus('/api/status/fixture/cold',200)).data.exists,true);
const raw=await isStatus('/raw/fixture/new',200);
assert.equal(raw.data,'new');
const grow=await req('/api/append/fixture/new','POST',{markdown:'!'});
assert.equal(grow.status,507,JSON.stringify(grow.data));steps++;
const noEligible=await req('/api/pages/fixture/another','PUT',{markdown:'x',expected_version:0});
assert.equal(noEligible.status,507,JSON.stringify(noEligible.data));steps++;
assert.equal((await isStatus('/api/status/fixture/new',200)).data.version,created.data.version);
const preview=await req('/api/preview','POST',{markdown:'<script>alert(1)</script>'});
assert.equal(preview.status,200);assert.match(preview.data.html,/&lt;script&gt;/);steps++;
const forbidden=await req('/api/status/fixture/cold','GET',undefined,{Origin:'https://evil.example'});
assert.equal(forbidden.status,403);steps++;
if(process.env.MEMDB_SKIP_MCP_SMOKE!=='1') {
 let id=0;
 const rpc=async(method,params)=>{
   const result=await req('/mcp','POST',{jsonrpc:'2.0',id:++id,method,params},
     {Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'});
   assert.equal(result.status,200,JSON.stringify(result.data));steps++;
   if(typeof result.data==='string' && result.headers.get('content-type')?.includes('text/event-stream')){
     const data=result.data.split('\n').find(x=>x.startsWith('data:'));
     return JSON.parse(data.slice(5).trim());
   }
   return result.data;
 };
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'worker-smoke',version:'1.0'}});
 assert.equal(init.result.serverInfo.name,'memdb');
 const list=await rpc('tools/list',{});
 assert.deepEqual(list.result.tools.map(x=>x.name).sort(),['append_page','get_page_status','read_page','save_page']);
 const status=await rpc('tools/call',{name:'get_page_status',arguments:{path:'fixture/new'}});
 assert.equal(JSON.parse(status.result.content[0].text).content_bytes,3);
}
console.log(`PASS: ${steps} real HTTP/SQLite checks against ${origin}`);
