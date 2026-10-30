// kaminos-test: node
import {createAuthoringAssets} from '../authoring-assets.mjs';
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
class Element{
 constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.value='';this.title='';this.hidden=false;this.connected=true;this.style={};this.listeners={};this.classList={toggle(){},add(){},remove(){}};}
 set id(value){this._id=value;this.doc.ids.set(value,this);}get id(){return this._id;}
 set innerHTML(value){for(const match of value.matchAll(/id="([^"]+)"/g)){const e=new Element('div',this.doc);e.id=match[1];this.doc.ids.set(e.id,e);}this.modes=['browse','generate'].map(mode=>{const e=new Element('button',this.doc);e.dataset.assetsMode=mode;return e;});}
 append(...nodes){for(const e of nodes){e.connected=true;this.children.push(e);}}
 prepend(e){this.children.unshift(e);}
 replaceChildren(...nodes){for(const e of this.children)e.connected=false;this.children=[];this.append(...nodes);}
 querySelector(id){if(id.startsWith('#'))return this.doc.getElementById(id.slice(1));return this.children.find(e=>e.tagName===id)||null;}
 querySelectorAll(selector){if(selector==='[data-assets-mode]')return this.modes||[];const all=this.children.flatMap(e=>[e,...e.querySelectorAll(selector)]);return selector==='.asset-entry'?all.filter(e=>e.className==='asset-entry'):all;}
 setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
 addEventListener(type,fn){this.listeners[type]=fn;}dispatch(type){this.listeners[type]?.();}contains(){return false;}get isConnected(){return this.connected;}getBoundingClientRect(){return{height:300};}
}
function fixture(thumbnails,providedController=null){
 const ids=new Map();let observer;
 const doc={ids,createElement:tag=>new Element(tag,doc),getElementById:id=>ids.get(id),activeElement:null,addEventListener(){},defaultView:{innerWidth:1500,addEventListener(){},IntersectionObserver:class{constructor(fn){this.fn=fn;this.watched=new Set();observer=this;}observe(e){this.watched.add(e);}unobserve(e){this.watched.delete(e);}disconnect(){this.watched.clear();}fire(e){if(this.watched.has(e))this.fn([{target:e,isIntersecting:true}]);}}}};doc.body=new Element('body',doc);doc.body.clientHeight=1050;doc.body.classList={add(){},remove(){}};doc.body.style={setProperty(){},removeProperty(){}};ids.set('authoring-header',new Element('header',doc));
 const source=readFileSync(new URL('../authoring-assets.mjs',import.meta.url),'utf8').replaceAll('export ','').replace("import('./authoring-asset-previews.mjs')","getPreview()");const install=new Function('getPreview',source+'\nreturn installAuthoringAssets;')(()=>Promise.resolve({meshThumbnail:thumbnails}));
 const state={roots:[{id:'greenroom'}],root:'greenroom',path:'',catalog:true,listRevision:1,entries:[],results:[],warnings:[],unavailableCount:0};
 const generation={status:'idle'};let stops=0;const controller=providedController||{read:()=>state,generation:()=>generation,refresh:async()=>{},select(){},stop(){stops++;}};const ui=install({document:doc,controller,edits:{state:()=>({active:null})}});
 return{doc,state,ui,generation,stops:()=>stops,observer:()=>observer,mode:mode=>doc.body.children[0].modes.find(e=>e.dataset.assetsMode===mode).onclick()};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('held image and mesh cards remain named without thumbnails, preview work or selected-image requests',async()=>{
 let previewCalls=0;const f=fixture(async()=>{previewCalls++;return 'preview';});
 const visibility={status:'withheld',reason:'Hostile to eyesight. Awaiting further review.'};
 f.state.entries=[{kind:'image',root:'greenroom',path:'held.png',label:'Lirm study',source:'/api/job-output?job_id=held&file=output.png',visibility},{kind:'mesh',root:'greenroom',path:'held.glb',label:'Lirm reconstruction',source:'/api/job-output?job_id=held&file=output.glb',visibility},{kind:'image',path:'normal.png',label:'Ordinary image',source:'/api/read?root=image-inbox&path=normal.png'}];
 f.ui.open('browse');const [image,mesh,normal]=f.doc.getElementById('asset-entries').children;
 assert.equal(image.children.filter(e=>e.tagName==='img').length,0,'a hold must prevent creating an image request');
 assert.equal(normal.children.filter(e=>e.tagName==='img').length,1,'ordinary images still have thumbnails');
 assert.equal(image.dataset.visibility,'withheld');assert.equal(mesh.dataset.visibility,'withheld');
 assert.equal(f.observer().watched.has(mesh),false,'held meshes must never enter the thumbnail queue');
 f.observer().fire(mesh);await tick();assert.equal(previewCalls,0);
 f.state.selected=f.state.entries[2];f.ui.render(f.state);assert.equal(f.doc.getElementById('asset-image').src,f.state.selected.source);
 f.state.selected=f.state.entries[0];f.ui.render(f.state);
 assert.equal(f.doc.getElementById('asset-image').hidden,true);assert.equal(f.doc.getElementById('asset-image').getAttribute('src'),null);
 assert.equal(f.doc.getElementById('asset-use-image').hidden,true);assert.equal(f.doc.getElementById('asset-hold-notice').hidden,false);
 assert.equal(f.doc.getElementById('asset-name').textContent,'Lirm study');
 f.state.selected=f.state.entries[1];f.ui.render(f.state);assert.equal(f.doc.getElementById('asset-add').hidden,true);
});
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

test('catalog loading has a visible subtle indicator and ends its busy state',()=>{
 const f=fixture(async()=>null);f.state.loading=true;f.ui.render(f.state);const spinner=f.doc.getElementById('asset-loading');assert.ok(spinner,'loading text also needs a visible spinner');assert.equal(spinner.hidden,false);assert.equal(f.doc.getElementById('authoring-assets').getAttribute('aria-busy'),'true');f.state.loading=false;f.ui.render(f.state);assert.equal(spinner.hidden,true);
});
test('generation remains controllable in the header when the authoring pane is outside Workbench',()=>{
 const f=fixture(async()=>null);Object.assign(f.generation,{status:'running',stage:'Two-stream',percent:40,canStop:true,progress:'Two-stream duties 1156/2922 (40%)'});f.doc.body.dataset.workspace='workbench';f.ui.render(f.state);const header=f.doc.getElementById('authoring-generation-header');assert.ok(header,'active inference needs a workspace-independent control');assert.equal(header.hidden,false);f.doc.getElementById('generation-header-stop').onclick();assert.equal(f.stops(),1);
});

const selectedImage={kind:'image',name:'subject.png',source:'/api/read?root=image-inbox&path=subject.png'};
function imageController({selfPrepares=false}={}){
 let preparations=0,requests=0;
 const prepared={route:'input-alpha',original:{source:selectedImage.source},prepared:{source:selectedImage.source}};
 const controller=createAuthoringAssets({request:async url=>{requests++;return url==='/api/roots'?{'generated-meshes':{exists:true},'image-inbox':{exists:true}}:{schema:'kaminos.authoring-assets.v1',collection:'generated-meshes',entries:[]};},prepareImage:async()=>{preparations++;return prepared;},generator:()=>({preparesInput:selfPrepares,read:()=>({status:'idle',results:[]})})});
 controller.select(selectedImage);return{controller,prepared,preparations:()=>preparations,requests:()=>requests};
}
test('opening Generate carries the selected image and accepted preparation without catalog navigation',async()=>{
 const f=imageController();await f.controller.prepare();const ui=fixture(async()=>null,f.controller);
 await ui.ui.open('generate');
 assert.deepEqual(f.controller.read().selected,selectedImage,'opening Generate must keep the image chosen in Browse');
 assert.deepEqual(f.controller.read().preparation.value,f.prepared,'opening the same input does not discard its accepted preparation');
 assert.equal(f.requests(),0,'changing presentation does not navigate the catalog');
});
test('Use for generation lets a self-preparing model use the selected original while explicit Prepare still works',async()=>{
 const f=imageController({selfPrepares:true}),ui=fixture(async()=>null,f.controller);
 ui.doc.getElementById('asset-use-image').onclick();await tick();
 assert.equal(ui.ui.state().mode,'generate');assert.deepEqual(f.controller.read().selected,selectedImage);
 assert.equal(f.preparations(),0,'a self-preparing model needs no unused server preparation');
 ui.doc.getElementById('asset-prepare').onclick();await tick();assert.equal(f.preparations(),1,'explicit Prepare remains an operation');
});
test('Use for generation retains preparation for services that require it',async()=>{
 const f=imageController(),ui=fixture(async()=>null,f.controller);
 ui.doc.getElementById('asset-use-image').onclick();await tick();
 assert.equal(f.preparations(),1);assert.deepEqual(f.controller.read().preparation.value,f.prepared);
});
test('for a self-preparing model the drawer reports the page cutout, even over a retained server-preparation error',async()=>{
 const preview={kind:'cutout-unsaved',source:null,error:'disk full',input:selectedImage.source};
 const controller=createAuthoringAssets({request:async url=>url==='/api/roots'?{'image-inbox':{exists:true}}:{schema:'kaminos.authoring-assets.v1',collection:'image-inbox',entries:[]},
  prepareImage:async()=>{throw Error('server preparation unavailable');},
  generator:()=>({preparesInput:true,read:()=>({status:'complete',results:[],inputPreview:preview})})});
 controller.select(selectedImage);await controller.prepare().catch(()=>{});
 assert.equal(controller.read().preparation.error,'server preparation unavailable','the server error is retained');
 const ui=fixture(async()=>null,controller);await ui.ui.open('generate');await tick();ui.ui.render(controller.read());
 assert.match(ui.doc.getElementById('asset-preparation-status').textContent,/could not be saved.*disk full/,'the drawer must disclose the page cutout save failure');
});

test('expanding another agent uses the current canonical selected source',()=>{
 const f=fixture(async()=>null);
 const a={kind:'image',root:'agent-work',path:'output.png',label:'Output',name:'output.png',source:'/api/job-output?job_id=a&file=output.png',agent:{id:'a',label:'Agent A'},producedAt:2};
 const b={...a,source:'/api/job-output?job_id=b&file=output.png',agent:{id:'b',label:'Agent B'},producedAt:1};
 f.state.root='agent-work';f.state.entries=[a,b];f.state.listRevision++;f.state.selected=a;f.ui.render(f.state);
 const group=f.doc.getElementById('asset-entries').children[1];group.open=true;group.dispatch('toggle');
 const tile=group.children[1].children[0];assert.equal(tile.dataset.assetPath,b.source);assert.equal(tile.getAttribute('aria-pressed'),'false');
 // Selection changes after the group is constructed must also be seen at expansion.
 group.open=false;group.dispatch('toggle');f.state.listRevision++;f.state.selected=null;f.ui.render(structuredClone(f.state));f.state.selected=b;
 const own=f.doc.getElementById('asset-entries').children[1];own.open=true;own.dispatch('toggle');
 assert.equal(own.children[1].children[0].getAttribute('aria-pressed'),'true');
});
