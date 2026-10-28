import { AppError, dbError, decodePath, validateMarkdown, type Env } from './model.js';
import { invokeTool, rate } from './tools.js';
import { renderMarkdown } from './markdown.js';
import { CSS, JS, shell } from './web.js';
export type McpHandler = (request: Request, env: Env) => Promise<Response>;
const MAX_REQUEST_BYTES=204800;
const SECURITY={
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'X-Robots-Tag':'noindex, nofollow',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
function secure(response: Response) {
  const headers=new Headers(response.headers);for(const [k,v] of Object.entries(SECURITY))headers.set(k,v);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function validateOrigin(request: Request, env: Env) {
  let configured:URL;
  try { configured=new URL(env.PUBLIC_ORIGIN); } catch { throw new AppError('CONFIGURATION_ERROR'); }
  if(configured.origin!==env.PUBLIC_ORIGIN || !['http:','https:'].includes(configured.protocol))throw new AppError('CONFIGURATION_ERROR');
  if(configured.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(configured.hostname))throw new AppError('CONFIGURATION_ERROR');
  const url=new URL(request.url),origin=request.headers.get('Origin'),host=request.headers.get('Host');
  if(url.origin!==configured.origin || (origin!==null&&origin!==configured.origin) || (host!==null&&host!==configured.host))throw new AppError('ORIGIN_DENIED');
  const site=request.headers.get('Sec-Fetch-Site');
  // A sibling subdomain is not trusted; reads mutate counters and may cause deletion.
  if(/^\/(api|raw|mcp|mcp-public)(\/|$)/.test(url.pathname)&&site!==null&&!['same-origin','none'].includes(site))throw new AppError('ORIGIN_DENIED');
}
async function textBody(request: Request): Promise<string> {
  if(request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AppError('UNSUPPORTED_MEDIA_TYPE');
  const encoding=request.headers.get('Content-Encoding');if(encoding&&encoding!=='identity')throw new AppError('UNSUPPORTED_MEDIA_TYPE');
  const declared=Number(request.headers.get('Content-Length')??0);if(!Number.isFinite(declared)||declared<0)throw new AppError('INVALID_INPUT');
  if(declared>MAX_REQUEST_BYTES)throw new AppError('REQUEST_TOO_LARGE');
  if(!request.body)throw new AppError('INVALID_JSON');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_REQUEST_BYTES){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE');}chunks.push(value);}
    const joined=new Uint8Array(bytes);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.byteLength;}
    try{return new TextDecoder('utf-8',{fatal:true}).decode(joined);}catch{throw new AppError('INVALID_JSON');}
  } finally {reader.releaseLock();}
}
async function jsonBody(request: Request): Promise<Record<string,unknown>> {
  const text=await textBody(request);let value:unknown;
  try {value=JSON.parse(text);}catch{throw new AppError('INVALID_JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_INPUT');
  return value as Record<string,unknown>;
}
function method(request: Request, allowed:string[]) {if(!allowed.includes(request.method))throw new AppError('METHOD_NOT_ALLOWED');}
function pageResponse(result: Awaited<ReturnType<typeof invokeTool>>, status=200) {
  return Response.json({...result,...('content_md' in result?{html:renderMarkdown(result.content_md)}:{})},{status});
}
export async function handleRequest(request: Request, env: Env, mcp?: McpHandler): Promise<Response> {
  try {
    validateOrigin(request,env);await rate(env.REQUEST_LIMITER,'requests');
    const route=new URL(request.url).pathname;
    let response:Response;
    if(route==='/mcp'||route==='/mcp-public') {
      method(request,['GET','POST','DELETE']);if(!mcp)throw new AppError('CONFIGURATION_ERROR');
      const bounded=request.method==='POST'?new Request(request.url,{method:'POST',headers:request.headers,body:await textBody(request)}):request;
      response=await mcp(bounded,env);
    } else if(route==='/') {
      method(request,['GET']);
      response=new Response(shell(),{headers:{'Content-Type':'text/html; charset=utf-8'}});
    } else if(route.startsWith('/p/')) {
      method(request,['GET']);decodePath(route.slice(3));
      response=new Response(null,{status:302,headers:{'Location':'/'}});
    } else if(route==='/assets/style.css'||route==='/assets/app.js') {
      method(request,['GET']);const css=route.endsWith('.css');
      response=new Response(css?CSS:JS,{headers:{'Content-Type':css?'text/css; charset=utf-8':'text/javascript; charset=utf-8'}});
    } else if(route==='/api/preview') {
      method(request,['POST']);await rate(env.WRITE_LIMITER,'preview');const body=await jsonBody(request);
      if(typeof body.markdown!=='string')throw new AppError('INVALID_INPUT');
      if(body.markdown) validateMarkdown(body.markdown); // Empty drafts are valid previews, but malformed Unicode is not.
      response=Response.json({html:renderMarkdown(body.markdown)});
    } else if(route.startsWith('/api/pages/')) {
      method(request,['GET','PUT']);const path=decodePath(route.slice(11));
      if(request.method==='GET')response=pageResponse(await invokeTool('read_page',{path},env));
      else {const body=await jsonBody(request);response=pageResponse(await invokeTool('save_page',{...body,path},env),body.expected_version===0?201:200);}
    } else if(route.startsWith('/api/status/')) {
      method(request,['GET']);response=pageResponse(await invokeTool('get_page_status',{path:decodePath(route.slice(12))},env));
    } else if(route.startsWith('/api/append/')) {
      method(request,['POST']);const path=decodePath(route.slice(12)),body=await jsonBody(request);
      response=pageResponse(await invokeTool('append_page',{...body,path},env));
    } else if(route.startsWith('/raw/')) {
      method(request,['GET']);const result=await invokeTool('read_page',{path:decodePath(route.slice(5))},env);
      if(!('content_md' in result))throw new AppError('STORAGE_UNAVAILABLE');
      response=new Response(result.content_md,{headers:{'Content-Type':'text/markdown; charset=utf-8','X-MemDB-Version':String(result.version)}});
    } else throw new AppError('NOT_FOUND');
    return secure(response);
  } catch(error) {
    const e=dbError(error);
    return secure(Response.json({error:{code:e.code,...e.details}},{status:e.status,headers:e.code==='RATE_LIMITED'?{'Retry-After':'60'}:{}}));
  }
}
