import { AppError, byteLength, dbError, normalizePath, validateMarkdown, validateVersion, type Database, type Page } from './model.js';
const HOUR = 3600, DAY = 86400;
interface Quota { used_pages: number; max_pages: number; used_content_bytes: number; max_content_bytes: number; }
interface Candidate { path: string; content_bytes: number; }
const LOCK_ONE = `UPDATE pages SET state='write_locked', locked_since_s=?
 WHERE path=? AND state='active' AND
 (SELECT COALESCE(SUM(accepted_reads),0) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ?) >=100`;

export class PageStore {
  constructor(private readonly db: Database, private readonly clock = () => Math.floor(Date.now()/1000)) {}
  private window() { const now=this.clock(), hour=Math.floor(now/HOUR)*HOUR; return {now, hour, first:hour-23*HOUR}; }
  async status(input: unknown) {
    const path=normalizePath(input), {now,first,hour}=this.window();
    const p=await this.db.prepare(`SELECT path,version,state,content_bytes,created_at_s,updated_at_s,locked_since_s,
      (SELECT COALESCE(SUM(accepted_reads),0) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ?) AS reads_24h
      FROM pages WHERE path=?`).bind(first,hour,path).first<Omit<Page,'content_md'> & {reads_24h:number}>();
    if(p) return {...p,exists:true,blocked_until_s:null};
    const t=await this.db.prepare('SELECT blocked_until_s FROM tombstones WHERE path=? AND blocked_until_s>?').bind(path,now).first<{blocked_until_s:number}>();
    return {path,exists:false,state:t?'frozen':'missing',version:0,reads_24h:0,blocked_until_s:t?.blocked_until_s??null};
  }
  private async missingOrConflict(path: string): Promise<never> {
    const s=await this.status(path);
    if(s.state==='frozen') throw new AppError('PATH_FROZEN',{blocked_until_s:s.blocked_until_s});
    if(!s.exists) throw new AppError('NOT_FOUND');
    if(s.state==='write_locked') throw new AppError('WRITE_LOCKED');
    throw new AppError('VERSION_CONFLICT');
  }
  async read(input: unknown): Promise<Page> {
    const path=normalizePath(input),{now,first,hour}=this.window();
    try {
      // Body, accepted read increment and locking share one transaction. Missing reads create nothing.
      const batch=await this.db.batch<Page>([
        this.db.prepare(`INSERT INTO page_hits(path,hour_start_s,accepted_reads)
          SELECT path,?,1 FROM pages WHERE path=?
          ON CONFLICT(path,hour_start_s) DO UPDATE SET accepted_reads=accepted_reads+1`).bind(hour,path),
        this.db.prepare(LOCK_ONE).bind(now,path,first,hour),
        this.db.prepare('SELECT * FROM pages WHERE path=?').bind(path)
      ]);
      const page=batch[2]?.results[0];
      if(!page) return await this.missingOrConflict(path);
      return page;
    } catch(e) { throw dbError(e); }
  }
  async save(input: unknown, content: unknown, revision: unknown): Promise<Page> {
    const path=normalizePath(input),markdown=validateMarkdown(content),version=validateVersion(revision)!;
    if(version===0) return this.create(path,markdown);
    try {
      const row=await this.db.prepare(`UPDATE pages SET content_md=?,content_bytes=?,version=(SELECT value+1 FROM revision_clock WHERE id=1),updated_at_s=?
        WHERE path=? AND version=? AND version<9007199254740991 AND state='active' RETURNING *`)
        .bind(markdown,byteLength(markdown),this.clock(),path,version).first<Page>();
      if(!row) return await this.missingOrConflict(path);
      return row;
    } catch(e) { throw dbError(e); }
  }
  async append(input: unknown, content: unknown, revision?: unknown): Promise<Page> {
    const path=normalizePath(input),markdown=validateMarkdown(content),version=validateVersion(revision,true);
    try {
      const row=await this.db.prepare(`UPDATE pages SET content_md=content_md||?,content_bytes=content_bytes+?,
        version=(SELECT value+1 FROM revision_clock WHERE id=1),updated_at_s=? WHERE path=? AND state='active' AND version<9007199254740991
        AND (? IS NULL OR version=?) RETURNING *`)
        .bind(markdown,byteLength(markdown),this.clock(),path,version??null,version??null).first<Page>();
      if(!row) return await this.missingOrConflict(path);
      return row;
    } catch(e) { throw dbError(e); }
  }
  private async create(path: string, markdown: string): Promise<Page> {
    const size=byteLength(markdown);
    for(let attempt=0; attempt<2; attempt++) {
      const {now,first,hour}=this.window();
      try {
        const state=await this.status(path);
        if(state.exists) throw new AppError('VERSION_CONFLICT');
        if(state.state==='frozen') throw new AppError('PATH_FROZEN',{blocked_until_s:state.blocked_until_s});
        const q=await this.db.prepare('SELECT * FROM usage_quota WHERE id=1').first<Quota>();
        if(!q) throw new AppError('STORAGE_UNAVAILABLE');
        const needPages=Math.max(0,q.used_pages+1-q.max_pages), needBytes=Math.max(0,q.used_content_bytes+size-q.max_content_bytes);
        const victims: Candidate[]=[];
        if(needPages || needBytes) {
          const candidates=await this.db.prepare(`SELECT p.path,p.content_bytes,SUM(h.accepted_reads) AS hits
            FROM pages p JOIN page_hits h ON h.path=p.path AND h.hour_start_s BETWEEN ? AND ?
            WHERE p.state='write_locked' AND p.locked_since_s<=? AND p.created_at_s<=?
            GROUP BY p.path HAVING SUM(h.accepted_reads)>=300 AND SUM(CASE WHEN h.accepted_reads>0 THEN 1 ELSE 0 END)>=6
            ORDER BY hits DESC,p.content_bytes DESC,p.path ASC LIMIT 8`).bind(first,hour,now-12*HOUR,now-DAY).all<Candidate>();
          let recovered=0;
          for(const c of candidates.results) {
            if(recovered>=needBytes && victims.length>=needPages) break;
            victims.push(c); recovered+=c.content_bytes;
          }
          if(recovered<needBytes || victims.length<needPages) throw new AppError('STORAGE_FULL');
        }
        const commands=victims.map(v=>this.db.prepare(`DELETE FROM pages WHERE path=?
          AND state='write_locked' AND locked_since_s<=? AND created_at_s<=?
          AND (SELECT COALESCE(SUM(accepted_reads),0) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ?)>=300
          AND (SELECT COUNT(*) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ? AND accepted_reads>0)>=6
          AND EXISTS(SELECT 1 FROM usage_quota WHERE id=1 AND (used_pages+1>max_pages OR used_content_bytes+?>max_content_bytes))`)
          .bind(v.path,now-12*HOUR,now-DAY,first,hour,first,hour,size));
        commands.push(this.db.prepare(`INSERT INTO pages(path,content_md,content_bytes,version,state,created_at_s,updated_at_s)
          VALUES(?,?,?,(SELECT value+1 FROM revision_clock WHERE id=1),'active',?,?) RETURNING *`).bind(path,markdown,size,now,now));
        const results=await this.db.batch<Page>(commands);
        const created=results.at(-1)?.results[0];
        if(!created) throw new AppError('STORAGE_UNAVAILABLE');
        return created;
      } catch(error) {
        const e=dbError(error);
        if(e.code==='STORAGE_FULL' && attempt===0) continue;
        throw e;
      }
    }
    throw new AppError('STORAGE_FULL');
  }
  async maintenance(): Promise<void> {
    const {now,first,hour}=this.window(),today=Math.floor(now/DAY)*DAY;
    try {
      await this.db.batch([
        this.db.prepare(`DELETE FROM pages WHERE path IN (
          SELECT path FROM page_hits WHERE hour_start_s>=? AND hour_start_s<? GROUP BY path
          HAVING SUM(CASE WHEN hour_start_s<? THEN accepted_reads ELSE 0 END)>=300
            AND SUM(CASE WHEN hour_start_s>=? THEN accepted_reads ELSE 0 END)>=300
          ORDER BY path LIMIT 100)`).bind(today-2*DAY,today,today-DAY,today-DAY),
        this.db.prepare(`UPDATE pages SET state='write_locked',locked_since_s=? WHERE state='active' AND
          (SELECT COALESCE(SUM(accepted_reads),0) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ?)>=100`).bind(now,first,hour),
        this.db.prepare(`UPDATE pages SET state='active',locked_since_s=NULL WHERE state='write_locked' AND locked_since_s<=? AND
          (SELECT COALESCE(SUM(accepted_reads),0) FROM page_hits WHERE path=pages.path AND hour_start_s BETWEEN ? AND ?)<50`).bind(now-12*HOUR,first,hour),
        this.db.prepare('DELETE FROM page_hits WHERE hour_start_s<?').bind(hour-72*HOUR),
        this.db.prepare('DELETE FROM request_limits WHERE window_start_s<?').bind(now-3600),
        this.db.prepare('DELETE FROM tombstones WHERE blocked_until_s<=?').bind(now)
      ]);
    } catch(e) { throw dbError(e); }
  }
}
