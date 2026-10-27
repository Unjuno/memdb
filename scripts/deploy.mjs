/** Validate one exact config, then migrate and deploy it. No shell interpolation. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { jsonc, validateRelease } from './check-release.mjs';

export function prepareDeployment(configPath, env) {
  const path = resolve(configPath);
  const config = jsonc(readFileSync(path, 'utf8'));
  const errors = validateRelease(config, env);
  if (errors.length) throw new Error(errors.join('; '));
  if (env.CLOUDFLARE_ACCOUNT_ID && config.account_id !== env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Configured account does not match CLOUDFLARE_ACCOUNT_ID');
  }
  return {commands: [
    ['d1', 'migrations', 'apply', 'memdb', '--remote', '--config', path],
    ['deploy', '--config', path]
  ]};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('No command-line overrides allowed; select a file with MEMDB_CONFIG');
    const plan = prepareDeployment(process.env.MEMDB_CONFIG || 'wrangler.production.json', process.env);
    // Resolve the installed, locked Wrangler binary; never download an unpinned CLI.
    const pkg = JSON.parse(readFileSync(new URL('../node_modules/wrangler/package.json', import.meta.url), 'utf8'));
    const relativeBin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.wrangler;
    const bin = fileURLToPath(new URL('../node_modules/wrangler/' + relativeBin, import.meta.url));
    for (const args of plan.commands) {
      const child = spawnSync(process.execPath, [bin, ...args], {stdio:'inherit', env:process.env});
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error('Wrangler failed; remaining deployment steps stopped');
    }
  } catch (error) { console.error('Deployment blocked: ' + error.message); process.exitCode = 1; }
}
