/** Generate non-secret deployment configuration. Never provision resources here. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonc, validateRelease } from './check-release.mjs';

export function productionConfig(template, env) {
  if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '')) throw new Error('CLOUDFLARE_ACCOUNT_ID must be 32 hexadecimal characters');
  const origin = env.MEMDB_PUBLIC_ORIGIN || '';
  if (!/^https:\/\/memdb\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(origin)) {
    throw new Error('MEMDB_PUBLIC_ORIGIN must be https://memdb.<your-subdomain>.workers.dev');
  }
  const raw = env.MEMDB_RATE_NAMESPACE_BASE || '', first = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(first) || first > Number.MAX_SAFE_INTEGER - 3) {
    throw new Error('MEMDB_RATE_NAMESPACE_BASE must be a positive safe integer with room for four namespaces');
  }
  const config = structuredClone(template);
  config.account_id = env.CLOUDFLARE_ACCOUNT_ID;
  config.vars = {...config.vars, PUBLIC_ORIGIN: origin};
  config.d1_databases[0].database_id = env.MEMDB_DATABASE_ID;
  config.ratelimits = config.ratelimits.map((r, i) => ({...r, namespace_id: String(first + i)}));
  config.workers_dev = true;
  const errors = validateRelease(config, env);
  if (errors.length) throw new Error(errors.join('; '));
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const template = jsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    const path = resolve('wrangler.production.json');
    writeFileSync(path, JSON.stringify(productionConfig(template, process.env), null, 2) + '\n', {mode:0o600});
    console.log('Created wrangler.production.json (configuration only; no resources created).');
  } catch (error) { console.error('Configuration blocked: ' + error.message); process.exitCode = 1; }
}
