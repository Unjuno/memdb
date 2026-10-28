import { handleMcp } from './mcp.js';
import { handleRequest } from './http.js';
import { PageStore } from './store.js';
import type { Database, Env, Limiter } from './model.js';

interface SiteBindings { DB: Database }

/** D1-backed replacement for the Cloudflare-only rate-limit binding. Keys are
 * hashed so probes for missing page names are not copied into a second table.
 */
export class D1RateLimiter implements Limiter {
  constructor(
    private readonly db: Database,
    private readonly scope: string,
    private readonly limitCount: number,
    private readonly periodSeconds: number,
    private readonly clock = () => Math.floor(Date.now() / 1000),
  ) {}

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.key));
    const keyHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const now = this.clock();
    const bucket = Math.floor(now / this.periodSeconds) * this.periodSeconds;
    const row = await this.db.prepare(`INSERT INTO request_limits(scope,key_hash,window_start_s,count)
      VALUES(?,?,?,1) ON CONFLICT(scope,key_hash) DO UPDATE SET
        window_start_s=excluded.window_start_s,
        count=CASE WHEN request_limits.window_start_s=excluded.window_start_s THEN request_limits.count+1 ELSE 1 END
      WHERE request_limits.window_start_s<>excluded.window_start_s OR request_limits.count<?
      RETURNING count`).bind(this.scope, keyHash, bucket, this.limitCount).first<{ count: number }>();
    return { success: row !== null };
  }
}

async function runMaintenance(db: Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const claimed = await db.prepare(`UPDATE maintenance_state SET run_after_s=?
    WHERE id=1 AND run_after_s<=? RETURNING id`).bind(now + 300, now).first<{ id: number }>();
  if (claimed) await new PageStore(db).maintenance();
}

export default {
  async fetch(request: Request, bindings: SiteBindings): Promise<Response> {
    const limiter = (scope: string, max: number, period: number): Limiter => new D1RateLimiter(bindings.DB, scope, max, period);
    const env: Env = {
      DB: bindings.DB,
      // Sites fixes the worker origin. Deriving it from the canonical request
      // URL keeps the same-origin defense without a per-site secret setting.
      PUBLIC_ORIGIN: new URL(request.url).origin,
      REQUEST_LIMITER: limiter('request', 1200, 60),
      READ_LIMITER: limiter('read', 60, 60),
      WRITE_LIMITER: limiter('write', 10, 60),
      CREATE_LIMITER: limiter('create', 20, 60),
    };
    try { await runMaintenance(bindings.DB); } catch { /* bounded best-effort housekeeping */ }
    return handleRequest(request, env, handleMcp);
  },
};
