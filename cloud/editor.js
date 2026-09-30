const app=document.querySelector('#app'),status=document.querySelector('#status'),publish=document.querySelector('#publish');
let article,change=0,saved=0,timer,saving,failed=false,frame,selectedId,needsPreview=false,previewObserver;
const transferKey='jim.capital.pending-transfer';
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('transfer')){sessionStorage.setItem(transferKey,fragment.get('transfer'));history.replaceState(null,'',location.pathname+location.search);}
const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
function message(value){status.textContent=value;}
async function api(path,options={}){
 const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data;
}
function report(error){message(error.message);status.style.color='#9d2020';}
function changed(redraw=false){needsPreview ||= redraw;change++;failed=false;message('Saving…');status.style.color='';clearTimeout(timer);timer=setTimeout(()=>flush(redraw).catch(report),450);}
async function flush(redraw=false){
 clearTimeout(timer);
 if(saving){await saving;if(change!==saved)return flush(redraw);return;}
 if(!article||change===saved)return;
 saving=(async()=>{
  while(change!==saved){
   const version=change;
   const result=await api(`/api/articles/${article.id}`,{method:'PUT',body:JSON.stringify({document:article.document,slug:article.slug,revision:article.revision})});
   article.revision=result.revision;saved=version;
  }
  failed=false;
  message('Saved');
  if(redraw || needsPreview){needsPreview=false;renderPreview();}
 })();
 try{await saving;}catch(error){failed=true;throw error;}finally{saving=null;}
}
function renderPreview(){frame.src=`/editor/preview/${article.id}?edit=1&v=${article.revision}`;}
function button(label,action){const b=text('button',label);b.type='button';b.onclick=action;return b;}
function field(label,value,tag='input'){
 const wrap=text('label',label),input=document.createElement(tag);input.value=value;wrap.append(input);return {wrap,input};
}
function edit(data){
 previewObserver?.disconnect();
 article=data;change=saved=0;app.replaceChildren();publish.hidden=false;publish.textContent=article.publishedAt?'Update published post':'Publish';
 const tools=document.createElement('div');tools.className='edit-tools';
 const path=field('Address',article.slug);path.input.style.width='240px';path.input.disabled=!!article.publishedAt;
 path.input.oninput=()=>{article.slug=path.input.value;changed();};tools.append(path.wrap);
 const publicLink=text('a','View published');publicLink.href='/'+article.slug;publicLink.target='_blank';publicLink.hidden=!article.publishedAt;tools.append(publicLink);
 tools.append(button('Desktop',()=>{frame.dataset.width='1040';sizePreview();}),button('Phone',()=>{frame.dataset.width='390';sizePreview();}));
 const versionButton=button('Published versions',async()=>{
  try{
   await flush();const versions=await api(`/api/articles/${article.id}/versions`);
   const box=document.createElement('div');box.className='edit-tools';
   if(!versions.length)box.append(text('span','No published versions yet.'));
   for(const version of versions)box.append(button(new Date(version.created_at).toLocaleString(),async()=>{
    try{await flush();const restored=await api(`/api/articles/${article.id}/restore`,{method:'POST',body:JSON.stringify({revision:version.revision,currentRevision:article.revision})});edit(restored);message('Restored to draft. Publish when ready.');}catch(e){report(e);}
   }));
   box.append(button('Close',()=>box.remove()));tools.after(box);
  }catch(e){report(e);}
 });tools.append(versionButton);
 if(article.publishedAt)tools.append(button('Unpublish',async()=>{
  if(!confirm('Remove this article from the public site? Your draft will stay saved.'))return;
  try{await flush();await api(`/api/articles/${article.id}/unpublish`,{method:'POST',body:'{}'});article.publishedAt=null;edit(article);message('Unpublished');}catch(e){report(e);}
 }));
 app.append(tools);
 const workspace=document.createElement('div');workspace.className='workspace';const source=document.createElement('div');
 const title=field('Title',article.document.title),markdown=field('Markdown',article.document.markdown,'textarea');
 title.input.oninput=()=>{article.document.title=title.input.value;changed(true);};
 markdown.input.oninput=()=>{article.document.markdown=markdown.input.value;changed(true);};
 source.append(title.wrap,markdown.wrap);
 const drawingTools=document.createElement('div');drawingTools.id='drawing-tools';
 const size=field('Doodle size',100);size.input.type='range';size.input.min='20';size.input.max='500';size.input.disabled=true;
 size.input.oninput=()=>frame.contentWindow.postMessage({type:'article-resize',id:selectedId,width:Number(size.input.value)},location.origin);
 const remove=button('Delete doodle',()=>frame.contentWindow.postMessage({type:'article-delete',id:selectedId},location.origin));remove.disabled=true;
 drawingTools.append(size.wrap,remove,button('Restore doodles',()=>frame.contentWindow.postMessage({type:'article-restore-doodles'},location.origin)));
 source.append(drawingTools,button('Retry saving',()=>flush(true).catch(report)));
 const preview=document.createElement('div');preview.style.cssText='overflow:hidden;height:75vh;min-width:0';frame=document.createElement('iframe');frame.dataset.width='1040';frame.className='preview';frame.title='Article preview; drag doodles to arrange them';preview.append(frame);
 workspace.append(source,preview);app.append(workspace);
 function sizePreview(){const width=Number(frame.dataset.width),scale=Math.min(1,preview.clientWidth/width);frame.style.width=width+'px';frame.style.height=(preview.clientHeight/scale)+'px';frame.style.transform=`scale(${scale})`;frame.style.transformOrigin='top left';}
 previewObserver=new ResizeObserver(sizePreview);previewObserver.observe(preview);sizePreview();renderPreview();
 window.onmessage=event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='article-layout'){article.document.layout=event.data.layout;changed();}
  if(event.data?.type==='article-selection'){selectedId=event.data.id;size.input.value=event.data.width;size.input.disabled=false;remove.disabled=false;}
 };
 publish.onclick=async()=>{
  publish.disabled=true;
  try{await flush();if(failed||change!==saved)throw new Error('Save your changes before publishing.');
   const result=await api(`/api/articles/${article.id}/publish`,{method:'POST',body:JSON.stringify({revision:article.revision})});article.publishedAt=result.publishedAt;edit(article);message('Published');
  }catch(e){report(e);}finally{publish.disabled=false;}
 };
}
async function start(){
 const session=await api('/api/session'),transfer=sessionStorage.getItem(transferKey);
 if(!session.signedIn){app.replaceChildren(text('h1','Article editor'));const link=text('a','Sign in with ChatGPT');link.href='/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search);link.target='_top';app.append(link);return;}
 if(transfer){
  const imported=await api('/api/import',{method:'POST',body:JSON.stringify({token:transfer})});
  sessionStorage.removeItem(transferKey);history.replaceState(null,'',`/editor/?id=${imported.id}`);edit(imported);
  if(imported.existing)message('Opened the existing draft; your edits are preserved.');return;
 }
 if(!session.owner){app.replaceChildren(text('h1','Connect One Word'),text('p','Open a finished post in One Word and choose “prepare for jim.capital”.'));const link=text('a','Open One Word');link.href='https://one-word.jim.capital';app.append(link);return;}
 const id=new URLSearchParams(location.search).get('id');if(id){edit(await api('/api/articles/'+encodeURIComponent(id)));return;}
 const articles=await api('/api/articles');app.replaceChildren(text('h1','Articles'));
 for(const item of articles){const a=text('a',item.title);a.className='article-link';a.href='/editor/?id='+item.id;a.append(text('small',`${item.slug} · ${item.publishedAt?'published':'draft'}`));app.append(a);}
 const link=text('a','Open One Word');link.href='https://one-word.jim.capital';app.append(link);
}
window.addEventListener('beforeunload',event=>{if(change!==saved){event.preventDefault();event.returnValue='';}});
start().catch(error=>{report(error);app.append(button('Retry',()=>location.reload()),button('Discard expired transfer',()=>{sessionStorage.removeItem(transferKey);location.href='/editor/';}));});
