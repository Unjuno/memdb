import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const module = await import('../scripts/production-config.mjs').catch(() => ({}));
const runner = await import('../scripts/deploy.mjs').catch(() => ({}));
const template = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const settings = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  MEMDB_DATABASE_ID: 'a1b2c3d4-1234-4abc-8def-0123456789ab',
  MEMDB_PUBLIC_ORIGIN: 'https://memdb.operator.workers.dev',
  MEMDB_RATE_NAMESPACE_BASE: '61000',
  MEMDB_APPROVE_PUBLIC_DEPLOY: 'I_ACCEPT_PUBLIC_ANONYMOUS_WRITES',
  MEMDB_OPERATOR_BUDGET_CONFIRMED: '1'
};
test('production config and exact-config deploy entry points exist', () => {
  assert.equal(typeof module.productionConfig, 'function');
  assert.equal(typeof runner.prepareDeployment, 'function');
});
test('production config excludes credentials, preserves limits, uses assigned namespaces', () => {
  const config = module.productionConfig(template, {...settings, CLOUDFLARE_API_TOKEN:'secret-not-for-config'});
  assert.equal(config.account_id, settings.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(config.vars.PUBLIC_ORIGIN, settings.MEMDB_PUBLIC_ORIGIN);
  assert.equal(config.d1_databases[0].database_id, settings.MEMDB_DATABASE_ID);
  assert.deepEqual(config.ratelimits.map(r => r.namespace_id), ['61000','61001','61002','61003']);
  assert.equal(config.ratelimits[0].simple.limit, 1200);
  assert.ok(!JSON.stringify(config).includes('secret-not-for-config'));
  assert.equal(template.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000');
});
test('production config rejects missing settings, namespace overflow and wrong Worker host', () => {
  for (const key of ['CLOUDFLARE_ACCOUNT_ID','MEMDB_DATABASE_ID','MEMDB_PUBLIC_ORIGIN','MEMDB_RATE_NAMESPACE_BASE']) {
    assert.throws(() => module.productionConfig(template, {...settings,[key]:''}));
  }
  for (const bad of ['0','-1','41001','1e6',String(Number.MAX_SAFE_INTEGER)]) {
    assert.throws(() => module.productionConfig(template, {...settings,MEMDB_RATE_NAMESPACE_BASE:bad}));
  }
  assert.throws(() => module.productionConfig(template, {...settings,MEMDB_PUBLIC_ORIGIN:'https://other.operator.workers.dev'}));
});
test('deploy preflight validates the exact file passed to migration and deployment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memdb-config-'));
  try {
    const path = join(dir, 'production.json');
    writeFileSync(path, JSON.stringify(module.productionConfig(template, settings)));
    const plan = runner.prepareDeployment(path, settings);
    assert.deepEqual(plan.commands, [
      ['d1','migrations','apply','memdb','--remote','--config',path],
      ['deploy','--config',path]
    ]);
    assert.throws(() => runner.prepareDeployment(path, {...settings,MEMDB_OPERATOR_BUDGET_CONFIRMED:''}));
    writeFileSync(path, JSON.stringify(template));
    assert.throws(() => runner.prepareDeployment(path, settings));
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
