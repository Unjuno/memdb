import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function splitSql(source) {
  const statements = [];
  let statement = '', quote = '', lineComment = false, blockComment = false;
  let trigger = false, cases = 0, word = '';
  const finishWord = () => {
    if (!word) return;
    const upper = word.toUpperCase();
    if (!trigger && /\bCREATE\s+(?:TEMP\s+)?TRIGGER\s*$/i.test(statement)) trigger = true;
    if (trigger && upper === 'CASE') cases++;
    if (trigger && upper === 'END') {
      if (cases) cases--;
      else trigger = 'ending';
    }
    word = '';
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (lineComment) { statement += char; if (char === '\n') lineComment = false; continue; }
    if (blockComment) { statement += char; if (char === '*' && next === '/') { statement += next; i++; blockComment = false; } continue; }
    if (quote) { statement += char; if (char === quote) { if (next === quote) { statement += next; i++; } else quote = ''; } continue; }
    if (char === '-' && next === '-') { finishWord(); statement += char + next; i++; lineComment = true; continue; }
    if (char === '/' && next === '*') { finishWord(); statement += char + next; i++; blockComment = true; continue; }
    if (char === "'" || char === '"' || char === '`') { finishWord(); quote = char; statement += char; continue; }
    if (/[A-Za-z_]/.test(char)) { word += char; statement += char; continue; }
    finishWord();
    statement += char;
    if (char === ';' && (!trigger || trigger === 'ending')) {
      const trimmed = statement.trim();
      if (trimmed && !/\bPRAGMA\s+foreign_keys\s*=\s*ON\s*;?$/i.test(trimmed)) statements.push(trimmed);
      statement = ''; trigger = false; cases = 0;
    }
  }
  finishWord();
  if (statement.trim()) throw new Error('Migration contains an incomplete SQL statement.');
  return statements;
}

export function prepareSitesMigrations(root) {
  const migrations = path.join(root, 'migrations');
  const sources = ['0001_initial.sql', '0002_revision_clock.sql', '0003_sites_runtime.sql']
    .map(file => readFileSync(path.join(migrations, file), 'utf8'));
  const statements = sources.flatMap(splitSql);
  if (!statements.length) throw new Error('No Sites D1 migrations were generated.');
  const target = path.join(root, 'drizzle');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, 'meta'), { recursive: true });
  const tag = '0000_memdb_initial';
  writeFileSync(path.join(target, `${tag}.sql`), `${statements.join('\n--> statement-breakpoint\n')}\n`);
  const capacityTag = '0001_sites_capacity';
  writeFileSync(path.join(target, `${capacityTag}.sql`), [
    '-- Sites documents a per-Site D1 maximum of 10 GB. Reserve 20% for SQLite metadata, indexes, hit buckets and tombstones.',
    'UPDATE usage_quota SET max_pages=244140, max_content_bytes=8000000000 WHERE id=1;',
  ].join('\n'));
  writeFileSync(path.join(target, 'meta/_journal.json'), `${JSON.stringify({
    version: '7', dialect: 'sqlite', entries: [
      { idx: 0, version: '7', when: 1793145600000, tag, breakpoints: true },
      { idx: 1, version: '7', when: 1793145900000, tag: capacityTag, breakpoints: true },
    ],
  }, null, 2)}\n`);
  return statements.length;
}
