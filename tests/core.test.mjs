import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, env } from './support.mjs';
const model = await import('../dist/model.js').catch(() => ({}));
const store = await import('../dist/store.js').catch(() => ({}));
const renderer = await import('../dist/markdown.js').catch(() => ({}));
const http = await import('../dist/http.js').catch(() => ({}));
const now = Math.floor(Date.now()/1000), hour = Math.floor(now/3600)*3600;
const rejects = (f, code) => assert.rejects(f, e => e.code === code);
function fixture() { const db = new LocalD1(); return { db, svc: new store.PageStore(db, () => now) }; }
function seed(db, path, body='old', hot=false) {
  db.sql.prepare(`INSERT INTO pages VALUES(?,?,?,1,?,?,?,?)`).run(path, body, Buffer.byteLength(body), hot?'write_locked':'active', now-90000, now-90000, hot?now-45000:null);
  if (hot) for(let i=0;i<6;i++) db.sql.prepare('INSERT INTO page_hits VALUES(?,?,50)').run(path,hour-i*3600);
}
function quota(db, pages, bytes) { db.sql.prepare('UPDATE usage_quota SET max_pages=?, max_content_bytes=?').run(pages,bytes); }
function rows(db, table) { return db.sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(r=>({...r})); }

// Tests are introduced before the implementation; optional imports expose explicit assertions.
test('validation API exists', () => assert.equal(typeof model.normalizePath, 'function'));
test('path NFC, Unicode and literal status segments', () => {
  assert.equal(model.normalizePath('cafe\u0301/e\u0301/status'), 'café/é/status');
  for(const key of ['', '/a','a/','a//b','../x','a/./b','a\\b','a\u0000','x%2Fz','a/'.repeat(8)+'b','€'.repeat(86),'\ud800']) assert.throws(()=>model.normalizePath(key));
});
test('URL segments decode exactly once and encoded slash is rejected', () => {
  assert.equal(model.decodePath('caf%C3%A9/a%3Fb'), 'café/a?b');
  for(const key of ['a%2Fb', 'a%252Fb','%ZZ','a/%2e%2e']) assert.throws(()=>model.decodePath(key));
});
test('missing reads and status do not allocate storage', async () => {
  const {db,svc}=fixture(); await rejects(()=>svc.read('new'),'NOT_FOUND');
  assert.equal((await svc.status('new')).state,'missing'); assert.equal(rows(db,'pages').length,0); assert.equal(rows(db,'page_hits').length,0); db.close();
});
test('create and CAS update use UTF-8 bytes; stale saves fail', async () => {
  const {db,svc}=fixture(); const a=await svc.save('a','€',0); assert.equal(a.content_bytes,3);
  assert.equal((await svc.save('a','€€',a.version)).version,2);
  await rejects(()=>svc.save('a','lost',1),'VERSION_CONFLICT'); assert.equal(rows(db,'usage_quota')[0].used_content_bytes,6); db.close();
});
test('empty, oversized, malformed content and versions fail before writes', async () => {
  const {db,svc}=fixture();
  for(const body of ['', 'a'.repeat(32769), '\ud800']) await assert.rejects(()=>svc.save('a',body,0));
  for(const v of [-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1]) await assert.rejects(()=>svc.save('a','valid',v));
  assert.equal(rows(db,'pages').length,0); db.close();
});
test('atomic append and CAS guards', async () => {
  const {db,svc}=fixture(); await svc.save('a','start',0);
  await Promise.all(Array.from({length:20},()=>svc.append('a','!')));
  assert.equal(rows(db,'pages')[0].content_md,'start'+'!'.repeat(20));
  await rejects(()=>svc.append('a','lost',1),'VERSION_CONFLICT'); db.close();
});
test('exactly one of 20 same-revision updates wins', async () => {
  const {db,svc}=fixture(); await svc.save('a','start',0);
  const outcomes=await Promise.allSettled(Array.from({length:20},(_,i)=>svc.save('a',String(i),1)));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1); assert.equal(rows(db,'pages')[0].version,2); db.close();
});
test('reads lock at 100, status does not increment and writes are blocked', async () => {
  const {db,svc}=fixture(); await svc.save('a','body',0);
  for(let i=0;i<100;i++) await svc.read('a');
  assert.equal((await svc.status('a')).state,'write_locked'); assert.equal((await svc.status('a')).reads_24h,100);
  await rejects(()=>svc.save('a','new',1),'WRITE_LOCKED'); db.close();
});
test('full capacity with cold pages refuses creation without changes', async () => {
  const {db,svc}=fixture(); seed(db,'cold'); quota(db,1,3);
  await rejects(()=>svc.save('new','x',0),'STORAGE_FULL'); assert.deepEqual(rows(db,'pages').map(p=>p.path),['cold']); assert.equal(rows(db,'tombstones').length,0); db.close();
});
test('Policy C evicts eligible hot page, keeps cold, freezes old path', async () => {
  const {db,svc}=fixture(); seed(db,'cold'); seed(db,'hot','123456',true); quota(db,2,9);
  await svc.save('new','abcd',0);
  assert.deepEqual(rows(db,'pages').map(p=>p.path),['cold','new']); assert.equal(rows(db,'usage_quota')[0].used_content_bytes,7);
  await rejects(()=>svc.save('hot','x',0),'PATH_FROZEN'); assert.equal((await svc.status('hot')).state,'frozen'); db.close();
});
test('insufficient eligible bytes delete nothing', async () => {
  const {db,svc}=fixture(); seed(db,'cold','abcdef'); seed(db,'hot','x',true); quota(db,2,7);
  await rejects(()=>svc.save('new','123',0),'STORAGE_FULL'); assert.equal(rows(db,'pages').length,2); assert.equal(rows(db,'tombstones').length,0); db.close();
});
test('candidate needs six distinct hours and twelve-hour lock', async () => {
  const {db,svc}=fixture(); seed(db,'hot','x',true); quota(db,1,1);
  db.sql.exec('DELETE FROM page_hits'); db.sql.prepare('INSERT INTO page_hits VALUES(?,?,300)').run('hot',hour);
  await rejects(()=>svc.save('new','x',0),'STORAGE_FULL'); assert.equal(rows(db,'pages')[0].path,'hot'); db.close();
});
test('failed INSERT rolls back eviction, hits, usage and tombstones', async () => {
  const {db,svc}=fixture(); seed(db,'hot','abc',true); quota(db,1,3);
  const before=rows(db,'pages');
  db.sql.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON pages WHEN NEW.path='new' BEGIN SELECT RAISE(ABORT, 'simulated_disk_failure'); END`);
  await rejects(()=>svc.save('new','x',0),'STORAGE_UNAVAILABLE');
  assert.deepEqual(rows(db,'pages'),before); assert.equal(rows(db,'page_hits').length,6); assert.equal(rows(db,'tombstones').length,0); assert.equal(rows(db,'usage_quota')[0].used_content_bytes,3); db.close();
});
test('race: if room was freed before batch, skip unnecessary eviction', async () => {
  const {db,svc}=fixture(); seed(db,'hot','abc',true); quota(db,1,3);
  db.beforeBatch=()=>quota(db,2,6); await svc.save('new','x',0);
  assert.equal(rows(db,'pages').length,2); assert.equal(rows(db,'tombstones').length,0); db.close();
});
test('existing growth cannot evict, shrinking remains possible', async () => {
  const {db,svc}=fixture(); seed(db,'cold','abc'); seed(db,'hot','abc',true); quota(db,2,6);
  await rejects(()=>svc.save('cold','abcd',1),'STORAGE_FULL'); assert.equal(rows(db,'pages').length,2);
  await svc.save('cold','x',1); assert.equal(rows(db,'usage_quota')[0].used_content_bytes,4); db.close();
});
test('oversized append preserves original and quota', async () => {
  const {db,svc}=fixture(); await svc.save('a','x'.repeat(32768),0);
  await rejects(()=>svc.append('a','!'),'PAGE_TOO_LARGE'); assert.equal(rows(db,'pages')[0].version,1); db.close();
});
test('scheduled GC checks each full UTC day, not total sum', async () => {
  const {db,svc}=fixture(); seed(db,'delete'); seed(db,'keep'); const day=Math.floor(now/86400)*86400;
  for(const [p,d,h] of [['delete',2,300],['delete',1,300],['keep',2,599],['keep',1,1]]) db.sql.prepare('INSERT INTO page_hits VALUES(?,?,?)').run(p,day-d*86400,h);
  await svc.maintenance(); assert.deepEqual(rows(db,'pages').map(p=>p.path),['keep']); assert.equal(rows(db,'tombstones')[0].path,'delete'); db.close();
});
test('maintenance unlocks quiet page only after minimum duration', async () => {
  const {db,svc}=fixture(); seed(db,'quiet','body',true); db.sql.exec('DELETE FROM page_hits');
  await svc.maintenance(); assert.equal(rows(db,'pages')[0].state,'active'); db.close();
});
test('Markdown renders safe subset without executing HTML or unsafe links',()=>{
  const html=renderer.renderMarkdown('# Title\n\n**bold** and `code`\n\n- item\n\n```js\n<script>x</script>\n```\n\n<script>alert(1)</script>\n[x](javascript:alert)\n[safe](https://example.org)');
  assert.match(html,/<h1>Title<\/h1>/); assert.match(html,/<strong>bold<\/strong>/); assert.match(html,/<ul>/);
  assert.doesNotMatch(html,/<script|href="javascript:|<img/i); assert.match(html,/&lt;script&gt;/); assert.match(html,/rel="noopener noreferrer"/);
});

function req(path, method='GET', body, headers={}) {
  return new Request('https://memdb.test'+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
test('HTTP handler exists',()=>assert.equal(typeof http.handleRequest,'function'));
test('browser shell allocates no page; CSP and no public listing',async()=>{
  const db=new LocalD1(),e=env(db); const res=await http.handleRequest(req('/p/new'),e);
  assert.equal(res.status,200); assert.match(res.headers.get('content-security-policy'),/script-src 'self'/);
  assert.match(await res.text(),/textarea/); assert.equal(rows(db,'pages').length,0);
  assert.equal((await http.handleRequest(req('/api/pages'),e)).status,404); db.close();
});
test('browser UI and client feedback are English-only', async () => {
  const db = new LocalD1(), e = env(db);
  const home = await (await http.handleRequest(req('/'), e)).text();
  const page = await (await http.handleRequest(req('/p/research/experiment-01'), e)).text();
  const script = await (await http.handleRequest(req('/assets/app.js'), e)).text();
  assert.match(home, /<html lang="en">/);
  assert.match(home, /Open a page/);
  assert.match(home, /Page path/);
  assert.match(home, /Anyone can read and edit/);
  assert.match(page, /Markdown content/);
  assert.match(page, /Reload \(counts as a read\)/);
  assert.match(script, /Saved successfully/);
  assert.match(script, /The page has changed/);
  for (const content of [home, page, script]) assert.doesNotMatch(content, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.equal(rows(db, 'pages').length, 0);
  db.close();
});

test('HTTP create, read, status, append and raw share a literal path',async()=>{
  const db=new LocalD1(),e=env(db),path='caf%C3%A9/status';
  let res=await http.handleRequest(req('/api/pages/'+path,'PUT',{markdown:'# Test',expected_version:0}),e);
  assert.equal(res.status,201); const page=await res.json();assert.equal(page.version,1);
  res=await http.handleRequest(req('/api/pages/'+path),e);assert.equal((await res.json()).content_md,'# Test');
  res=await http.handleRequest(req('/api/status/'+path),e);assert.equal((await res.json()).reads_24h,1);
  res=await http.handleRequest(req('/api/append/'+path,'POST',{markdown:'\ntext',expected_version:1}),e);assert.equal((await res.json()).version,2);
  res=await http.handleRequest(req('/raw/'+path),e);assert.equal(await res.text(),'# Test\ntext');assert.equal(res.headers.get('x-memdb-version'),'2');
  assert.equal(rows(db,'page_hits')[0].accepted_reads,2);db.close();
});
test('HTTP conflict leaves edited page untouched',async()=>{
  const db=new LocalD1(),e=env(db); seed(db,'a');
  const res=await http.handleRequest(req('/api/pages/a','PUT',{markdown:'lost',expected_version:0}),e);
  assert.equal(res.status,409);assert.equal(rows(db,'pages')[0].content_md,'old');db.close();
});
test('foreign Origin, Host and cross-site data fetches rejected',async()=>{
  const db=new LocalD1(),e=env(db);
  for(const headers of [{Origin:'https://evil.test'},{Host:'evil.test'},{'Sec-Fetch-Site':'cross-site'}]) {
    const res=await http.handleRequest(req('/api/pages/a','GET',undefined,headers),e);assert.equal(res.status,403);
  }
  assert.equal(rows(db,'page_hits').length,0);db.close();
});
test('missing deployment origin and failed rate bindings fail closed',async()=>{
  const db=new LocalD1(); let e=env(db);e.PUBLIC_ORIGIN='';
  assert.equal((await http.handleRequest(req('/'),e)).status,503);
  e=env(db);e.REQUEST_LIMITER={async limit(){return {success:false}}};
  assert.equal((await http.handleRequest(req('/api/pages/a'),e)).status,429);
  e.REQUEST_LIMITER=undefined;assert.equal((await http.handleRequest(req('/'),e)).status,503);db.close();
});
test('rejected reads do not increment; Web and MCP share operation gate',async()=>{
  const db=new LocalD1(),e=env(db); seed(db,'a');e.READ_LIMITER={async limit(){return {success:false}}};
  assert.equal((await http.handleRequest(req('/api/pages/a'),e)).status,429);assert.equal(rows(db,'page_hits').length,0);db.close();
});
test('JSON type, malformed JSON, streamed size and content encoding are bounded',async()=>{
  const db=new LocalD1(),e=env(db);
  const cases=[['{',{},400],['{}',{'Content-Type':'text/plain'},415],['x'.repeat(204801),{},413],['{}',{'Content-Encoding':'gzip'},415],['[]',{},400]];
  for(const [body,headers,status] of cases) assert.equal((await http.handleRequest(req('/api/pages/a','PUT',body,headers),e)).status,status);
  assert.equal(rows(db,'pages').length,0);db.close();
});
test('preview does not count or allocate, untrusted HTML stays escaped',async()=>{
  const db=new LocalD1(),e=env(db);const res=await http.handleRequest(req('/api/preview','POST',{markdown:'<script>x</script>'}),e);
  assert.equal(res.status,200);assert.doesNotMatch((await res.json()).html,/<script>/);assert.equal(rows(db,'pages').length,0);db.close();
});
test('API disallows malformed paths and unsupported methods',async()=>{
  const db=new LocalD1(),e=env(db);
  for(const path of ['a%2Fb','a%252Fb','a//b'])assert.equal((await http.handleRequest(req('/api/pages/'+path),e)).status,400);
  assert.equal((await http.handleRequest(req('/api/pages/a','DELETE'),e)).status,405);db.close();
});
test('MCP routing preserves the bounded request and delegates to adapter',async()=>{
  const db=new LocalD1(),e=env(db);let called=false;
  const res=await http.handleRequest(req('/mcp','POST',{jsonrpc:'2.0',id:1,method:'ping'}),e,async request=>{
    called=true;assert.equal((await request.json()).method,'ping');return Response.json({jsonrpc:'2.0',id:1,result:{}});
  });assert.equal(res.status,200);assert.equal(called,true);db.close();
});
test('expired frozen path recreation rejects a stale revision from its previous lifetime',async()=>{
  const {db,svc}=fixture();const old=await svc.save('same','first lifetime',0);
  db.sql.exec("DELETE FROM pages WHERE path='same'");
  db.sql.exec("UPDATE tombstones SET frozen_at_s=0,blocked_until_s=1");
  await svc.maintenance();await svc.save('same','second lifetime',0);
  await rejects(()=>svc.save('same','stale overwrite',old.version),'VERSION_CONFLICT');
  assert.equal(rows(db,'pages')[0].content_md,'second lifetime');db.close();
});
