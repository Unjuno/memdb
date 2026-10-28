export const CSS = `
:root{font-family:system-ui,-apple-system,sans-serif;color:#18202a;background:#f5f6f8;line-height:1.6}
*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:30px 22px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9dfe6;padding-bottom:18px;margin-bottom:24px}
a{color:#245787}header a{font-size:25px;font-weight:700;text-decoration:none;color:inherit}.tag,.meta{font-size:13px;color:#576473}.warning{border-left:3px solid #9d7530;background:#fff9eb;padding:12px 16px;font-size:14px}.panel{background:white;border:1px solid #d9dfe6;border-radius:10px;padding:24px;margin-top:24px}h1{font-size:24px;overflow-wrap:anywhere}label{font-weight:600;display:block;margin-bottom:8px}input,textarea{font:inherit;width:100%;border:1px solid #acb8c5;border-radius:5px;padding:12px}textarea{font-family:ui-monospace,monospace;min-height:420px;resize:vertical;line-height:1.65}button{font:inherit;padding:9px 16px;border:1px solid #aab8c6;border-radius:5px;background:#fff;cursor:pointer}button.primary{background:#20364b;color:white;border-color:#20364b}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.status{min-height:1.6em;overflow-wrap:anywhere}.error{color:#a12121}#preview{min-height:180px;overflow-wrap:anywhere}#preview pre{overflow:auto;background:#edf1f5;padding:14px}#preview code{font-family:ui-monospace,monospace}#preview p{white-space:normal}footer{font-size:12px;color:#617083;margin-top:24px}input:focus,textarea:focus,button:focus-visible{outline:2px solid #3776ab;outline-offset:2px}[hidden]{display:none!important}@media(max-width:600px){main{padding:18px 12px}.panel{padding:16px}header{align-items:flex-start;gap:12px}}
`;

// The human interface always lives at /. Page keys are selected in-place, not routed URLs.
export function shell(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MEMDB</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head><body><main><header><a href="/">MEMDB</a><span class="tag">Anonymous Markdown pages</span></header><p class="warning">Anyone can read and edit. Do not store secrets or irreplaceable records. Highly accessed pages may be locked or deleted.</p><section class="panel"><h1>Open a page</h1><form id="open"><label for="path">Page key</label><input id="path" required placeholder="research/experiment-01" autocomplete="off"><div class="actions"><button id="open-button" class="primary" type="submit">Open</button></div></form><p class="meta">Pages are created on first save. No public index, search, or accounts.</p><p id="status" class="status" role="status" aria-live="polite"></p></section><section id="workspace" class="panel" hidden><h1 id="page-title"></h1><p id="meta" class="meta"></p><div class="actions"><button id="view" type="button">View / Preview</button><button id="edit" type="button">Edit</button><button id="reload" type="button">Reload (counts as a read)</button></div><article id="preview"></article><section id="editor" hidden><label for="markdown">Markdown content</label><textarea id="markdown" spellcheck="false"></textarea><div class="actions"><button id="save" class="primary" type="button">Save</button><span class="meta">Maximum 32 KiB. No autosave.</span></div></section></section><footer>MCP endpoint: /mcp · Saving is rejected when storage is full and safe reclamation is unavailable.</footer></main></body></html>`;
}

export const JS = String.raw`
'use strict';
const el=id=>document.getElementById(id);
const form=el('open'),pathInput=el('path'),workspace=el('workspace'),status=el('status');
const text=el('markdown'),save=el('save'),preview=el('preview'),editor=el('editor');
let activePath=null,version=0,base='',locked=false,busy=false;
const messages={VERSION_CONFLICT:'The page has changed. Copy your draft before reloading.',WRITE_LOCKED:'This page is locked due to heavy traffic.',PATH_FROZEN:'This path is temporarily frozen after deletion.',STORAGE_FULL:'Storage is full. Other pages were left unchanged.',RATE_LIMITED:'Too many requests. Try again later.',PAGE_TOO_LARGE:'Content must be 32 KiB or less (UTF-8).',INVALID_INPUT:'Content must be non-empty and valid.',INVALID_PATH:'Invalid page key.',STORAGE_UNAVAILABLE:'Storage is unavailable. Save a copy of your draft.'};
const notify=(message,error=false)=>{status.textContent=message;status.classList.toggle('error',error);};
const encode=key=>key.split('/').map(encodeURIComponent).join('/');
const hasDraft=()=>activePath!==null&&text.value!==base;
async function api(url,method='GET',body){const res=await fetch(url,{method,cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error?.code||'HTTP_ERROR'),data.error||{});return data;}
function failure(error){notify(messages[error.code]||'Request failed. Your draft is still here.',true);}
const showEdit=()=>{editor.hidden=false;preview.hidden=true;};
const showView=()=>{editor.hidden=true;preview.hidden=false;};
function setBusy(value){busy=value;save.disabled=value||locked||activePath===null;el('reload').disabled=value;el('view').disabled=value;el('edit').disabled=value;text.readOnly=value;pathInput.disabled=value;el('open-button').disabled=value;}
function apply(page){version=page.version;base=page.content_md;text.value=base;locked=page.state!=='active';preview.innerHTML=page.html;el('meta').textContent='Version '+version+' · '+page.content_bytes+' B · '+page.state;save.disabled=locked;}
async function openPage(key){
  if(busy)return;
  if(hasDraft()&&!confirm('Discard unsaved changes and open another page?')){pathInput.value=activePath;return;}
  setBusy(true);
  try {
    const page=await api('/api/pages/'+encode(key));
    activePath=key;pathInput.value=key;workspace.hidden=false;el('page-title').textContent=key;
    apply(page);notify('Page loaded.');showView();
  }catch(error){
    if(error.code==='NOT_FOUND'){
      activePath=key;pathInput.value=key;workspace.hidden=false;el('page-title').textContent=key;
      version=0;base='';text.value='';locked=false;preview.innerHTML='';
      el('meta').textContent='Not created · Save to create this page';notify('This page does not exist yet.');showEdit();
    }else{if(activePath!==null)pathInput.value=activePath;failure(error);}
  }finally{setBusy(false);}
}
form.addEventListener('submit',event=>{event.preventDefault();const key=pathInput.value.normalize('NFC');if(!key){notify('Enter a page key.',true);return;}void openPage(key);});
el('reload').addEventListener('click',()=>{if(activePath!==null)void openPage(activePath);});
el('edit').addEventListener('click',showEdit);
el('view').addEventListener('click',async()=>{if(busy||activePath===null)return;setBusy(true);try{const result=await api('/api/preview','POST',{markdown:text.value});preview.innerHTML=result.html;showView();notify(hasDraft()?'Unsaved preview.':'Showing page.');}catch(error){failure(error);}finally{setBusy(false);}});
save.addEventListener('click',async()=>{if(busy||locked||activePath===null)return;setBusy(true);try{apply(await api('/api/pages/'+encode(activePath),'PUT',{markdown:text.value,expected_version:version}));notify('Saved successfully.');showView();}catch(error){failure(error);}finally{setBusy(false);}});
window.addEventListener('beforeunload',event=>{if(hasDraft()){event.preventDefault();event.returnValue='';}});
`;
