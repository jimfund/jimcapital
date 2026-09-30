import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderArticle } from '../cloud/content.js';
const script=readFileSync(new URL('../cloud/article.js',import.meta.url),'utf8');
const doc={title:'Article',markdown:'A paragraph.',drawings:[{id:'drawing',width:100,height:100,paths:['M0 0 L100 100']}],layout:{wide:{},narrow:{},deleted:[]}};
function editor(editing){
 const dom=new JSDOM(renderArticle(doc,{editing,slug:'practicehaven/test'}),{url:'https://jim.example/editor/preview/test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.articleEditing=editing;w.matchMedia=()=>({matches:false});w.ResizeObserver=class{observe(){}};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return this.classList.contains('page')?{left:0,top:0,width:1000,height:2000}:{left:20,top:100,width:100,height:100};};
 const messages=[];w.postMessage=message=>messages.push(message);w.eval(script);return {w,messages,close:()=>dom.window.close()};
}
test('Delete persists removal, undo restores, resizing and keyboard placement save layout',()=>{
 const {w,messages,close}=editor(true);const image=w.document.querySelector('.decoration img'),figure=image.parentElement;
 image.focus();image.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
 assert.equal(figure.style.visibility,'hidden');assert.deepEqual(Array.from(messages.at(-1).layout.deleted),['drawing']);
 w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));assert.equal(figure.style.visibility,'');
 image.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.ok(messages.at(-1).layout.wide.drawing.x>0);
 w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:w,data:{type:'article-resize',id:'drawing',width:230}}));assert.equal(messages.at(-1).layout.wide.drawing.width,230);
 close();
});
test('published articles never enable dragging, deletion or layout writes',()=>{
 const {w,messages,close}=editor(false);const image=w.document.querySelector('.decoration img');
 assert.equal(image.tabIndex,-1);assert.equal(image.parentElement.classList.contains('movable'),false);
 image.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
 w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:w,data:{type:'article-delete',id:'drawing'}}));
 assert.equal(image.parentElement.style.visibility,'');assert.equal(messages.length,0);close();
});
