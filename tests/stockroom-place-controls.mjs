// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {SceneTransformControls} from '../scene-transform-gizmo.mjs';
import {initialPlace} from '../stockroom-place-state.mjs';
import {createPlaceView} from '../stockroom-place-view.mjs';
import {installPlaceControls} from '../stockroom-place-controls.mjs';
import definition from '../experiments/stockroom-place.experiment.mjs';

class Element {
 constructor(){this.style={};this.dataset={};this.listeners=new Map();this.children=[];}
 addEventListener(name,fn,capture=false){const rows=this.listeners.get(name)??[];rows.push({fn,capture:!!capture});this.listeners.set(name,rows);}
 removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)??[]).filter(row=>row.fn!==fn));}
 append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parentElement=this;}
 setAttribute(){} contains(node){return this===node||this.children.some(child=>child.contains(node));} remove(){}
 setPointerCapture(){} releasePointerCapture(){}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:800,bottom:800};}
 dispatch(name,values={}){
  const e={button:0,buttons:0,pointerId:1,pointerType:'mouse',target:this,...values,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  const path=[];for(let node=this;node;node=node.parentElement)path.push(node);
  for(const capture of [true,false])for(const node of capture?[...path].reverse():path){for(const row of [...(node.listeners.get(name)??[])]){if(row.capture===capture&&!e.stopped)row.fn(e);}if(e.stopped)return e;}
  return e;
 }
}
function fixture({native=false}={}){
 const win=new Element(),queue=new Map();let serial=0,tick,active=false;
 win.requestAnimationFrame=fn=>{queue.set(++serial,fn);return serial;};win.cancelAnimationFrame=id=>queue.delete(id);
 win.kaminosSceneEdits={state:()=>({active})};
 const doc={defaultView:win,createElement:()=>new Element(),querySelectorAll:()=>[]};
 const viewport=new Element(),canvas=new Element();win.append(viewport);viewport.append(canvas);canvas.ownerDocument={pointerLockElement:null};
 const camera=new T.PerspectiveCamera(43,1.25,.1,100);camera.position.set(0,9,7);camera.lookAt(0,1.2,0);camera.updateMatrixWorld(true);
 const session={redraw(){},onFrame(fn){tick=fn;return ()=>{};},readView(){return {};}};
 const host={controls:{document:doc},scene:{renderer:()=>({domElement:canvas}),camera:()=>camera,navigation:()=>({state:()=>({gesture:null}),cancel(){}})}};
 const inputs=initialPlace();inputs.mode='work';inputs.realization='deck';inputs.insert.center=[0,0];inputs.insert.fitted=true;
 const view=createPlaceView(),scene=new T.Scene();scene.add(view.root);
 let gizmo;
 if(native){gizmo=new SceneTransformControls(camera,canvas);scene.add(gizmo.getHelper());gizmo.attach(view.root);gizmo.addEventListener('mouseDown',()=>active=true);}
 const ctl=installPlaceControls({host,session,view,asset:{id:'fixture',root:view.root},inputs,record(){}});scene.updateMatrixWorld(true);tick();
 const move=(x,y)=>{canvas.dispatch('pointermove',{clientX:x,clientY:y});for(const [id,fn]of [...queue]){queue.delete(id);fn();}};
 const at=point=>{const v=new T.Vector3(...point).project(camera);return {clientX:(v.x+1)*500,clientY:(1-v.y)*400};};
 return {canvas,viewport,win,camera,view,ctl,gizmo,at,move,tick:()=>tick(),dispose(){gizmo?.dispose();ctl.dispose();view.dispose();}};
}

test('native transform entry precedes domain pointer ownership',()=>{
 const prior=globalThis.document;globalThis.document={pointerLockElement:null};
 const f=fixture({native:true});
 try{
  const grip=f.gizmo._gizmo.gizmo.translate.children.find(node=>node.name==='X');
  const world=new T.Vector3(.56,0,0).applyMatrix4(grip.matrixWorld),point=f.at(world.toArray());
  f.canvas.dispatch('pointerdown',point);
  assert.equal(f.gizmo.dragging,true,'The actual pinned native controller receives its handle press');
  assert.equal(f.ctl.read().interaction.stage,'idle','A native press cannot start domain fitting');
 }finally{f.dispose();globalThis.document=prior;}
});

test('fitting rebases after camera navigation without a first-move jump',()=>{
 const f=fixture();try{
  const p=f.at([0,1.2,0]);f.canvas.dispatch('pointerdown',p);f.move(p.clientX+15,p.clientY);
  f.canvas.dispatch('pointerdown',{...p,button:2,clientX:p.clientX+15});f.move(p.clientX+35,p.clientY);
  f.camera.position.x+=.7;f.camera.lookAt(0,1.2,0);f.camera.updateMatrixWorld(true);f.tick();
  f.canvas.dispatch('pointerup',{...p,button:2,clientX:p.clientX+35});
  const before=f.ctl.read().place.insert.center;f.move(p.clientX+35,p.clientY);
  assert.deepEqual(f.ctl.read().place.insert.center,before,'Navigation displacement is not authoring input');
  f.move(p.clientX+45,p.clientY);assert.notDeepEqual(f.ctl.read().place.insert.center,before,'Fresh motion still adjusts the fit');
 }finally{f.dispose();}
});

test('modified selection clicks retain the native viewport route',()=>{
 const f=fixture(),seen=[];try{
  for(const name of ['pointerdown','pointerup','click'])f.viewport.addEventListener(name,()=>seen.push(name));
  const point={...f.at([1,1.2,.8]),shiftKey:true};
  for(const name of ['pointerdown','pointerup','click'])f.canvas.dispatch(name,point);
  assert.deepEqual(seen,['pointerdown','pointerup','click']);assert.equal(f.ctl.read().interaction.stage,'idle');
 }finally{f.dispose();}
});

for(const independent of [null,.49])test(`failed create restores only its own GI change (${independent??'unchanged'})`,async()=>{
 let scale=.73,disposed=false;
 const session={async attach(root){return {id:'fixture',root};},async dispose(){disposed=true;}};
 const host={controls:{document:{defaultView:{}}},scene:{async open(){return session;},renderer:()=>({domElement:{parentElement:{}}}),camera:()=>({}),navigation(){if(independent!==null)scale=independent;return {};}},rendering:{readGI:()=>({resolutionScale:scale}),gi(value){scale=value.resolutionScale;}}};
 await assert.rejects(definition.create({host,inputs:{place:{schema:'invalid'}},record(){}}),/place allocation/);
 assert.equal(disposed,true);assert.equal(scale,independent??.73);
});
