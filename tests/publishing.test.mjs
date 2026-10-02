import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../cloud/worker.js';
import { fromPost, validDocument, renderArticle, splitDoodles, slugOK } from '../cloud/content.js';
import seed from '../cloud/seed.json' with {type:'json'};
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return {prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const origin='https://jim.example';
test('homepage routes use the separate template and include the D1 snapshot even with asset-first hosting',async()=>{
 const requests=[];
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const env={DB:database(),ASSETS:{fetch:async request=>{
  requests.push(new URL(request.url).pathname);
  return new URL(request.url).pathname==='/site-home' ? new Response(source,{headers:{'Content-Type':'text/html'}}) : new Response('Missing',{status:404});
 }}};
 for(const path of ['/','/index.html']){
  const response=await worker.fetch(new Request(origin+path),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(await response.text(),/id="market-snapshot" type="application\/json">\{"quotes":/);
 }
 assert.deepEqual(requests,['/site-home','/site-home']);
});
test('graphs is a public page, canonical URLs preserve selections, and asset redirects do not loop',async()=>{
 assert.equal(slugOK('graphs'),false);
 const env={DB:database(),ASSETS:{fetch:async request=>new URL(request.url).pathname==='/graphs.html'?new Response(null,{status:308,headers:{Location:origin+'/graphs'}}):new Response('Graphs page')}};
 const page=await worker.fetch(new Request(origin+'/graphs?symbol=SOFTBANK&range=1d'),env);
 assert.equal(page.status,200);assert.equal(await page.text(),'Graphs page');
 for(const path of ['/graphs/','/graphs.html']){
  const response=await worker.fetch(new Request(origin+path+'?symbol=BTC&range=1m'),env);
  assert.equal(response.status,308);assert.equal(response.headers.get('Location'),origin+'/graphs?symbol=BTC&range=1m');
 }
});
function setup(){
 const env={DB:database(),PUBLISHING_SECRET:'test-secret',ONE_WORD_OWNER_ID:'oneword-owner',ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
 const request=async(path,{user,method='GET',data,headers={}}={})=>worker.fetch(new Request(origin+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(data?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env);
 const post={id:'test-post',title:'Private draft',editing:true,markdown:'Hello **world**',doodle:{strokes:[[[1,1],[2,2]],[[100,100],[110,110]]]}};
 return {env,request,post};
}
async function transfer(request,post){const response=await request('/api/transfers',{method:'POST',data:{ownerId:'oneword-owner',post},headers:{Authorization:'Bearer test-secret'}});assert.equal(response.status,200);return response.json();}
async function imported(request,post,user='jim'){const handoff=await transfer(request,post);const response=await request('/api/import',{method:'POST',user,data:{token:handoff.token}});assert.equal(response.status,200);return response.json();}

test('only the connected source can transfer, and only paired owner can edit',async()=>{
 const {request,post}=setup();
 assert.equal((await request('/api/transfers',{method:'POST',data:{post,ownerId:'oneword-owner'}})).status,403);
 assert.equal((await request('/api/transfers',{method:'POST',data:{post,ownerId:'other'},headers:{Authorization:'Bearer test-secret'}})).status,403);
 const article=await imported(request,post);
 assert.equal((await request('/api/articles')).status,401);
 assert.equal((await request('/api/articles',{user:'other'})).status,403);
 assert.equal((await request('/editor/preview/'+article.id)).status,401);
 const next=await transfer(request,post);
 assert.equal((await request('/api/import',{user:'other',method:'POST',data:{token:next.token}})).status,403);
 assert.equal((await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{},headers:{Origin:'https://bad.example'}})).status,403);
});
test('drafts stay private, publishing freezes content and placement, versions restore privately',async()=>{
 const {request,post}=setup();let article=await imported(request,post);
 assert.equal((await request('/'+article.slug)).status,404);
 const save=async()=>{const response=await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{document:article.document,slug:article.slug,revision:article.revision}});assert.equal(response.status,200);article.revision=(await response.json()).revision;};
 article.slug='prac/001';article.document.layout.wide['doodle-1']={x:.15,y:.3,width:150};article.document.layout.deleted=['doodle-2'];await save();
 assert.equal((await request('/api/articles/'+article.id+'/publish',{user:'jim',method:'POST',data:{revision:article.revision}})).status,200);
 const published=await (await request('/prac/001')).text();assert.ok(published.includes('Hello <strong>world</strong>'));assert.ok(published.includes('"width":150'));assert.ok(published.includes('window.articleEditing=false'));
 article.document.markdown='Unpublished secret';await save();
 assert.equal(await (await request('/prac/001')).text(),published);
 const conflict=await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{document:article.document,slug:article.slug,revision:1}});assert.equal(conflict.status,409);
 const versions=await (await request('/api/articles/'+article.id+'/versions',{user:'jim'})).json();assert.equal(versions.length,1);
 const restored=await request('/api/articles/'+article.id+'/restore',{user:'jim',method:'POST',data:{revision:versions[0].revision,currentRevision:article.revision}});assert.equal(restored.status,200);assert.equal((await restored.json()).document.markdown,post.markdown);
 assert.equal((await request('/api/articles/'+article.id+'/unpublish',{user:'jim',method:'POST',data:{}})).status,200);
 assert.equal((await request('/prac/001')).status,404);
});
test('transfers expire, cannot be replayed, and re-import preserves editorial changes',async()=>{
 const {env,request,post}=setup(),handoff=await transfer(request,post);
 const first=await request('/api/import',{user:'jim',method:'POST',data:handoff});assert.equal(first.status,200);
 assert.equal((await request('/api/import',{user:'jim',method:'POST',data:handoff})).status,410);
 const article=await first.json();article.document.markdown='Edited here';
 await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{document:article.document,slug:article.slug,revision:article.revision}});
 const again=await imported(request,{...post,markdown:'New source'});assert.equal(again.id,article.id);assert.equal(again.document.markdown,'Edited here');
 const expired=await transfer(request,{...post,id:'next'});await env.DB.prepare('UPDATE transfers SET expires_at=0').run();assert.equal((await request('/api/import',{user:'jim',method:'POST',data:expired})).status,410);
});
test('preserves the existing article, safe markdown, and separate drawings',()=>{
 assert.ok(validDocument(seed.document));assert.equal(seed.document.drawings.length,18);assert.equal(seed.document.drawings.reduce((n,d)=>n+d.paths.length,0),173);
 const doc=fromPost({id:'id',title:'<script>title</script>',editing:true,markdown:'<script>alert(1)</script>\n\n[bad](javascript:alert(1))'});
 const html=renderArticle(doc);assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!html.includes('href="javascript:'));
 assert.equal(splitDoodles({strokes:[[[0,0],[10,10]],[[9,9],[15,15]],[[100,100],[110,110]]]}).length,2);
 assert.equal(slugOK('../secret'),false);assert.equal(slugOK('editor/private'),false);
 assert.equal(validDocument({...doc,drawings:[{id:'bad',width:1,height:1,paths:['" onload="evil']}] }),false);
});

test('prac directory lists only published prac titles and updates on publish and unpublish',async()=>{
 const {env,request,post}=setup();
 const article=await imported(request,post);assert.ok(article.slug.startsWith('prac/'));
 assert.equal(seed.slug,'prac/001');
 let page=await request('/prac');assert.equal(page.status,200);assert.ok(!(await page.text()).includes(post.title));
 await request('/api/articles/'+article.id+'/publish',{user:'jim',method:'POST',data:{revision:article.revision}});
 const publishedPage=await (await request('/prac/')).text();assert.ok(publishedPage.includes(`href="/${article.slug}"`));assert.ok(publishedPage.includes(post.title));
 article.document.title='SECRET NEW TITLE';
 await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{document:article.document,slug:article.slug,revision:article.revision}});
 const pageAfterDraft=await (await request('/prac')).text();assert.ok(pageAfterDraft.includes(post.title));assert.ok(!pageAfterDraft.includes('SECRET NEW TITLE'));
 const doc=JSON.stringify({...article.document,title:'Outside this directory'});
 await env.DB.prepare('INSERT INTO articles (id,source_id,slug,draft,revision,published,updated_at) VALUES (?,?,?,?,1,?,1)').bind('outside','outside','other/001',doc,doc).run();
 assert.ok(!(await (await request('/prac')).text()).includes('Outside this directory'));
 await request('/api/articles/'+article.id+'/unpublish',{user:'jim',method:'POST',data:{}});
 assert.ok(!(await (await request('/prac')).text()).includes(post.title));
 assert.equal(slugOK('prac'),false);assert.equal(slugOK('practicehaven'),false);
});

test('legacy URLs redirect permanently, preserving suffixes, queries and SVG links',async()=>{
 const {request}=setup();
 for(const [old,next] of [['/practicehaven','/prac'],['/practicehaven/','/prac/'],['/practicehaven/001?from=old','/prac/001?from=old'],['/practicehaven/001/doodles/rocket.svg','/prac/001/doodles/rocket.svg']]){
  const r=await request(old);assert.equal(r.status,308);assert.equal(r.headers.get('Location'),origin+next);
 }
});

test('address migration preserves content and prevents stale editor writes',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_giant_vengeance.sql',import.meta.url),'utf8'));
 const draft=JSON.stringify({...seed.document,title:'Unpublished edit'}),published=JSON.stringify(seed.document);
 db.prepare('INSERT INTO articles (id,source_id,slug,draft,revision,published,updated_at) VALUES (?,?,?,?,34,?,1)').run('existing','source','practicehaven/001',draft,published);
 db.exec(readFileSync(new URL('../drizzle/0001_short_prac_urls.sql',import.meta.url),'utf8'));
 const row=db.prepare('SELECT * FROM articles').get();assert.equal(row.slug,'prac/001');assert.equal(row.revision,35);assert.equal(row.draft,draft);assert.equal(row.published,published);db.close();
});

test('publication dates use the first publication, remain stable after updates, and use Pacific dates',async t=>{
 let now=Date.parse('2026-10-01T06:30:00Z');t.mock.method(Date,'now',()=>now);
 const {request,post}=setup();const article=await imported(request,post);
 const preview=await (await request('/editor/preview/'+article.id,{user:'jim'})).text();
 assert.ok(!preview.includes('<time class="publication-date"'));
 const publish=()=>request('/api/articles/'+article.id+'/publish',{user:'jim',method:'POST',data:{revision:article.revision}});
 assert.equal((await publish()).status,200);
 const originalTime='datetime="2026-10-01T06:30:00.000Z">September 30, 2026</time>';
 for(const path of ['/'+article.slug,'/prac'])assert.ok((await (await request(path)).text()).includes(originalTime));
 now+=3*86400000;article.document.markdown='Updated post';
 const saved=await request('/api/articles/'+article.id,{user:'jim',method:'PUT',data:{document:article.document,slug:article.slug,revision:article.revision}});article.revision=(await saved.json()).revision;
 assert.equal((await publish()).status,200);
 for(const path of ['/'+article.slug,'/prac'])assert.ok((await (await request(path)).text()).includes(originalTime));
 await request('/api/articles/'+article.id+'/unpublish',{user:'jim',method:'POST',data:{}});now+=86400000;
 assert.equal((await publish()).status,200);
 assert.ok((await (await request('/'+article.slug)).text()).includes(originalTime));
});
