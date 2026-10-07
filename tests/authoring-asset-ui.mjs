import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
class Element{
 constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.value='';this.title='';this.hidden=false;this.connected=true;this.style={};}
 set innerHTML(value){for(const match of value.matchAll(/id="([^"]+)"/g)){const e=new Element('div',this.doc);e.id=match[1];this.doc.ids.set(e.id,e);}this.modes=['browse','generate'].map(mode=>{const e=new Element('button',this.doc);e.dataset.assetsMode=mode;return e;});}
 append(...nodes){for(const e of nodes){e.connected=true;this.children.push(e);}}
 prepend(e){this.children.unshift(e);}
 replaceChildren(...nodes){for(const e of this.children)e.connected=false;this.children=[];this.append(...nodes);}
 querySelector(id){return this.doc.getElementById(id.replace('#',''));}
 querySelectorAll(){return this.modes||[];}
 setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
 addEventListener(){}contains(){return false;}get isConnected(){return this.connected;}getBoundingClientRect(){return{height:300};}
}
function fixture(thumbnails){
 const ids=new Map();let observer;
 const doc={ids,createElement:tag=>new Element(tag,doc),getElementById:id=>ids.get(id),activeElement:null,addEventListener(){},defaultView:{innerWidth:1500,addEventListener(){},IntersectionObserver:class{constructor(fn){this.fn=fn;this.watched=new Set();observer=this;}observe(e){this.watched.add(e);}unobserve(e){this.watched.delete(e);}disconnect(){this.watched.clear();}fire(e){if(this.watched.has(e))this.fn([{target:e,isIntersecting:true}]);}}}};doc.body=new Element('body',doc);doc.body.clientHeight=1050;doc.body.classList={add(){},remove(){}};doc.body.style={setProperty(){},removeProperty(){}};
 const source=readFileSync(new URL('../authoring-assets.mjs',import.meta.url),'utf8').replaceAll('export ','').replace("import('./authoring-asset-previews.mjs')","getPreview()");const install=new Function('getPreview',source+'\nreturn installAuthoringAssets;')(()=>Promise.resolve({meshThumbnail:thumbnails}));
 const state={roots:[{id:'greenroom'}],root:'greenroom',path:'',catalog:true,listRevision:1,entries:[],results:[],warnings:[],unavailableCount:0};
 const controller={read:()=>state,generation:()=>({status:'idle'}),refresh:async()=>{},select(){},stop(){}};const ui=install({document:doc,controller,edits:{state:()=>({active:null})}});
 return{doc,state,ui,observer:()=>observer,mode:mode=>doc.body.children[0].modes.find(e=>e.dataset.assetsMode===mode).onclick()};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('unavailable historical results remain explained beside available or empty catalogs',()=>{
 const f=fixture(async()=>null);f.state.unavailableCount=1928;f.state.entries=[{kind:'image',name:'image.png',source:'/api/job-output?job_id=a&file=image.png'}];f.ui.render(f.state);assert.match(f.doc.getElementById('asset-status').textContent,/1928.*unavailable/);
 f.state.entries=[];f.state.listRevision++;f.ui.render(f.state);assert.match(f.doc.getElementById('asset-status').textContent,/1928.*unavailable/);
});
test('actual preview queue and UI recover the same skipped card after Generate returns to Browse',async()=>{
 let release;const gate=new Promise(r=>release=r),loads=[];
 const queueSource=readFileSync(new URL('../authoring-asset-previews.mjs',import.meta.url),'utf8').split('export function meshThumbnail')[1];
 const thumbnail=new Function('preview',`let tail=Promise.resolve();const cache=new Map();function meshThumbnail${queueSource};return meshThumbnail;`)(async entry=>{loads.push(entry.source);if(entry.source==='a')await gate;return 'actual-provider-result';});
 const f=fixture(thumbnail);f.state.entries=[{kind:'mesh',name:'a.glb',source:'a'},{kind:'mesh',name:'b.glb',source:'b'}];f.ui.open('browse');const [a,b]=f.doc.getElementById('asset-entries').children;f.observer().fire(a);f.observer().fire(b);await tick();f.mode('generate');release();await tick();await tick();f.mode('browse');f.observer().fire(b);await tick();await tick();assert.deepEqual(loads,['a','b']);assert.equal(b.dataset.previewState,'rendered');
});
