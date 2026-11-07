// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {OrthographicCamera,Group} from '../lib/three.core.js';
import {createMountedGenerationPrompt} from '../mounted-generation-prompt.mjs';
import {installGenerationFlame} from '../authoring-generation-flame.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
class Element extends EventTarget {
 constructor(){super();this.children=[];this.style={};this.dataset={};this.classList={add(){},remove(){}};this.value='';this.scrollTop=0;this.scrollHeight=180;this.clientWidth=1024;this.clientHeight=768;this.placeholder='';}
 append(...nodes){for(const n of nodes){n.remove?.();this.children.push(n);n.parentNode=this;}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
 setAttribute(){}getAttribute(){return null;}removeAttribute(){}querySelector(){return this.children.find(n=>n.className==='kiln-prompt-plane');}
 getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16)})};}
}
export function fixture(height=180){
 const viewport=new Element(),input=new Element(),home=new Element();home.append(input);let worker;
 class Worker{constructor(){worker=this;}postMessage(message){this.last=message;}terminate(){}}
 const document={body:new Element(),fonts:{ready:Promise.resolve()},createElement:()=>{const e=new Element();e.scrollHeight=height;return e;},getElementById:id=>id==='viewport'?viewport:input,defaultView:{Worker,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame(){},Image:class{async decode(){}},CustomEvent}};
 const camera=new OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=5;camera.updateProjectionMatrix();
 const frame=new Group(),handles=[];let callback;
 const workshop={async attach(root){frame.add(root);const h={id:'prompt',root};handles.push(h);return h;},read:()=>({amount:1}),handles:()=>handles};
 return {document,input,viewport,home,frame,camera,workshop,onFrame:fn=>{callback=fn;return()=>{};},frameTick:()=>callback?.(),worker:()=>worker};
}
test('queued native draft cannot replace admission or admit later edits',async()=>{
 const f=fixture(),timers=new Map();let id=0;const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 globalThis.setTimeout=fn=>{timers.set(++id,fn);return id;};globalThis.clearTimeout=id=>timers.delete(id);
 let view;
 try{
  view=installGenerationFlame({document:f.document,slot:new Element(),createRenderer:(_,options)=>createMountedGenerationPrompt({...f,...options})});await view.setVisible(true);
  f.input.value='ADMITTED';f.input.dispatchEvent(new Event('input'));const queued=[...timers.values()];assert.equal(queued.length,1);
  view.render({status:'loading',request:{id:'request-1',prompt:'ADMITTED'}});await tick();
  // A callback already delivered to the event queue must also observe admission.
  for(const fn of queued)fn();await tick();
  assert.equal(view.read().renderer.request,'request-1');f.input.value='LATER DRAFT';f.input.dispatchEvent(new Event('input'));
  assert.equal(timers.size,0,'no draft preparation while admitted');assert.equal(view.read().renderer.preparation.text,'ADMITTED');
 }finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;f.worker()?.onerror({message:'fixture teardown'});await view?.dispose();}
});

// Rasterized glyph center and native CSS layout must project to the same pixel.
// The fake worker returns production relief geometry; no formula-only oracle.
for(const [height,scroll] of [[180,0],[1000,0],[1000,400]])test(`solid shares native origin: height ${height}, scroll ${scroll}`,async()=>{
 const {createPromptReliefPixels}=await import('../inference-kiln-relief.mjs');
 const {Vector3,Vector4,Matrix4}=await import('../lib/three.core.js');
 const f=fixture(height);f.input.value='GLYPH';f.input.scrollTop=scroll;
 const pending=createMountedGenerationPrompt({...f,prompt:'GLYPH',signal:new AbortController().signal});await tick();
 const pixels={width:1024,height,data:new Uint8ClampedArray(1024*height*4)};
 for(let y=24;y<32;y++)for(let x=64;x<72;x++)pixels.data[(y*1024+x)*4+3]=255;
 const geometry=createPromptReliefPixels(pixels);const worker=f.worker();
 // Raster height belongs to the worker request; the fixture supplies its value.
 const attributes=Object.fromEntries(Object.entries(geometry.attributes).map(([k,a])=>[k,{array:a.array,itemSize:a.itemSize,normalized:a.normalized}]));
 // The fixture raster has the same height as these glyphs.
 worker.onmessage({data:{id:worker.last.id,attributes,groups:geometry.groups,mask:{},samples:[],surface:[]}});
 const consumer=await pending;
 try{
  const root=f.frame.children[0],mesh=root.children[0];f.frameTick();
  const css=new Matrix4().fromArray(f.input.style.transform.slice(9,-1).split(',').map(Number));
  const native=new Vector4(68,28-scroll,0,1).applyMatrix4(css);native.divideScalar(native.w);
  root.updateWorldMatrix(true,true);
  const positions=mesh.geometry.attributes.position;const projected=[];
  for(let i=0;i<positions.count;i++){
   const p=new Vector3().fromBufferAttribute(positions,i);if(Math.abs(p.z-.0175)>.00001)continue;
   p.applyMatrix4(mesh.matrixWorld).project(f.camera);
   projected.push([(p.x+1)*512,(1-p.y)*384]);
  }
  const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);
  const nearest=Math.hypot((Math.min(...xs)+Math.max(...xs))/2-native.x,(Math.min(...ys)+Math.max(...ys))/2-native.y);
  assert.ok(nearest<.01,`native/solid glyph center distance ${nearest}px`);
  assert.equal(root.visible,true,'typing must not hide the mounted root in the native outliner');
  f.input.scrollTop=scroll+80;f.input.dispatchEvent(new Event('scroll'));const shifted=mesh.position.y;
  await consumer.prepare({prompt:'GLYPH',request:{id:'admitted-scroll',prompt:'GLYPH'}});
  f.input.scrollTop=scroll+160;f.input.dispatchEvent(new Event('scroll'));
  assert.equal(mesh.position.y,shifted,'admitted solid retains its scroll origin');
 }finally{await consumer.dispose();geometry.dispose();}
});

test('initial native writing window sits inside the authored kiln opening instead of over the mold',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {Matrix4,Vector3,Quaternion,Euler}=await import('../lib/three.core.js');
 const recipe=JSON.parse(await readFile(new URL('../assets/workshop/cold-stage.json',import.meta.url),'utf8'));
 const kiln=recipe.objects.find(o=>o.type==='glb'&&o.label==='Kiln · composition study').transform;
 const rotation=new Quaternion().setFromEuler(new Euler(...kiln.rotation));
 const inverse=new Matrix4().compose(new Vector3(...kiln.position),rotation,new Vector3(...kiln.scale)).invert();
 const f=fixture(),consumer=await createMountedGenerationPrompt({...f,signal:new AbortController().signal});
 try{
  const root=f.frame.children[0];root.updateMatrix();
  // Authored opening clearance in the kiln asset's local units. This tests the
  // visible native window, not the unbounded submitted prompt's glyph count.
  for(const x of [-1,1])for(const y of [-520/1024,520/1024]){
   const p=new Vector3(x,y,.018).applyMatrix4(root.matrix).applyMatrix4(inverse);
   assert.ok(p.x>-.23&&p.x<.23&&p.y>-.22&&p.y<.22&&p.z>.1&&p.z<.3,`writing corner outside kiln opening: ${p.toArray()}`);
  }
  assert.ok(Math.abs(root.quaternion.dot(rotation))>1-1e-8,'writing plane faces the same direction as its kiln');
 }finally{await consumer.dispose();}
});

test('the mounted lettering owns a stationary render aperture carried by its native pose',async()=>{
 const f=fixture(),consumer=await createMountedGenerationPrompt({...f,signal:new AbortController().signal});
 try{f.frameTick();const root=f.frame.children[0];assert.equal(root.isClippingGroup,true,'long solid lettering needs the same bounded opening as its native editor');assert.equal(root.clippingPlanes.length,2);}finally{await consumer.dispose();}
});

test('admission reuses the prepared draft geometry without another full vertex-buffer clone',async()=>{
 const f=fixture();f.input.value='ADMITTED';
 const pending=createMountedGenerationPrompt({...f,prompt:'ADMITTED',signal:new AbortController().signal});await tick();const worker=f.worker();
 worker.onmessage({data:{id:worker.last.id,attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,1,0]),itemSize:3,normalized:false}},groups:[],mask:{},samples:[],surface:[]}});
 const consumer=await pending;
 try{const mesh=f.frame.children[0].children[0],geometry=mesh.geometry;await consumer.prepare({prompt:'ADMITTED',request:{id:'real-request',prompt:'ADMITTED'}});assert.equal(mesh.geometry,geometry,'admitting the already prepared draft must retain its geometry');assert.equal(consumer.debugState().request,'real-request');}finally{await consumer.dispose();}
});

test('thermal preparation precedes admission and retains the same body with the same draft',async()=>{
 const f=fixture();let constructions=0,disposals=0,mask;const visibility=[];
 const consumer=await createMountedGenerationPrompt({...f,signal:new AbortController().signal,createBurnBody:async args=>{constructions++;mask=args.surfaceMask;return {setMounted:v=>visibility.push(v),dispose:()=>disposals++,read:()=>({steps:0})};}});
 try{
  const draft=consumer.prepare({prompt:'COLD DRAFT'});await tick();const worker=f.worker();
  worker.onmessage({data:{id:worker.last.id,attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,1,.1]),itemSize:3,normalized:false}},groups:[],mask:{},samples:[],surface:[]}});
  await draft;assert.equal(constructions,1,'real thermal body must be prepared with the draft, before Generate');assert.ok(mask);
  await consumer.prepare({prompt:'COLD DRAFT',request:{id:'admitted',prompt:'COLD DRAFT'}});
  assert.equal(constructions,1,'admission must reuse the prepared thermal body');assert.equal(disposals,0);f.frameTick();assert.equal(visibility.at(-1),false,'attached char remains hidden during native editing');
 }finally{await consumer.dispose();}
 assert.equal(disposals,1,'consumer disposal releases retained thermal state');
});

test('in-flight thermal construction is reused on admission and disposed before replacing the draft',async()=>{
 const f=fixture(),events=[];let releaseBody;
 const consumer=await createMountedGenerationPrompt({...f,signal:new AbortController().signal,createBurnBody:async({entry})=>{
  const geometry=entry.object.children[0].geometry;events.push(['start',geometry]);
  await new Promise(resolve=>{releaseBody=resolve;});events.push(['built',geometry]);
  return {setMounted(){},read:()=>({steps:0}),dispose(){assert.equal(entry.object.children[0].geometry,geometry,'dispose must precede geometry replacement');events.push(['disposed',geometry]);}};
 }});
 const answer=async()=>{await tick();const worker=f.worker();worker.onmessage({data:{id:worker.last.id,attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,1,.1]),itemSize:3,normalized:false}},groups:[],mask:{},samples:[],surface:[]}});await tick();};
 try{
  const draft=consumer.prepare({prompt:'FIRST'});await answer();assert.equal(events.length,1);
  const admit=consumer.prepare({prompt:'FIRST',request:{id:'first'}});releaseBody();await Promise.all([draft,admit]);assert.equal(events.length,2,'same admission must not rebuild');
  const next=consumer.prepare({prompt:'SECOND'});await answer();assert.deepEqual(events.map(e=>e[0]),['start','built','disposed','start']);
  const clear=consumer.prepare({prompt:''});releaseBody();await Promise.all([next,clear]);assert.deepEqual(events.map(e=>e[0]),['start','built','disposed','start','built','disposed']);assert.equal(consumer.thermalBody,null);
 }finally{await consumer.dispose();}
});

test('admitted text activates the prepared shared field and Return only suspends its clock',async()=>{
 const f=fixture();let amount=1,now=0,resets=0;f.workshop.read=()=>({amount});const calls=[];
 const fire={prepare:async()=>calls.push('prepared'),setActive:async v=>calls.push(['active',v]),present:async v=>calls.push(['visible',v]),setEmission:v=>calls.push(['emitting',v]),dispose:async()=>{},read:()=>({phase:'prepared'})};
 const consumer=await createMountedGenerationPrompt({...f,signal:new AbortController().signal,createFire:async()=>fire,clock:()=>now,createBurnBody:async()=>({setMounted(){},reset(){resets++;},read:()=>({steps:0}),dispose(){}})});
 try{const work=consumer.prepare({prompt:'BURN'});await tick();const w=f.worker();w.onmessage({data:{id:w.last.id,attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,1,.1]),itemSize:3,normalized:false}},groups:[],mask:{},samples:[],surface:[]}});await work;
 await consumer.prepare({prompt:'BURN',request:{id:'first',prompt:'BURN'}});f.frameTick();await consumer.setActive(true);assert.equal(resets,1);now=1000;f.frameTick();amount=.5;f.frameTick();assert.deepEqual(calls.filter(x=>Array.isArray(x)&&x[0]==='visible').at(-1),['visible',false],'partial transition must withdraw native binary-shadow fire before fading');amount=0;f.frameTick();const before=consumer.debugState().burner.elapsedSeconds;now=9000;f.frameTick();assert.equal(consumer.debugState().burner.elapsedSeconds,before);amount=1;f.frameTick();assert.equal(resets,1);assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='emitting'&&x[1]));
 }finally{await await consumer.dispose();}
});

test('keyboard admission reveals the solid once and preserves subsequent deliberate editing',async()=>{
 const {installKilnPromptEditor}=await import('../kiln-prompt-editor.mjs');
 const f=fixture(),presentation={visible:true},object=new Group();let blurs=0;
 f.input.value='ADMITTED';f.document.activeElement=f.input;
 f.input.blur=()=>{blurs++;f.document.activeElement=null;f.input.dispatchEvent(new Event('blur'));};
 const editor=installKilnPromptEditor({...f,object,presentation});
 try{
  editor.setBurning(true);
  assert.equal(presentation.visible,true,'keyboard admission must reveal physical lettering without requiring a click elsewhere');
  assert.equal(blurs,1);assert.equal(f.input.value,'ADMITTED');
  f.document.activeElement=f.input;f.input.dispatchEvent(new Event('focus'));editor.setBurning(true);
  assert.equal(blurs,1,'repeated running state must not steal deliberate editing focus');
  assert.equal(f.document.activeElement,f.input);
 }finally{editor.dispose();}
});
