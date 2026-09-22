import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';

// Exercise the actual OrbitControls configuration, before any navigation adapter.
// Selection is LMB; Blender orbit is MMB. These are input contracts, not text matching.
test('viewport reserves LMB for selection and binds MMB to orbit', () => {
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('  controls.enableDamping ='),source.indexOf('  pmremGenerator =',source.indexOf('  controls.enableDamping =')));
  const controls={target:new THREE.Vector3()};
  Function('controls','THREE','camera',block)(controls,THREE,new THREE.PerspectiveCamera(40,1,.01,100));
  assert.equal(controls.mouseButtons.MIDDLE,THREE.MOUSE.ROTATE,'MMB must orbit the kiln instead of dollying');
  assert.equal(controls.mouseButtons.LEFT,null,'selection click must not start an orbit');
  assert.equal(controls.maxDistance,Infinity,'framing authored geometry must not hit the old ten-unit wall');
});

const {navigationPivot,adoptNavigationDepth,orbitCamera,panCamera,zoomCamera,installSceneNavigation} = await import('../scene-navigation.mjs');
const {frameObjects}=await import('../scene-frame-selected.mjs');
const near=(a,b,message='vectors agree')=>assert.ok(a.distanceTo(b)<1e-8,`${message}: ${a.toArray()} vs ${b.toArray()}`);
function cameraAt(z=10){const c=new THREE.PerspectiveCamera(40,4/3,.01,100);c.position.set(0,0,z);c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;}

test('off-center depth adoption preserves the view and zoom remains on its axis',()=>{
 const c=cameraAt(), target=new THREE.Vector3(), point=new THREE.Vector3(1,.5,6), eye=c.position.clone(), q=c.quaternion.clone();
 const before=point.clone().project(c);
 assert.equal(adoptNavigationDepth(c,target,point),true);
 near(c.position,eye);near(target,new THREE.Vector3(0,0,6));assert.ok(c.quaternion.angleTo(q)<1e-8);
 near(point.clone().project(c),before,'depth cannot jump the image');
 zoomCamera(c,target,.5);near(c.position,new THREE.Vector3(0,0,8));near(target,new THREE.Vector3(0,0,6));
});
test('orbit preserves the sampled off-center surface on screen through a whole drag',()=>{
 const c=cameraAt(), target=new THREE.Vector3(), pivot=new THREE.Vector3(1,.5,6);
 adoptNavigationDepth(c,target,pivot);const screen=pivot.clone().project(c), distance=c.position.distanceTo(pivot);
 for(let i=0;i<15;i++)orbitCamera(c,target,pivot,-.01,.02);
 near(pivot.clone().project(c),screen,'the inspected point must not swim');
 assert.ok(Math.abs(c.position.distanceTo(pivot)-distance)<1e-8);
 assert.ok(Math.abs(c.position.distanceTo(target)-4)<1e-8);
});
test('depth samples unselected transformed visible triangles; empty space retains working depth',()=>{
 const c=cameraAt(),target=new THREE.Vector3(),group=new THREE.Group();
 group.position.z=5;
 const surface=new THREE.Mesh(new THREE.PlaneGeometry(3,3),new THREE.MeshBasicMaterial());surface.name='unselected kiln';group.add(surface);
 const hit=navigationPivot(c,target,new THREE.Vector2(),[group]);
 assert.equal(hit.source,'mesh-surface');near(hit.point,new THREE.Vector3(0,0,5));
 adoptNavigationDepth(c,target,hit.point);
 group.visible=false;
 const miss=navigationPivot(c,target,new THREE.Vector2(.8,.2),[surface]);
 assert.equal(miss.source,'retained-depth');assert.equal(miss.point.z,5);assert.notEqual(miss.point.x,0);
 adoptNavigationDepth(c,target,miss.point);near(target,new THREE.Vector3(0,0,5));
});
test('pan follows pointer displacement at working depth and large framing has no old distance wall',()=>{
 const c=cameraAt(),target=new THREE.Vector3(),point=new THREE.Vector3(0,0,6);
 adoptNavigationDepth(c,target,point);const before=point.clone().project(c);
 panCamera(c,target,60,30,600);const after=point.clone().project(c);
 assert.ok(Math.abs(after.x-before.x-120/800)<1e-8);assert.ok(Math.abs(after.y-before.y+60/600)<1e-8);
 const objects=[-50,50].map(x=>{const m=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial());m.position.x=x;return m;});
 const originals=objects.map(o=>o.position.clone());
 const controls={target,update(){c.lookAt(target);c.updateMatrixWorld(true);}};
 assert.ok(frameObjects(objects,c,controls));assert.ok(c.position.distanceTo(target)>10);
 objects.forEach((o,i)=>near(o.position,originals[i]));
 for(const o of objects)for(const x of [-5,5])for(const y of [-5,5])for(const z of [-5,5]){
  const p=new THREE.Vector3(x,y,z).add(o.position).project(c);assert.ok(Math.abs(p.x)<1 && Math.abs(p.y)<1);
 }
});

class Element extends EventTarget {
 constructor(){super();this.clientHeight=600;this.clientWidth=800;this.captures=new Set();this.style={};}
 getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
 contains(e){return e===this;}closest(){return null;}
 setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
}
function emit(node,type,props={}){const e=new Event(type,{cancelable:true});Object.assign(e,props);node.dispatchEvent(e);return e;}
function fixture(){
 const c=cameraAt(),canvas=new Element(),doc=new Element(),win=new Element();
 const controls=new THREE.EventDispatcher();controls.enabled=true;controls.target=new THREE.Vector3();controls.update=()=>{c.lookAt(controls.target);c.updateMatrixWorld(true);};
 let blocked=false,frames=0;
 const nav=installSceneNavigation({camera:c,canvas,viewport:canvas,document:doc,window:win,controls,roots:()=>[],blocked:()=>blocked,frameAll:()=>frames++});
 emit(canvas,'pointerenter');
 return {c,canvas,doc,win,controls,nav,get frames(){return frames;},set blocked(v){blocked=v;}};
}
test('MMB modifiers choose orbit/pan/dolly, and interruptions restore the complete camera pose',()=>{
 for(const mode of ['orbit','pan','dolly']){
  const f=fixture(), modifiers={shiftKey:mode==='pan',ctrlKey:mode==='dolly'};
  const before=f.nav.state();emit(f.canvas,'pointerdown',{button:1,pointerId:1,clientX:400,clientY:300,...modifiers});
  assert.equal(f.nav.state().gesture,mode);
  emit(f.canvas,'pointermove',{pointerId:1,clientX:440,clientY:330,...modifiers});assert.notDeepEqual(f.nav.state().position,before.position);
  if(mode==='dolly')assert.deepEqual(f.nav.state().target,before.target);
  else if(mode==='pan')near(f.c.position.clone().sub(f.controls.target),new THREE.Vector3(0,0,10));
  emit(f.doc,'keydown',{key:'Escape'});assert.deepEqual(f.nav.state().position,before.position);assert.deepEqual(f.nav.state().target,before.target);assert.equal(f.canvas.captures.size,0);
 }
 for(const type of ['blur','pointercancel','lostpointercapture']){
  const f=fixture();emit(f.canvas,'pointerdown',{button:1,pointerId:2,clientX:300,clientY:250});emit(f.canvas,'pointermove',{pointerId:2,clientX:350,clientY:260});
  emit(type==='blur'?f.win:f.canvas,type,{pointerId:2});near(f.c.position,new THREE.Vector3(0,0,10));assert.equal(f.nav.state().gesture,null);
 }
});
test('keyboard and wheel respect focus, modal ownership and controls suspension',()=>{
 const f=fixture();emit(f.doc,'keydown',{key:'3',code:'Numpad3'});near(f.c.position,new THREE.Vector3(10,0,0));
 emit(f.doc,'keydown',{key:'1',code:'Numpad1',ctrlKey:true});near(f.c.position,new THREE.Vector3(0,0,-10));
 emit(f.doc,'keydown',{key:'Home',code:'Home'});assert.equal(f.frames,1);
 for(const gate of ['text','blocked','disabled']){
  const before=f.nav.state();f.doc.activeElement=gate==='text'?{closest:()=>true}:null;f.blocked=gate==='blocked';f.controls.enabled=gate!=='disabled';
  emit(f.doc,'keydown',{key:'3',code:'Numpad3'});assert.deepEqual(f.nav.state().position,before.position);
  if(gate!=='text'){emit(f.canvas,'wheel',{deltaY:120,deltaMode:0,clientX:400,clientY:300});assert.deepEqual(f.nav.state().position,before.position);}
 }
});
