import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { prepareSitesMigrations } from './sites-migrations.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'server'), { recursive: true });
mkdirSync(path.join(dist, '.openai'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/sites.ts')],
  outfile: path.join(dist, 'server/index.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
});
const source = readFileSync(path.join(dist, 'server/index.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = await import(moduleUrl);
if (typeof worker.default?.fetch !== 'function') throw new Error('Sites Worker bundle must export default.fetch.');
copyFileSync(path.join(root, '.openai/hosting.json'), path.join(dist, '.openai/hosting.json'));
prepareSitesMigrations(root);
console.log('Built the MEMDB Sites Worker bundle.');
