/** Fail-closed preflight for anonymous PUBLIC deployments. No Cloudflare API calls. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredLimits = new Map([
  ['REQUEST_LIMITER', 1200],
  ['READ_LIMITER', 60],
  ['WRITE_LIMITER', 10],
  ['CREATE_LIMITER', 20]
]);

// Minimal JSONC tokenizer: remove comments and trailing commas only outside quoted strings.
// The scanner never evaluates configuration as JavaScript.
export function jsonc(text) {
  let noComments = '', quoted=false, escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i], next=text[i+1];
    if(quoted) {
      noComments+=c;
      if(escaped) escaped=false;
      else if(c==='\\') escaped=true;
      else if(c==='"') quoted=false;
    } else if(c==='"') { quoted=true; noComments+=c; }
    else if(c==='/'&&next==='/') {
      while(i<text.length&&text[i]!=='\n')i++;
      if(i<text.length)noComments+='\n';
    } else if(c==='/'&&next==='*') {
      i+=2;
      while(i<text.length && !(text[i]==='*'&&text[i+1]==='/')) {
        if(text[i]==='\n')noComments+='\n';
        i++;
      }
      if(i===text.length)throw new Error('Unterminated JSONC comment');
      i++; // skip final slash
    } else noComments+=c;
  }
  if(quoted)throw new Error('Unterminated JSONC string');
  let clean='',inside=false,escape=false;
  for(let i=0;i<noComments.length;i++) {
    const c=noComments[i];
    if(inside){ clean+=c; if(escape) escape=false; else if(c==='\\')escape=true; else if(c==='"')inside=false; }
    else if(c==='"'){inside=true;clean+=c;}
    else if(c===','){
      let j=i+1;while(/\s/.test(noComments[j]||''))j++;
      if(noComments[j]!==']'&&noComments[j]!=='}')clean+=c;
    } else clean+=c;
  }
  return JSON.parse(clean);
}

export function validateRelease(config, env) {
  const reasons=[];
  const bad=(reason)=>reasons.push(reason);
  if(config.name!=='memdb')bad('Worker name must be memdb');
  const origin=config.vars?.PUBLIC_ORIGIN;
  try {
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.origin!==origin||!url.hostname.includes('.')||url.username||url.password||
      ['localhost','127.0.0.1'].includes(url.hostname))bad('PUBLIC_ORIGIN must be an exact public HTTPS origin');
  } catch {bad('PUBLIC_ORIGIN must be a valid public HTTPS origin');}
  const databases=config.d1_databases;
  if(!Array.isArray(databases)||databases.length!==1||databases[0]?.binding!=='DB'||databases[0]?.database_name!=='memdb')
    bad('Expected exactly one memdb D1 database bound as DB');
  const id=databases?.[0]?.database_id;
  if(typeof id!=='string'||!(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))||/^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(id))
    bad('D1 database_id must be a non-placeholder UUID');
  const limiters=config.ratelimits;
  if(!Array.isArray(limiters)||limiters.length!==requiredLimits.size)bad('Exactly four rate limit bindings are required');
  else {
    const names=new Set(), namespaces=new Set();
    for(const limiter of limiters) {
      if(!requiredLimits.has(limiter.name)||names.has(limiter.name))bad(`Unknown or duplicated limiter: ${limiter.name}`);
      names.add(limiter.name);
      const ns=limiter.namespace_id;
      if(typeof ns!=='string'||!/^\d+$/.test(ns)||Number(ns)<1||
          ['41001','41002','41003','41004'].includes(ns)||namespaces.has(ns))bad(`Invalid or reused limiter namespace: ${ns}`);
      namespaces.add(ns);
      const l=limiter.simple?.limit,period=limiter.simple?.period;
      if(!Number.isSafeInteger(l)||l<1||l>requiredLimits.get(limiter.name)||period!==60)
        bad(`Unsafe rate limit for ${limiter.name}`);
    }
    for(const name of requiredLimits.keys()) if(!names.has(name))bad(`Missing rate limit binding: ${name}`);
  }
  if(!Array.isArray(config.triggers?.crons)||config.triggers.crons.length===0)
    bad('Cron maintenance must remain enabled');
  if(env.MEMDB_APPROVE_PUBLIC_DEPLOY!=='I_ACCEPT_PUBLIC_ANONYMOUS_WRITES')
    bad('Set MEMDB_APPROVE_PUBLIC_DEPLOY=I_ACCEPT_PUBLIC_ANONYMOUS_WRITES');
  if(env.MEMDB_OPERATOR_BUDGET_CONFIRMED!=='1')
    bad('Set MEMDB_OPERATOR_BUDGET_CONFIRMED=1 after verifying provider budget controls');
  return reasons;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const path=resolve(process.argv[2]||fileURLToPath(new URL('../wrangler.jsonc',import.meta.url)));
    const errors=validateRelease(jsonc(readFileSync(path,'utf8')),process.env);
    if(errors.length) { console.error('Deployment blocked:\n- '+errors.join('\n- '));process.exitCode=1; }
    else console.log('Deployment preflight passed. Provider billing and runtime safety remain operator responsibilities.');
  }catch(error){console.error('Deployment blocked: invalid configuration: '+error.message);process.exitCode=1;}
}
