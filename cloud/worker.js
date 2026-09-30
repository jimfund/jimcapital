import { fromPost, renderArticle, validDocument, slugOK, svg, renderDirectory } from './content.js';
import seed from './seed.json' with { type: 'json' };

const json = (data, status=200) => Response.json(data, {status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie','Referrer-Policy':'no-referrer'}});
const html = (body,status=200,privatePage=false) => new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':privatePage?'no-store, private':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const token = () => crypto.randomUUID()+crypto.randomUUID();
class HTTPError extends Error { constructor(status,message){super(message);this.status=status;} }
async function body(request) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HTTPError(415,'Expected JSON.');
 const reader=request.body?.getReader();if(!reader)throw new HTTPError(400,'Missing content.');
 const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>950000){await reader.cancel();throw new HTTPError(413,'This post is too large.');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HTTPError(400,'Invalid JSON.');}
}
const userId = request => request.headers.get('oai-authenticated-user-id');
function sameOrigin(request) { if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new HTTPError(403,'Open the editor to make changes.'); }
async function owner(db) { return (await db.prepare("SELECT value FROM settings WHERE key='owner'").first())?.value; }
async function requireOwner(request,db) {const id=userId(request);if(!id)throw new HTTPError(401,'Sign in to edit.');if(await owner(db)!==id)throw new HTTPError(403,'This editor belongs to the site owner.');return id;}
function result(row) {return {id:row.id,slug:row.slug,document:JSON.parse(row.draft),revision:row.revision,publishedAt:row.published_at,hasUnpublishedChanges:row.published!==row.draft};}
async function handle(request,env) {
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/transfers'&&request.method==='POST') {
  if(!env.PUBLISHING_SECRET||request.headers.get('Authorization')!==`Bearer ${env.PUBLISHING_SECRET}`)throw new HTTPError(403,'Not authorized.');
  const data=await body(request);
  if(!env.ONE_WORD_OWNER_ID||data.ownerId!==env.ONE_WORD_OWNER_ID)throw new HTTPError(403,'This account cannot send articles to jim.capital.');
  fromPost(data.post);
  const code=token(),hash=await digest(code),expires=Date.now()+15*60*1000;
  await env.DB.batch([env.DB.prepare('DELETE FROM transfers WHERE expires_at < ?').bind(Date.now()),env.DB.prepare('INSERT INTO transfers (token_hash,payload,expires_at) VALUES (?,?,?)').bind(hash,JSON.stringify(data.post),expires)]);
  return json({token:code});
 }
 if(path==='/api/session') {
  const id=userId(request),admin=id&&id===await owner(env.DB);
  return json({signedIn:!!id,owner:!!admin});
 }
 if(path==='/api/import'&&request.method==='POST') {
  sameOrigin(request);
  const id=userId(request);if(!id)throw new HTTPError(401,'Sign in to import your post.');
  const current=await owner(env.DB);if(current&&current!==id)throw new HTTPError(403,'Sign into the account you paired with this site.');
  const data=await body(request);if(typeof data.token!=='string'||data.token.length>200)throw new HTTPError(400,'Invalid transfer.');
  const hash=await digest(data.token);
  const transfer=await env.DB.prepare('SELECT payload FROM transfers WHERE token_hash=? AND expires_at>?').bind(hash,Date.now()).first();
  if(!transfer)throw new HTTPError(410,'This transfer expired or was already used. Send the post from One Word again.');
  // A transfer from the explicitly allowed One Word account can pair this Site once.
  await env.DB.prepare("INSERT INTO settings (key,value) VALUES ('owner',?) ON CONFLICT(key) DO NOTHING").bind(id).run();
  await requireOwner(request,env.DB);
  const post=JSON.parse(transfer.payload),existing=await env.DB.prepare('SELECT * FROM articles WHERE source_id=?').bind(post.id).first();
  if(existing){await env.DB.prepare('DELETE FROM transfers WHERE token_hash=?').bind(hash).run();return json({...result(existing),existing:true});}
  let document=fromPost(post),slug=`prac/${crypto.randomUUID().slice(0,8)}`;
  if(post.id===seed.sourceId){document={...seed.document,title:document.title,markdown:document.markdown};slug=seed.slug;}
  const articleId=crypto.randomUUID(),draft=JSON.stringify(document),now=Date.now();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO articles (id,source_id,slug,draft,revision,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(source_id) DO NOTHING').bind(articleId,post.id,slug,draft,now),
   env.DB.prepare('DELETE FROM transfers WHERE token_hash=?').bind(hash),
  ]);
  return json(result(await env.DB.prepare('SELECT * FROM articles WHERE source_id=?').bind(post.id).first()));
 }
 if(path.startsWith('/api/')||path.startsWith('/editor/preview/')) {
  await requireOwner(request,env.DB);
  if(request.method!=='GET')sameOrigin(request);
  if(path==='/api/articles'&&request.method==='GET') {
   const rows=await env.DB.prepare('SELECT id,slug,draft,revision,published_at,updated_at FROM articles ORDER BY updated_at DESC').all();
   return json(rows.results.map(r=>({id:r.id,slug:r.slug,title:JSON.parse(r.draft).title,revision:r.revision,publishedAt:r.published_at})));
  }
  const preview=path.match(/^\/editor\/preview\/([a-f0-9-]+)$/),match=path.match(/^\/api\/articles\/([a-f0-9-]+)(?:\/(publish|unpublish|versions|restore))?$/);
  if(!match&&!preview)throw new HTTPError(404,'Not found.');
  const articleId=(match||preview)[1],action=match?.[2];
  const row=await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(articleId).first();
  if(!row)throw new HTTPError(404,'Article not found.');
  if(preview&&request.method==='GET')return html(renderArticle(JSON.parse(row.draft),{slug:row.slug,editing:url.searchParams.get('edit')==='1'}),200,true);
  if(request.method==='GET'&&!action)return json(result(row));
  if(request.method==='GET'&&action==='versions')return json((await env.DB.prepare('SELECT revision,created_at FROM article_versions WHERE article_id=? ORDER BY revision DESC LIMIT 20').bind(articleId).all()).results);
  if(request.method==='PUT'&&!action) {
   const data=await body(request);
   if(typeof data.slug==='string')data.slug=data.slug.replace(/^practicehaven\//,'prac/');
   if(!validDocument(data.document)||!slugOK(data.slug)||!Number.isSafeInteger(data.revision))throw new HTTPError(400,'Check the article and its address.');
   if(data.revision!==row.revision)throw new HTTPError(409,'A newer edit was saved elsewhere. Reload before editing further.');
   if(row.published&&data.slug!==row.slug)throw new HTTPError(400,'Unpublish before changing the address of a published article.');
   const other=await env.DB.prepare('SELECT id FROM articles WHERE slug=? AND id!=?').bind(data.slug,articleId).first();if(other)throw new HTTPError(409,'That address is already in use.');
   const next=data.revision+1,now=Date.now();
   const changes=await env.DB.prepare('UPDATE articles SET draft=?,slug=?,revision=?,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(data.document),data.slug,next,now,articleId,data.revision).run();
   if(!changes.meta.changes)throw new HTTPError(409,'A newer edit was saved elsewhere. Reload before editing further.');
   return json({revision:next,updatedAt:now});
  }
  if(request.method==='POST'&&action==='publish') {
   const data=await body(request);if(data.revision!==row.revision)throw new HTTPError(409,'Save your latest changes before publishing.');
   const now=Date.now();
   const changes=await env.DB.batch([
    env.DB.prepare('UPDATE articles SET published=draft,published_at=? WHERE id=? AND revision=?').bind(now,articleId,row.revision),
    env.DB.prepare('INSERT INTO article_versions (article_id,revision,snapshot,created_at) SELECT id,revision,published,? FROM articles WHERE id=? AND revision=? AND published_at=? ON CONFLICT(article_id,revision) DO NOTHING').bind(now,articleId,row.revision,now),
   ]);
   if(!changes[0].meta.changes)throw new HTTPError(409,'The draft changed. Save and try publishing again.');
   return json({url:`/${row.slug}`,publishedAt:now});
  }
  if(request.method==='POST'&&action==='unpublish') {await env.DB.prepare('UPDATE articles SET published=NULL,published_at=NULL WHERE id=?').bind(articleId).run();return json({ok:true});}
  if(request.method==='POST'&&action==='restore') {
   const data=await body(request);if(data.currentRevision!==row.revision)throw new HTTPError(409,'Reload before restoring.');
   const version=await env.DB.prepare('SELECT snapshot FROM article_versions WHERE article_id=? AND revision=?').bind(articleId,data.revision).first();if(!version)throw new HTTPError(404,'Version not found.');
   const saved=await env.DB.prepare('UPDATE articles SET draft=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(version.snapshot,Date.now(),articleId,row.revision).run();
   if(!saved.meta.changes)throw new HTTPError(409,'The draft changed. Reload before restoring.');
   return json(result(await env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(articleId).first()));
  }
  throw new HTTPError(405,'Method not allowed.');
 }
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 if(path==='/practicehaven'||path.startsWith('/practicehaven/')) {
  const destination=new URL(request.url);
  destination.pathname=path.replace(/^\/practicehaven(?=\/|$)/,'/prac');
  return Response.redirect(destination.toString(),308);
 }
 if(path==='/prac'||path==='/prac/') {
  const rows=await env.DB.prepare("SELECT slug, json_extract(published, '$.title') AS title FROM articles WHERE published IS NOT NULL AND slug GLOB 'prac/*' ORDER BY slug COLLATE NOCASE").all();
  return html(renderDirectory(rows.results));
 }
 const drawingPath=path.match(/^\/(.+)\/doodles\/([a-z0-9-]+)\.svg$/);
 if(drawingPath){
  const row=await env.DB.prepare('SELECT published FROM articles WHERE slug=? AND published IS NOT NULL').bind(drawingPath[1]).first();
  const drawing=row&&JSON.parse(row.published).drawings.find(d=>d.id===drawingPath[2]);
  if(!drawing)return new Response('Not found',{status:404});
  return new Response(svg(drawing),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 }
 // Public readers see only the explicit published snapshot, never a draft.
 const slug=path.replace(/^\/+|\/+$/g,'');
 if(slugOK(slug)) {
  const row=await env.DB.prepare('SELECT slug,published FROM articles WHERE slug=? AND published IS NOT NULL').bind(slug).first();
  if(row)return html(renderArticle(JSON.parse(row.published),{slug:row.slug}));
 }
 return env.ASSETS.fetch(request);
}
export default {async fetch(request,env) {try{return await handle(request,env);}catch(error){if(error instanceof HTTPError)return json({error:error.message},error.status);console.error('Article request failed',error);return json({error:'Could not complete that request. Your saved content is unchanged.'},503);}}};
