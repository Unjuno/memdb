import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const script = new URL('../scripts/check-release.mjs',import.meta.url).pathname;
const validDbId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
const consent = {MEMDB_APPROVE_PUBLIC_DEPLOY:'I_ACCEPT_PUBLIC_ANONYMOUS_WRITES', MEMDB_OPERATOR_BUDGET_CONFIRMED:'1'};
function check(candidate, env={}) {
 const dir=mkdtempSync(join(tmpdir(),'memdb-release-'));
 try{
  const path=join(dir,'wrangler.jsonc');writeFileSync(path,JSON.stringify(candidate));
  return spawnSync(process.execPath,[script,path],{encoding:'utf8',env:{...process.env,...env}});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
function production() {
 return {...config,vars:{PUBLIC_ORIGIN:'https://memdb.example.org'},d1_databases:[{...config.d1_databases[0],database_id:validDbId}],ratelimits:config.ratelimits.map((r,i)=>({...r,namespace_id:String(51000+i)}))};
}
test('release gate fails closed for checked-in placeholder config',()=>{
 const result=check(config,consent);assert.notEqual(result.status,0);assert.match(result.stderr,/PUBLIC_ORIGIN|database_id/);
});
test('release gate fails closed without explicit operator and public-write approval',()=>{
 const result=check(production());assert.notEqual(result.status,0);assert.match(result.stderr,/MEMDB_APPROVE_PUBLIC_DEPLOY|MEMDB_OPERATOR_BUDGET_CONFIRMED/);
});
test('release gate rejects invalid, duplicate or placeholder rate namespaces',()=>{
 for(const broken of [
  {...production(),ratelimits:production().ratelimits.map((r,i)=>({...r,namespace_id:i?'51000':'41001'}))},
  {...production(),ratelimits:production().ratelimits.slice(0,3)},
  {...production(),ratelimits:production().ratelimits.map(r=>({...r,simple:{limit:1000000,period:60}}))}
 ]) {
  const result=check(broken,consent);assert.notEqual(result.status,0);
 }
});
test('release gate accepts valid configuration after both explicit approvals',()=>{
 const result=check(production(),consent);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Deployment preflight passed/);
});

test('JSONC parser retains quoted URLs and handles comments/trailing commas', async () => {
 const {jsonc}=await import('../scripts/check-release.mjs');
 const obj=jsonc('{\n // safe comment\n "origin": "https://host.test/x//y", /* block */ "items": [1,2,],\n}');
 assert.deepEqual(obj,{origin:'https://host.test/x//y',items:[1,2]});
 assert.throws(()=>jsonc('{ "x": 1, /* unfinished'),/Unterminated/);
});

test('release guard does not accept absent maintenance cron or incorrect D1 binding',()=>{
 const first={...production(),triggers:{crons:[]}};
 const second={...production(),d1_databases:[{...production().d1_databases[0],binding:'WRONG'}]};
 assert.notEqual(check(first,consent).status,0);
 assert.notEqual(check(second,consent).status,0);
});
