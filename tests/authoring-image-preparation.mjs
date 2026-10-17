// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoringAssets} from '../authoring-assets.mjs';
import {validateImagePreparation} from '../authoring-image-preparation.mjs';

const image={kind:'image',name:'subject.jpg',source:'/api/read?root=image-inbox&path=subject.jpg'};
const prepared={schema:'kaminos.image-preparation.v1',original:{source:image.source,sha256:'original'},prepared:{source:'/api/read?root=image-preparations&path=cutout.png',sha256:'cutout'},route:'rembg-u2net-cpu'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('selection stays immediate; preparation is explicit, reused and passed to generation',async()=>{
 let calls=0,consumed;const c=createAuthoringAssets({prepareImage:async value=>{calls++;assert.equal(value.source,image.source);return prepared;},generator:()=>({read:()=>({status:'idle'}),run:async value=>{consumed=value;return null;}})});
 c.select(image);assert.equal(calls,0);
 assert.equal(typeof c.prepare,'function','Use for generation needs a real preparation operation');
 await c.prepare();await c.prepare();assert.equal(calls,1);assert.equal(c.read().preparation.status,'complete');
 await c.generate();assert.deepEqual(consumed.preparation,prepared);assert.equal(consumed.source,image.source);
});
test('switching images prevents late preparation from replacing the current input',async()=>{
 const gate=deferred();const c=createAuthoringAssets({prepareImage:()=>gate.promise});c.select(image);
 assert.equal(typeof c.prepare,'function','preparation must own late response admission');
 const pending=c.prepare();c.select({...image,source:'/api/read?root=image-inbox&path=other.jpg'});gate.resolve(prepared);await pending;
 assert.equal(c.read().preparation,null);assert.match(c.read().selected.source,/other.jpg$/);
});
test('preparation failure prevents inference; retry can recover without selecting again',async()=>{
 let calls=0,runs=0;const c=createAuthoringAssets({prepareImage:async()=>{if(++calls===1)throw Error('foreground unavailable');return prepared;},generator:()=>({read:()=>({status:'idle'}),run:async()=>{runs++;return null;}})});c.select(image);
 await assert.rejects(c.generate(),/foreground unavailable/);assert.equal(runs,0);assert.equal(c.read().preparation.status,'failed');
 await c.generate();assert.equal(runs,1);assert.equal(calls,2);
});
test('Stop during preparation aborts its transport and never starts mesh inference',async()=>{
 let signal,runs=0;const c=createAuthoringAssets({prepareImage:(_,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},generator:()=>({read:()=>({status:'idle'}),run:async()=>runs++})});c.select(image);
 assert.equal(typeof c.prepare,'function','image preparation needs cancellation before inference');
 const pending=c.prepare();assert.equal(c.generation().status,'preparing');assert.equal(c.stop(),true);await pending;
 assert.equal(signal.aborted,true);assert.equal(runs,0);assert.equal(c.read().preparation.status,'stopped');
});
test('missing, stale, blank, and fallback preparation cannot be admitted as a cutout',()=>{
 const hash='a'.repeat(64),valid={...prepared,status:'complete',original:{source:image.source,sha256:hash},prepared:{source:'/api/read?root=image-preparations&path=cutout.png',sha256:'b'.repeat(64),width:12,height:10},foregroundPixels:20,model:{name:'u2net',sha256:'c'.repeat(64)},providers:['CPUExecutionProvider']};
 const input=valid.original;assert.equal(validateImagePreparation(valid,input),valid);
 for(const value of [{...valid,status:'running'},{...valid,route:'fallback'},{...valid,foregroundPixels:0},{...valid,foregroundPixels:undefined},{...valid,original:{...input,sha256:'d'.repeat(64)}},{...valid,prepared:{...valid.prepared,source:image.source}},{...valid,providers:['CoreMLExecutionProvider']},{...valid,prepared:{...valid.prepared,width:NaN}}])assert.throws(()=>validateImagePreparation(value,input));
});
test('preparing another image cannot hide Stop for an active mesh generation',async()=>{
 let calls=0;const c=createAuthoringAssets({prepareImage:async()=>{calls++;return prepared;},generator:()=>({read:()=>({status:'running',canStop:true}),stop:()=>true})});c.select(image);
 await assert.rejects(c.prepare(),/Finish or stop/);assert.equal(calls,0);assert.equal(c.generation().status,'running');assert.equal(c.stop(),true);
});
test('a service that prepares its own input runs on the selected original, without the server preparation',async()=>{
 let calls=0,consumed;const c=createAuthoringAssets({prepareImage:async()=>{calls++;return prepared;},
  generator:()=>({preparesInput:true,read:()=>({status:'idle'}),run:async value=>{consumed=value;return null;}})});
 c.select(image);assert.equal(c.preparesInput(),true);
 await c.generate();assert.equal(calls,0,'no server preparation');assert.equal(consumed.source,image.source);assert.equal(consumed.preparation,null);
 await c.prepare();assert.equal(calls,1,'the explicit preparation operation still exists');
});
test('the drawer shows a used-input preview only for the image it was made from',async()=>{
 const {usedInputPreviewFor}=await import('../authoring-assets.mjs');
 const preview={source:'/api/read?root=image-inbox&path=a-cutout.png',input:image.source};
 assert.equal(usedInputPreviewFor(preview,image.source),preview.source);
 assert.equal(usedInputPreviewFor(preview,'/api/read?root=image-inbox&path=b.jpg'),null,'another selected image never shows A\'s cutout');
 assert.equal(usedInputPreviewFor(null,image.source),null);assert.equal(usedInputPreviewFor('bare-string',image.source),null,'a preview without its input identity is not shown');
});
test('the used-input status names what the page used, and never calls the original photo a cutout',async()=>{
 const {usedInputPreviewFor,usedInputStatusFor}=await import('../authoring-assets.mjs');
 assert.equal(usedInputPreviewFor({kind:'cutout-unsaved',source:null,input:image.source,error:'disk full'},image.source),null);
 assert.match(usedInputStatusFor({kind:'cutout-unsaved',source:null,input:image.source,error:'disk full'},image.source),/could not be saved.*disk full/);
 assert.match(usedInputStatusFor({kind:'cutout',source:'/c.png',input:image.source},image.source),/cutout generation is using/);
 assert.match(usedInputStatusFor({kind:'original-alpha',source:image.source,input:image.source},image.source),/already has transparency/);
 assert.match(usedInputStatusFor(null,image.source),/prepares the image in this page/);
});
