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
 }finally{consumer.dispose();geometry.dispose();}
});
