import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';

// Exercise the actual OrbitControls configuration; the adapter owns Blender mouse navigation.
test('viewport reserves LMB for selection and leaves navigation buttons to the modal adapter', () => {
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('  controls.enableDamping ='),source.indexOf('  pmremGenerator =',source.indexOf('  controls.enableDamping =')));
  const controls={target:new THREE.Vector3()};
  Function('controls','THREE','camera',block)(controls,THREE,new THREE.PerspectiveCamera(40,1,.01,100));
  assert.equal(controls.mouseButtons.MIDDLE,null,'MMB events must reach the modal adapter');
  assert.equal(controls.mouseButtons.RIGHT,null,'RMB events must reach the modal adapter');
  assert.equal(controls.mouseButtons.LEFT,null,'selection click must not start an orbit');
  assert.equal(controls.maxDistance,Infinity,'authored geometry framing must not hit the old ten-unit wall');
});

const {navigationPivot,prepareNavigationGeometry,invalidateNavigationGeometry,adoptNavigationDepth,orbitCamera,panCamera,zoomCamera,installSceneNavigation} = await import('../scene-navigation.mjs');
const {frameObjects,frameObject,frameSceneObjectRecord,sceneObjectsForFraming}=await import('../scene-frame-selected.mjs');
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
test('prepared dense geometry keeps exact surface depth without changing the rendered index',async()=>{
 const c=cameraAt(),target=new THREE.Vector3(),root=new THREE.Group();
 const geometry=new THREE.PlaneGeometry(4,4,200,200);
 const index=Array.from(geometry.index.array);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.position.z=4;root.add(mesh);
 const expected=navigationPivot(c,target,new THREE.Vector2(),[root]);
 await prepareNavigationGeometry(root);
 assert.ok(geometry.boundsTree,'dense mesh has a reusable triangle index');
 assert.deepEqual(Array.from(geometry.index.array),index,'preparation cannot reorder render triangles');
 const actual=navigationPivot(c,target,new THREE.Vector2(),[root]);
 near(actual.point,expected.point);
 assert.equal(actual.source,'mesh-surface');
});
test('a winding edit invalidates the old surface index before rebuilding',async()=>{
 const c=cameraAt(),target=new THREE.Vector3(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial());
 await prepareNavigationGeometry(mesh);
 assert.equal(navigationPivot(c,target,new THREE.Vector2(),[mesh]).source,'mesh-surface');
 const index=mesh.geometry.index;
 for(let i=0;i<index.count;i+=3){const a=index.array[i+1];index.array[i+1]=index.array[i+2];index.array[i+2]=a;}
 index.needsUpdate=true;
 await invalidateNavigationGeometry(mesh);
 assert.equal(navigationPivot(c,target,new THREE.Vector2(),[mesh]).source,'retained-depth');
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

test('selected and all-object framing include visible splat point-cloud records',()=>{
 const pointGeometry=new THREE.BufferGeometry();
 pointGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-4,-1,0,4,1,0],3));
 const points=new THREE.Points(pointGeometry,new THREE.PointsMaterial());
 const object=new THREE.Group();object.add(points);
 const records=[{id:'splat-1',type:'splat',object},{id:'mesh-1',type:'mesh',object:new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial())}];
 assert.deepEqual(sceneObjectsForFraming(records,'splat-1'),[object],'F on a selected splat must frame its authored point geometry');
 assert.deepEqual(sceneObjectsForFraming(records),records.map(record=>record.object),'Home must include all visible authored record types');
 const c=cameraAt(),target=new THREE.Vector3(),controls={target,update(){c.lookAt(target);c.updateMatrixWorld(true);}};
 assert.ok(frameObjects(sceneObjectsForFraming(records,'splat-1'),c,controls));
 for(const x of [-4,4]){const p=new THREE.Vector3(x,0,0).project(c);assert.ok(Math.abs(p.x)<1 && Math.abs(p.y)<1,'framed point-cloud bounds must fit the viewport');}
});

test('framing an offset mesh includes its authored pivot so F restores pivot visibility',()=>{
 const root=new THREE.Group();root.position.x=-100;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());mesh.position.x=100;root.add(mesh);
 const c=cameraAt(),target=new THREE.Vector3(),controls={target,update(){c.lookAt(target);c.updateMatrixWorld(true);}};
 assert.ok(frameObject(root,c,controls));
 const pivot=root.getWorldPosition(new THREE.Vector3()).project(c);
 assert.ok(Math.abs(pivot.x)<1 && Math.abs(pivot.y)<1,'selected authored origin must remain inside the framed view even when geometry is offset');
});

test('dolly expands the far plane with camera distance and keeps framed scene geometry visible',()=>{
 const c=cameraAt(),target=new THREE.Vector3(),controls={target,update(){c.lookAt(target);c.updateMatrixWorld(true);}};
 const object=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());
 assert.ok(frameObjects([object],c,controls));
 const previousMargin=c.far-c.position.distanceTo(target);
 zoomCamera(c,target,20);
 assert.ok(c.far>=c.position.distanceTo(target)+previousMargin,'zooming out must preserve the prior far-plane margin');
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
  const p=new THREE.Vector3(x,y,z).project(c);assert.ok(p.z<1 && p.z>-1,'scene geometry stays inside camera depth clipping after dolly out');
 }
});

class Element extends EventTarget {
 constructor(){super();this.clientHeight=600;this.clientWidth=800;this.captures=new Set();this.style={};}
 getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
 contains(e){return e===this;}closest(){return null;}
 setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
}
function emit(node,type,props={}){const e=new Event(type,{cancelable:true});Object.assign(e,props);node.dispatchEvent(e);return e;}
function fixture(options={}){
 const c=cameraAt(),canvas=new Element(),doc=new Element(),win=new Element();
 const controls=new THREE.EventDispatcher();controls.enabled=true;controls.target=new THREE.Vector3();controls.update=()=>{c.lookAt(controls.target);c.updateMatrixWorld(true);};
 let blocked=false,frames=0;
 const nav=installSceneNavigation({camera:c,canvas,viewport:canvas,document:doc,window:win,controls,roots:()=>[],blocked:()=>blocked,frameAll:()=>frames++,...options});
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
  emit(f.doc,'keydown',{key:'Escape'});assert.deepEqual(f.nav.state().position,before.position);assert.deepEqual(f.nav.state().target,before.target);assert.deepEqual(f.nav.state().up,before.up);assert.equal(f.canvas.captures.size,0);
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

// Pixel-mode integer deltas and modifiers observed in Noah's Chrome153 trace,
// September22, input-observation-final.json at652360.4/6760258.4/6762424.3ms.
// Raw trace remains in the owning navigation report's evidence directory.
const trackpadPackets=[
 {deltaX:-49,deltaY:53,deltaMode:0},
 {deltaX:0,deltaY:-1,deltaMode:0,shiftKey:true},
 {deltaX:0,deltaY:-1,deltaMode:0,metaKey:true},
];
test('click-free trackpad orbit retains the inspected point and distance, including horizontal motion',()=>{
 for(const packet of [trackpadPackets[0],{deltaX:-49,deltaY:0,deltaMode:0}]){
  const f=fixture({inputMode:()=> 'trackpad'}),pivot=new THREE.Vector3(1,.5,0);
  const screen=pivot.clone().project(f.c),q=f.c.quaternion.clone(),radius=f.c.position.distanceTo(pivot);
  const e=emit(f.canvas,'wheel',{...packet,clientX:(screen.x+1)*400,clientY:(1-screen.y)*300});
  assert.ok(f.c.quaternion.angleTo(q)>.01,'plain glide must orbit, including horizontal-only glide');
  near(pivot.clone().project(f.c),screen,'the inspected point must stay under the pointer');
  assert.ok(Math.abs(f.c.position.distanceTo(pivot)-radius)<1e-8,'orbit must not become wheel zoom');
  assert.equal(e.defaultPrevented,true);assert.equal(f.nav.state().gesture,null);assert.equal(f.canvas.captures.size,0);
 }
});
test('Shift glide pans with content motion, while Cmd/Ctrl glide zooms along the view axis',()=>{
 const f=fixture({inputMode:()=> 'trackpad'}),q=f.c.quaternion.clone(),point=new THREE.Vector3();
 emit(f.canvas,'wheel',{...trackpadPackets[1],clientX:400,clientY:300});
 assert.ok(f.c.quaternion.angleTo(q)<1e-8);near(f.c.position.clone().sub(f.controls.target),new THREE.Vector3(0,0,10));
 assert.ok(Math.abs(point.project(f.c).y+2/600)<1e-8,'negative scroll moves scene down, like natural scrolling');
 for(const modifiers of [{metaKey:true},{metaKey:false,ctrlKey:true}]){
  const f=fixture({inputMode:()=> 'trackpad'});
  emit(f.canvas,'wheel',{...trackpadPackets[2],...modifiers,clientX:450,clientY:280});
  near(f.controls.target,new THREE.Vector3());assert.equal(f.c.position.x,0);assert.equal(f.c.position.y,0);assert.ok(f.c.position.z<10);
 }
});
test('input preference switches immediately; mouse wheel zoom and modal ownership remain intact',()=>{
 let inputMode='trackpad';const f=fixture({inputMode:()=>inputMode});
 assert.equal(f.nav.state().inputMode,'trackpad');inputMode='mouse';
 emit(f.canvas,'wheel',{deltaX:0,deltaY:120,deltaMode:0,clientX:400,clientY:300});
 assert.equal(f.nav.state().inputMode,'mouse');assert.ok(f.c.position.z>10);assert.equal(f.c.position.x,0);
 for(const gate of ['blocked','disabled','pointer-gesture']){
  const f=fixture({inputMode:()=> 'trackpad'});f.blocked=gate==='blocked';f.controls.enabled=gate!=='disabled';
  if(gate==='pointer-gesture')emit(f.canvas,'pointerdown',{button:2,pointerId:1,clientX:400,clientY:300});
  const before=f.nav.state();
  for(const packet of trackpadPackets)emit(f.canvas,'wheel',{...packet,clientX:400,clientY:300});
  assert.deepEqual(f.nav.state(),before,'another gesture keeps camera ownership');
 }
});

test('right-drag orbit, Shift pan and Cmd zoom match the existing middle-button gestures',()=>{
 for(const modifiers of [{},{shiftKey:true},{metaKey:true}]){
  const states=[];
  for(const button of [1,2]){
   const f=fixture();const before=f.nav.state();
   emit(f.canvas,'pointerdown',{button,pointerId:1,clientX:450,clientY:300,...modifiers});
   assert.equal(f.nav.state().gesture,modifiers.shiftKey?'pan':modifiers.metaKey?'dolly':'orbit');
   emit(f.canvas,'pointermove',{pointerId:1,clientX:480,clientY:330,...modifiers});
   emit(f.canvas,'pointerup',{button,pointerId:1,...modifiers});
   assert.equal(f.nav.state().gesture,null);assert.notDeepEqual(f.nav.state().position,before.position);
   states.push(f.nav.state());
  }
  assert.deepEqual(states[1],states[0],'button choice must not change camera math');
 }
 const f=fixture();assert.equal(emit(f.canvas,'contextmenu').defaultPrevented,true,'viewport navigation must not open a browser menu');
 for(const gate of ['blocked','disabled']){
  const f=fixture();f.blocked=gate==='blocked';f.controls.enabled=gate!=='disabled';const before=f.nav.state();
  emit(f.canvas,'pointerdown',{button:2,pointerId:1,clientX:450,clientY:300});
  emit(f.canvas,'pointermove',{pointerId:1,clientX:480,clientY:330});
  assert.deepEqual(f.nav.state(),before,'edit ownership prevents right-drag camera mutation');
 }
});

test('top and bottom orbit continue across each pole through the effective controls update', async t=>{
 if(!process.env.KAMINOS_ORBIT_CONTROLS_SOURCE){t.skip('set KAMINOS_ORBIT_CONTROLS_SOURCE to the observed three0.171.0 OrbitControls.js');return;}
 const coreUrl=new URL('../lib/three.core.js',import.meta.url).href;
 const source=readFileSync(process.env.KAMINOS_ORBIT_CONTROLS_SOURCE,'utf8').replace("from 'three'",`from '${coreUrl}'`);
 const {OrbitControls}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 for(const sign of [-1,1]){
  const c=cameraAt(),controls=new OrbitControls(c,null);controls.enableDamping=false;
  const pivot=new THREE.Vector3(1,.5,0),projected=pivot.clone().project(c);
  orbitCamera(c,controls.target,pivot,0,sign*Math.PI/2);controls.update();const pole=c.position.clone();
  orbitCamera(c,controls.target,pivot,0,sign*Math.PI/12);controls.update();
  assert.ok(c.position.distanceTo(pole)>1,'vertical navigation must continue past the pole');
  assert.ok(pivot.clone().project(c).distanceTo(projected)<1e-4,'effective controls must preserve the off-center pivot');
 }
 for(const bottom of [false,true]){
  const f=fixture(),controls=new OrbitControls(f.c,null);controls.enableDamping=false;
  f.controls.update=()=>{controls.target.copy(f.controls.target);controls.update();};
  emit(f.doc,'keydown',{key:'7',code:'Numpad7',ctrlKey:bottom});const before=f.c.position.clone();
  emit(f.doc,'keydown',{key:bottom?'2':'8',code:bottom?'Numpad2':'Numpad8'});assert.ok(f.c.position.distanceTo(before)>1,'cardinal pole view must allow further vertical orbit');
 }
 const f=fixture(),controls=new OrbitControls(f.c,null);controls.enableDamping=false;
 f.controls.update=()=>{controls.target.copy(f.controls.target);controls.update();};
 const before=f.nav.state();emit(f.canvas,'pointerdown',{button:1,pointerId:3,clientX:450,clientY:300});
 const pivot=new THREE.Vector3(...f.nav.state().depth.point),projected=pivot.clone().project(f.c);
 emit(f.canvas,'pointermove',{pointerId:3,clientX:450,clientY:300-Math.PI/.01});const pole=f.c.position.clone();
 emit(f.canvas,'pointermove',{pointerId:3,clientX:450,clientY:300-Math.PI/.01-60});
 assert.ok(f.c.position.distanceTo(pole)>1,'MMB must continue across the pole');
 assert.ok(pivot.clone().project(f.c).distanceTo(projected)<1e-4,'MMB keeps its off-center pivot on screen');
 emit(f.doc,'keydown',{key:'Escape'});near(f.c.position,new THREE.Vector3(...before.position));near(f.c.up,new THREE.Vector3(...before.up));
});

test('actual scene camera fields retain expanded clipping and orientation through a fresh camera',()=>{
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const build=source.indexOf('function buildSceneData('),start=source.indexOf('    camera:',build),end=source.indexOf('    environment:',start);
 const cameraFields=source.slice(start,end);
 const restore=source.slice(source.indexOf('  // Apply camera\n'),source.indexOf('  // Apply material state\n'));
 const c=cameraAt(),target=new THREE.Vector3(),controls={target,update(){c.lookAt(target);c.updateMatrixWorld(true);}};
 const objects=[-50,50].map(x=>{const m=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial());m.position.x=x;return m;});
 frameObjects(objects,c,controls);
 const saved=Function('camera','controls',`return ({${cameraFields}}).camera;`)(c,controls);
 const fresh=cameraAt(3),freshControls={target:new THREE.Vector3(),update(){fresh.lookAt(this.target);fresh.updateMatrixWorld(true);}};
 Function('camera','controls','data',restore)(fresh,freshControls,{camera:saved});
 for(const o of objects)for(const x of [-5,5])for(const y of [-5,5])for(const z of [-5,5]){
  const p=new THREE.Vector3(x,y,z).add(o.position).project(fresh);assert.ok(p.z<1 && p.z>-1,'fresh reopen must retain framed geometry inside depth clipping');assert.ok(Math.abs(p.x)<1 && Math.abs(p.y)<1,'fresh reopen retains the framed bounds');
 }
 c.up.set(0,-1,0);controls.update();const inverted=Function('camera','controls',`return ({${cameraFields}}).camera;`)(c,controls);
 Function('camera','controls','data',restore)(fresh,freshControls,{camera:inverted});near(fresh.up,c.up,'saved view orientation');
 Function('camera','controls','data',restore)(fresh,freshControls,{camera:{position:[0,0,10],target:[0,0,0],fov:40}});near(fresh.up,new THREE.Vector3(0,1,0),'legacy scenes default upright');
});
