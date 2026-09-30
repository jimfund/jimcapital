import MarkdownIt from 'markdown-it';
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
export const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const slugOK = value => typeof value === 'string' && /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 160 && !/^(api|editor|assets|signin-with-chatgpt|signout-with-chatgpt)(\/|$)/.test(value);
export function validDocument(doc) {
 if (!doc || typeof doc.title !== 'string' || doc.title.length > 2000 || !doc.title.trim() || typeof doc.markdown !== 'string' || doc.markdown.length > 250000 || !Array.isArray(doc.drawings) || doc.drawings.length > 250) return false;
 const ids = new Set(); let size = 0;
 for (const d of doc.drawings) {
  if (!d || typeof d.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(d.id) || ids.has(d.id) || ![d.width,d.height].every(n=>Number.isFinite(n)&&n>0&&n<=20000) || !Array.isArray(d.paths) || !d.paths.every(p=>typeof p==='string'&&/^[MLl\d., eE+\-]+$/.test(p))) return false;
  ids.add(d.id); size += d.paths.reduce((n,p)=>n+p.length,0);
 }
 if (size > 650000 || !doc.layout || !Array.isArray(doc.layout.deleted) || !doc.layout.deleted.every(id=>ids.has(id))) return false;
 return ['wide','narrow'].every(mode => doc.layout[mode] && typeof doc.layout[mode]==='object' && !Array.isArray(doc.layout[mode]) && Object.entries(doc.layout[mode]).every(([id,p])=>ids.has(id)&&p&&[p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&(p.width===undefined||(Number.isFinite(p.width)&&p.width>=20&&p.width<=900))));
}
export function splitDoodles(doodle) {
 if (!doodle || !Array.isArray(doodle.strokes)) return [];
 if (doodle.strokes.length>2000) throw new Error('Too many strokes');
 let count=0;
 const groups = [];
 for (const points of doodle.strokes) {
  if (!Array.isArray(points)||!points.length) continue;
  count+=points.length;
  if(count>20000||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<20000))) throw new Error('Invalid drawing');
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  let group={strokes:[points],x1:Math.min(...xs),x2:Math.max(...xs),y1:Math.min(...ys),y2:Math.max(...ys)};
  // Merge nearby/intersecting strokes into drawings, retaining every source point.
  for (let i=0;i<groups.length;) {
   const b=groups[i];
   if(group.x1<=b.x2+9&&group.x2>=b.x1-9&&group.y1<=b.y2+9&&group.y2>=b.y1-9){
    group={strokes:[...b.strokes,...group.strokes],x1:Math.min(group.x1,b.x1),x2:Math.max(group.x2,b.x2),y1:Math.min(group.y1,b.y1),y2:Math.max(group.y2,b.y2)}; groups.splice(i,1); i=0;
   } else i++;
  }
  groups.push(group);
 }
 return groups.map((g,i)=>({id:`doodle-${i+1}`,width:g.x2-g.x1+16,height:g.y2-g.y1+16,paths:g.strokes.map(points=>points.map((p,j)=>`${j?'L':'M'}${+(p[0]-g.x1+8).toFixed(2)} ${+(p[1]-g.y1+8).toFixed(2)}`).join(' ') +(points.length===1?' l0.01 0':''))}));
}
export function fromPost(post) {
 if(!post||typeof post.id!=='string'||!post.id||post.id.length>200||typeof post.title!=='string') throw new Error('Invalid post');
 const continuation=[...(Array.isArray(post.words)?post.words:[]),post.draft||''].filter(Boolean).join(' ');
 const markdown=post.editing?post.markdown:[post.markdown||'',continuation].filter(Boolean).join('\n\n');
 const doc={title:post.title.trim()||'Untitled',markdown,drawings:splitDoodles(post.doodle),layout:{wide:{},narrow:{},deleted:[]}};
 if(!validDocument(doc)) throw new Error('Invalid post');
 return doc;
}
export function svg(d) {
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}"><g fill="none" stroke="#30312e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.paths.map(p=>`<path d="${escape(p)}"/>`).join('')}</g></svg>`;
}
function sections(markdown) {
 const html=md.render(markdown);
 // Preserve ordered numbering while leaving room for drawings beside every six ideas.
 if(/^<ol>\n/.test(html)&&html.endsWith('</ol>\n')&&!html.includes('<ol>',5)&&!html.includes('<ul>')) {
  const items=html.match(/<li>[\s\S]*?<\/li>/g)||[];
  if(items.length) return Array.from({length:Math.ceil(items.length/6)},(_,i)=>`<ol start="${i*6+1}">${items.slice(i*6,i*6+6).join('')}</ol>`);
 }
 const tokens=md.parse(markdown,{}), parts=[]; let start=0,depth=0;
 for(let i=0;i<tokens.length;i++){depth+=tokens[i].nesting;if(depth===0){parts.push(md.renderer.render(tokens.slice(start,i+1),md.options,{}));start=i+1;}}
 const grouped=[]; for(let i=0;i<parts.length;i+=3)grouped.push(parts.slice(i,i+3).join(''));
 return grouped.length?grouped:[''];
}
export function renderArticle(doc, {slug='', editing=false}={}) {
 const parts=sections(doc.markdown), groups=Math.max(parts.length,Math.ceil(doc.drawings.length/2));
 const content=Array.from({length:groups},(_,i)=>`<section class="article-section"><div class="prose">${parts[i]||''}</div>${doc.drawings.slice(i*2,i*2+2).map((d,j)=>`<figure class="decoration ${j?'right':'left'}" data-id="${escape(d.id)}" aria-hidden="true"><img src="${editing?`data:image/svg+xml,${encodeURIComponent(svg(d))}`:`/${escape(slug)}/doodles/${escape(d.id)}.svg`}" width="${d.width}" height="${d.height}" alt="" draggable="false" style="max-width:${Math.max(22,Math.min(190,d.width*1.3))}px;margin-inline:auto"></figure>`).join('')}</section>`).join('');
 const layout=JSON.stringify(doc.layout).replace(/</g,'\\u003c');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(doc.title)} — jim.capital</title><meta property="og:title" content="${escape(doc.title)}"><meta property="og:type" content="article"><meta property="og:description" content="${escape(doc.markdown.replace(/[#*\n]/g,' ').slice(0,180))}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(doc.title)}"><meta name="twitter:description" content="${escape(doc.markdown.replace(/[#*\n]/g,' ').slice(0,180))}">${slug?`<link rel="canonical" href="https://jim.capital/${escape(slug)}"><meta property="og:url" content="https://jim.capital/${escape(slug)}">`:''}<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/editor/article.css"></head><body><main class="page"><article class="page-inner"><nav class="breadcrumbs"><a href="/" target="_top">jim.capital</a><span>${escape(slug)}</span></nav><header><h1>${escape(doc.title)}</h1></header>${content}<footer><a href="/" target="_top">jim.capital</a></footer></article></main><script type="application/json" id="article-layout">${layout}</script><script>window.articleEditing=${editing};</script><script type="module" src="/editor/article.js"></script></body></html>`;
}
