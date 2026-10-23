export interface Result<T = Record<string, unknown>> { results: T[]; success: boolean; }
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
  run<T = Record<string, unknown>>(): Promise<Result<T>>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T = Record<string, unknown>>(statements: Statement[]): Promise<Result<T>[]>;
}
export interface Page {
  path: string; content_md: string; content_bytes: number; version: number;
  state: 'active' | 'write_locked'; created_at_s: number; updated_at_s: number;
  locked_since_s: number | null;
}
export interface Limiter { limit(options: {key: string}): Promise<{success: boolean}>; }
export interface Env {
  DB: Database; PUBLIC_ORIGIN: string;
  REQUEST_LIMITER: Limiter; READ_LIMITER: Limiter; WRITE_LIMITER: Limiter; CREATE_LIMITER: Limiter;
}
const statuses: Record<string, number> = {
  INVALID_PATH: 400, INVALID_INPUT: 400, INVALID_JSON: 400, NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405, VERSION_CONFLICT: 409, PATH_FROZEN: 410,
  PAGE_TOO_LARGE: 413, REQUEST_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  WRITE_LOCKED: 423, RATE_LIMITED: 429, ORIGIN_DENIED: 403,
  STORAGE_FULL: 507, STORAGE_UNAVAILABLE: 503, CONFIGURATION_ERROR: 503
};
export class AppError extends Error {
  readonly status: number;
  constructor(public readonly code: string, public readonly details?: Record<string, unknown>) {
    super(code); this.name = 'AppError'; this.status = statuses[code] ?? 500;
  }
}
export const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
function wellFormed(text: string): boolean {
  return !Array.from(text).some(c => { const n = c.codePointAt(0)!; return n >= 0xd800 && n <= 0xdfff; });
}
export function normalizePath(value: unknown): string {
  if (typeof value !== 'string' || !wellFormed(value)) throw new AppError('INVALID_PATH');
  const path = value.normalize('NFC');
  const parts = path.split('/');
  if (!path || byteLength(path) > 256 || parts.length > 8 || /[\p{Cc}\\]/u.test(path)
    || /%[a-f\d]{2}/i.test(path) || parts.some(p => !p || p === '.' || p === '..')) throw new AppError('INVALID_PATH');
  return path;
}
export function decodePath(encoded: string): string {
  try {
    const segments = encoded.split('/').map(s => {
      const decoded = decodeURIComponent(s);
      if (decoded.includes('/')) throw new AppError('INVALID_PATH');
      return decoded;
    });
    return normalizePath(segments.join('/'));
  } catch { throw new AppError('INVALID_PATH'); }
}
export function validateMarkdown(value: unknown): string {
  if (typeof value !== 'string' || !value || !wellFormed(value)) throw new AppError('INVALID_INPUT');
  if (byteLength(value) > 32768) throw new AppError('PAGE_TOO_LARGE');
  return value;
}
export function validateVersion(value: unknown, optional = false): number | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AppError('INVALID_INPUT');
  return value;
}
export function dbError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // D1 may wrap SQLite errors in Error.cause. Never expose database diagnostics.
  let text = '', current = error;
  for (let i = 0; current && i < 4; i++) {
    text += String(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  if (text.includes('path_frozen')) return new AppError('PATH_FROZEN');
  if (text.includes('quota_exceeded')) return new AppError('STORAGE_FULL');
  if (text.includes('UNIQUE constraint failed: pages.path')) return new AppError('VERSION_CONFLICT');
  if (text.includes('CHECK constraint failed') && text.includes('content_bytes')) return new AppError('PAGE_TOO_LARGE');
  return new AppError('STORAGE_UNAVAILABLE');
}
