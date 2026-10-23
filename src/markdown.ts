// Deliberately small Markdown subset. Never re-parse generated HTML or permit raw HTML.
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
function inline(text: string): string {
  const pattern=/`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let out='',last=0;
  for(const match of text.matchAll(pattern)) {
    out+=escapeHtml(text.slice(last,match.index));
    const [,code,bold,em,label,url]=match;
    if(code!==undefined) out+=`<code>${escapeHtml(code)}</code>`;
    else if(bold!==undefined) out+=`<strong>${escapeHtml(bold)}</strong>`;
    else if(em!==undefined) out+=`<em>${escapeHtml(em)}</em>`;
    else {
      let safe=false;
      try { safe=!!url && /^https?:\/\//i.test(url) && ['https:','http:'].includes(new URL(url).protocol); } catch { /* plain text fallback */ }
      out+=safe?`<a href="${escapeHtml(url!)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label!)}</a>`:escapeHtml(match[0]);
    }
    last=match.index!+match[0].length;
  }
  return out+escapeHtml(text.slice(last));
}
export function renderMarkdown(markdown: string): string {
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n');
  const out:string[]=[]; let paragraph:string[]=[],code:string[]|null=null,list:''|'ul'|'ol'='';
  const flush=()=>{ if(paragraph.length) {out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);paragraph=[];} if(list){out.push(`</${list}>`);list='';} };
  for(const line of lines) {
    if(/^\s*```/.test(line)) { flush(); if(code){out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);code=null;}else code=[]; continue; }
    if(code){code.push(line);continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(line);
    if(heading){flush();const n=heading[1]!.length;out.push(`<h${n}>${inline(heading[2]!)}</h${n}>`);}
    else if(bullet){const tag=bullet[1]?'ul':'ol';if(list!==tag){flush();list=tag;out.push(`<${tag}>`);}out.push(`<li>${inline(bullet[2]!)}</li>`);}
    else if(!line.trim()){flush();}
    else{if(list)flush();paragraph.push(line);}
  }
  flush();if(code)out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return out.join('\n');
}
