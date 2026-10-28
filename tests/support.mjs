import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Real SQL and transactions; this is NOT the Cloudflare D1 runtime.
export class LocalD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    this.sql.exec(readFileSync(new URL('../migrations/0002_revision_clock.sql', import.meta.url), 'utf8'));
    this.sql.exec(readFileSync(new URL('../migrations/0003_sites_runtime.sql', import.meta.url), 'utf8'));
    this.beforeBatch = undefined;
  }
  prepare(sql) {
    const db = this;
    const stmt = (values = []) => ({
      bind(...args) { return stmt(args); },
      execute() {
        const q = db.sql.prepare(sql);
        const results = q.columns().length ? q.all(...values) : (q.run(...values), []);
        return { results, success: true, meta: {} };
      },
      async first() { return this.execute().results[0] ?? null; },
      async all() { return this.execute(); },
      async run() { return this.execute(); }
    });
    return stmt();
  }
  async batch(statements) {
    if (this.beforeBatch) { const f = this.beforeBatch; this.beforeBatch = undefined; f(); }
    this.sql.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.execute()); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  close() { this.sql.close(); }
}
export const allow = { async limit() { return { success: true }; } };
export function env(db) { return { DB: db, PUBLIC_ORIGIN: 'https://memdb.test', REQUEST_LIMITER: allow, READ_LIMITER: allow, WRITE_LIMITER: allow, CREATE_LIMITER: allow }; }
