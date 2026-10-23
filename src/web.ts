import { escapeHtml } from './markdown.js';
export const CSS = `
:root{font-family:system-ui,-apple-system,sans-serif;color:#18202a;background:#f5f6f8;line-height:1.6}
*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:30px 22px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9dfe6;padding-bottom:18px;margin-bottom:24px}
a{color:#245787}header a{font-size:25px;font-weight:700;text-decoration:none;color:inherit}.tag,.meta{font-size:13px;color:#576473}.warning{border-left:3px solid #9d7530;background:#fff9eb;padding:12px 16px;font-size:14px}.panel{background:white;border:1px solid #d9dfe6;border-radius:10px;padding:24px;margin-top:24px}h1{font-size:24px;overflow-wrap:anywhere}label{font-weight:600;display:block;margin-bottom:8px}input,textarea{font:inherit;width:100%;border:1px solid #acb8c5;border-radius:5px;padding:12px}textarea{font-family:ui-monospace,monospace;min-height:420px;resize:vertical;line-height:1.65}button{font:inherit;padding:9px 16px;border:1px solid #aab8c6;border-radius:5px;background:#fff;cursor:pointer}button.primary{background:#20364b;color:white;border-color:#20364b}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.status{min-height:1.6em;overflow-wrap:anywhere}.error{color:#a12121}#preview{min-height:180px;overflow-wrap:anywhere}#preview pre{overflow:auto;background:#edf1f5;padding:14px}#preview code{font-family:ui-monospace,monospace}#preview p{white-space:normal}footer{font-size:12px;color:#617083;margin-top:24px}input:focus,textarea:focus,button:focus-visible{outline:2px solid #3776ab;outline-offset:2px}[hidden]{display:none!important}@media(max-width:600px){main{padding:18px 12px}.panel{padding:16px}header{align-items:flex-start;gap:12px}}
`;
export function shell(path?: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${path?escapeHtml(path)+' — ':''}MemDB</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head><body><main${path?' data-path="'+escapeHtml(path)+'"':''}><header><a href="/">MemDB</a><span class="tag">匿名・一時的な共有Markdown</span></header><p class="warning">誰でも閲覧・編集できます。秘密情報や唯一の記録は保存しないでください。閲覧が多いページはロック・削除されます。</p>${path?`<section class="panel"><h1>${escapeHtml(path)}</h1><p id="meta" class="meta">読み込み中</p><div class="actions"><button id="view" type="button">表示・プレビュー</button><button id="edit" type="button">編集</button><button id="reload" type="button">再読込み（閲覧に加算）</button></div><p id="status" class="status" role="status" aria-live="polite"></p><article id="preview"></article><section id="editor" hidden><label for="markdown">Markdown本文</label><textarea id="markdown" spellcheck="false"></textarea><div class="actions"><button id="save" class="primary" type="button">保存</button><span class="meta">最大32 KiB。自動保存はありません。</span></div></section></section>`:`<section class="panel"><h1>文字列のパスで開く</h1><form id="open"><label for="path">共有ページのパス</label><input id="path" required placeholder="研究/実験01" autocomplete="off"><div class="actions"><button class="primary" type="submit">開く</button></div></form><p class="meta">ページは最初の保存時に作成されます。一覧・検索・アカウントはありません。</p><p id="status" class="status" role="status"></p></section>`}<footer>MCP endpoint: /mcp · 本文とページ数の上限を超えた場合、安全な容量回収ができなければ保存を拒否します。</footer></main></body></html>`;
}
export const JS = String.raw`
'use strict';
const el=id=>document.getElementById(id), main=document.querySelector('main');
const path=main.dataset.path, status=el('status');
const messages={VERSION_CONFLICT:'競合しました。編集内容をコピーしてから再読込みしてください。',WRITE_LOCKED:'高アクセスのため編集ロック中です。',PATH_FROZEN:'削除後の凍結期間中です。',STORAGE_FULL:'保存容量が不足しています。既存ページは無理に削除しません。',RATE_LIMITED:'アクセス制限中です。しばらくしてから再試行してください。',PAGE_TOO_LARGE:'本文はUTF-8で32 KiB以内にしてください。',INVALID_INPUT:'空の本文や不正な入力は保存できません。',INVALID_PATH:'パスの形式が不正です。',STORAGE_UNAVAILABLE:'ストレージを利用できません。編集内容を手元に保存してください。'};
const notify=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error)};
const encode=p=>p.split('/').map(encodeURIComponent).join('/');
async function api(url,method='GET',body){const res=await fetch(url,{method,cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error?.code||'HTTP_ERROR'),data.error||{});return data;}
function failure(e){notify(messages[e.code]||'処理に失敗しました。編集内容は残しています。',true);}
if(!path){el('open').addEventListener('submit',e=>{e.preventDefault();location.assign('/p/'+encode(el('path').value.normalize('NFC')));});}
else{
 const text=el('markdown'),save=el('save'),preview=el('preview'),editor=el('editor');let version=0,base='',locked=false,busy=false;
 const showEdit=()=>{editor.hidden=false;preview.hidden=true;};
 const showView=()=>{editor.hidden=true;preview.hidden=false;};
 const setBusy=value=>{busy=value;save.disabled=value||locked;el('reload').disabled=value;el('view').disabled=value;el('edit').disabled=value;text.readOnly=value;};
 function apply(page){version=page.version;base=page.content_md;text.value=base;locked=page.state!=='active';preview.innerHTML=page.html;el('meta').textContent='Version '+version+' · '+page.content_bytes+' B · '+page.state;save.disabled=locked;}
 async function load(){if(busy)return;if(text.value!==base&&!confirm('未保存の編集を破棄して再読込みしますか？'))return;setBusy(true);try{apply(await api('/api/pages/'+encode(path)));notify('読み込みました。');showView();}catch(e){if(e.code==='NOT_FOUND'){version=0;base='';text.value='';locked=false;el('meta').textContent='未作成 · 最初の保存で作成';notify('このパスにはまだページがありません。');showEdit();}else{if(e.code==='PATH_FROZEN')locked=true;failure(e);}}finally{setBusy(false);}}
 el('edit').addEventListener('click',showEdit);
 el('view').addEventListener('click',async()=>{if(busy)return;setBusy(true);try{const result=await api('/api/preview','POST',{markdown:text.value});preview.innerHTML=result.html;showView();notify(text.value!==base?'未保存のプレビューです。':'表示中です。');}catch(e){failure(e);}finally{setBusy(false);}});
 el('reload').addEventListener('click',load);
 save.addEventListener('click',async()=>{if(busy||locked)return;setBusy(true);try{apply(await api('/api/pages/'+encode(path),'PUT',{markdown:text.value,expected_version:version}));notify('保存しました。');showView();}catch(e){failure(e);}finally{setBusy(false);}});
 window.addEventListener('beforeunload',e=>{if(text.value!==base){e.preventDefault();e.returnValue='';}});
 load();
}
`;
