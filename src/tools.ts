import { AppError, normalizePath, validateMarkdown, validateVersion, type Env, type Limiter } from './model.js';
import { PageStore } from './store.js';
export type ToolName = 'read_page' | 'save_page' | 'append_page' | 'get_page_status';
export async function rate(limiter: Limiter | undefined, key: string): Promise<void> {
  if(!limiter || typeof limiter.limit!=='function') throw new AppError('CONFIGURATION_ERROR');
  let success:boolean;
  try { ({success}=await limiter.limit({key})); } catch { throw new AppError('STORAGE_UNAVAILABLE'); }
  if(!success) throw new AppError('RATE_LIMITED');
}
// Every transport uses this same gate. No user, bot or IP identifier is persisted.
export async function invokeTool(name: ToolName, args: Record<string,unknown>, env: Env) {
  const path=normalizePath(args.path), store=new PageStore(env.DB);
  switch(name) {
    case 'read_page':
      await rate(env.READ_LIMITER,path); return store.read(path);
    case 'get_page_status':
      await rate(env.READ_LIMITER,path); return store.status(path);
    case 'save_page': {
      const markdown=validateMarkdown(args.markdown), version=validateVersion(args.expected_version)!;
      await rate(env.WRITE_LIMITER,path);
      if(version===0) await rate(env.CREATE_LIMITER,'create');
      return store.save(path,markdown,version);
    }
    case 'append_page': {
      const markdown=validateMarkdown(args.markdown), version=validateVersion(args.expected_version,true);
      await rate(env.WRITE_LIMITER,path); return store.append(path,markdown,version);
    }
  }
}
