// kaminos-test: node
// CPU lifecycle/input tests. The device below records host state only; native
// WGSL execution and rendered appearance are checked separately.
import test from 'node:test';import assert from 'node:assert/strict';
import {SurfaceTeacher} from '../surface-teacher.mjs';
import experiment from '../experiments/grass-surface-teacher.experiment.mjs';
globalThis.GPUBufferUsage??={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128};
globalThis.GPUTextureUsage??={COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8};
function device(){
 const buffers=[];
 return {buffers,limits:{maxBufferSize:1e8,maxStorageBufferBindingSize:1e8,maxTextureDimension2D:2048},
  queue:{writeBuffer(buffer,offset,data){buffer.data=data.slice();},submit(){}},
  createBuffer(options){const b={...options,destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},
  createTexture:options=>({...options,createView:()=>({}),destroy(){}}),createShaderModule:()=>({}),createComputePipeline:()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),
 };
}
const scene={triangles:[{a:[-1,0,-1],b:[1,0,1],c:[1,0,-1],materialIndex:0}],materials:[{color:[.5,.3,.1],roughness:.8,metalness:0}],environment:.1,bounces:3};
test('a settled camera starts a new stationary sample count after responsive motion history',()=>{
 const teacher=new SurfaceTeacher(device(),scene),a={position:[0,2,2],target:[0,0,0],fov:45},b={...a,position:[.001,2,2]};
 try{for(const view of [a,a,a,b,b])teacher.render({view,width:8,height:8,filter:true});assert.equal(teacher.state().samples,1);}finally{teacher.dispose();}
});
test('spot directions reject zero, normalize non-unit inputs and release a failed constructor',()=>{
 const light={type:'spot',position:[0,2,0],direction:[0,-10,0],angle:.3,penumbra:.2,color:[3,3,3]},gpu=device();
 const teacher=new SurfaceTeacher(gpu,{...scene,lights:[light]});
 try{assert.equal(teacher.sceneBuffers[3].data[9],-1);}finally{teacher.dispose();}
 const bad=device();assert.throws(()=>new SurfaceTeacher(bad,{...scene,lights:[{...light,direction:[0,0,0]}]}),/light|direction/i);assert.ok(bad.buffers.every(b=>b.destroyed));
});
test('invalid initial source/settings reject before opening a scene session',async()=>{
 for(const inputs of [null,{scale:-1},{bounces:0},{environment:-1},{reconstruction:'yes'},{source:{height:0}}]){
  let opened=0;const host={scene:{async open(){opened++;throw Error('scene must not open for invalid inputs');}}};
  await assert.rejects(()=>experiment.create({host,inputs,record(){}}));assert.equal(opened,0);
 }
});
test('transport preserves supported input capacity without invented bounce/radiance caps',()=>{
 const teacher=new SurfaceTeacher(device(),scene);try{teacher.setTransport({bounces:9,environment:5});assert.equal(teacher.state().bounces,9);assert.equal(teacher.state().environment,5);}finally{teacher.dispose();}
});
test('an initial image extent beyond device capacity disposes its opened session before attachment',async()=>{
 let closed=0,attached=0;
 const host={scene:{async open(){return {async dispose(){closed++;},attach(){attached++;}};},rendering(){return {renderer:{getDrawingBufferSize:v=>v.set(100,100),backend:{device:device()}}};}}};
 await assert.rejects(()=>experiment.create({host,inputs:{scale:100},record(){}}),/device capacity/);
 assert.equal(closed,1);assert.equal(attached,0);
});

test('teacher respects accepted native light visibility and stays out of world AO depth',async()=>{
 const THREE=await import('../lib/three.webgpu.js'),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.01,100),gpu=device();
 gpu.addEventListener=()=>{};gpu.removeEventListener=()=>{};
 const light=new THREE.SpotLight(0xffffff,3);light.position.set(0,2,0);light.target.position.set(0,0,0);light.userData.kaminosSceneLightId='hidden-native-spot';world.add(light,light.target);
 let hidden=true,view={position:[2.5,1.7,3.2],target:[0,.35,0],fov:42};
 const session={async attach(object){world.add(object);return {id:'grass'};},setView(v){view=v;},readView:()=>view,onFrame:()=>()=>{},redraw(){},async dispose(){}};
 const renderer={getDrawingBufferSize:v=>v.set(100,100),backend:{device:gpu}};
 const host={scene:{async open(){return session;},rendering:()=>({renderer,scene:world,camera}),isVisible:id=>id!=='hidden-native-spot'||!hidden}};
 const instance=await experiment.create({host,inputs:{},record(){}});
 try{
  assert.equal(instance.read().schema,'kaminos.grass-surface-teacher.v1','shared source viewer extraction must retain the grass read contract');
  const grassColors=()=>gpu.buffers.filter(b=>b.label==='surface teacher materials'&&!b.destroyed).at(-1).data;
  await instance.operations.configure({bounces:3});
  assert.deepEqual(Array.from(grassColors().slice(0,3)),Array.from(new Float32Array(new THREE.Color(0x62513a).toArray())));
  const lights=()=>gpu.buffers.filter(b=>b.label==='surface teacher lights'&&!b.destroyed).at(-1).data;
  assert.deepEqual(Array.from(lights().slice(4,7)),[0,0,0],'hidden native spot must not contribute although light.visible is still true between draws');
  hidden=false;await instance.operations.configure({bounces:3});assert.deepEqual(Array.from(lights().slice(4,7)),[3,3,3]);
  const {configureMaterialSideAODepth}=await import('../scene-ao-depth.mjs'),screen=world.children.find(o=>o.userData.kaminosSurfaceTeacherPresentation);let depthDraws=0;
  const aoRenderer={lighting:{enabled:true},setRenderTarget(){},setRenderObjectFunction(fn){this.callback=fn;},renderObject(){depthDraws++;},render(scene,camera){this.callback(screen,scene,camera,screen.geometry,screen.material);}};
  const utils={resetRendererAndSceneState(){return {};},restoreRendererAndSceneState(){}};
  const ao={setDepthPass(){},updateBefore(){}};configureMaterialSideAODepth(ao,{scene:world,camera,depthRT:{},depthMaterial:{}},utils);ao.updateBefore({renderer:aoRenderer});
  assert.equal(depthDraws,0,'teacher image plane must not become world geometry in the standalone GTAO depth pass');
 }finally{await instance.dispose();}
});

test('native source preview is visible and allocates no path tracer until requested',async()=>{
 const THREE=await import('../lib/three.webgpu.js'),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.01,100),gpu=device();
 gpu.addEventListener=()=>{};gpu.removeEventListener=()=>{};
 let view={position:[2,2,3],target:[0,0,0],fov:42};
 let admittedSource;
 const session={async attach(object){if(object.name==='Frozen grass ribbons')admittedSource=object.material.map(m=>({colorWrite:m.colorWrite,depthWrite:m.depthWrite}));world.add(object);return {id:object.name};},setView(v){view=v;},readView:()=>view,onFrame:()=>()=>{},redraw(){},async dispose(){}};
 const host={scene:{async open(){return session;},rendering:()=>({renderer:{getDrawingBufferSize:v=>v.set(100,100),backend:{device:gpu}},scene:world,camera}),isVisible:()=>true,refreshPresentation(){}}};
 const instance=await experiment.create({host,inputs:{tracing:false,paused:true},record(){}});
 try{
  assert.equal(instance.read().configuration.tracing,false);assert.equal(gpu.buffers.length,0);
  assert.ok(admittedSource.every(m=>m.colorWrite&&m.depthWrite),'native preview pipeline must be correct before scene admission starts compilation');
  const root=world.children.find(o=>o.name==='Frozen grass ribbons'),screen=world.children.find(o=>o.userData.kaminosSurfaceTeacherPresentation);
  assert.ok(root.material.every(m=>m.colorWrite&&m.depthWrite));assert.equal(screen.visible,false);
  await instance.operations.configure({tracing:true});assert.ok(gpu.buffers.length>0);assert.ok(root.material.every(m=>!m.colorWrite&&!m.depthWrite));
  await instance.operations.configure({tracing:false});assert.ok(root.material.every(m=>m.colorWrite&&m.depthWrite));assert.equal(screen.visible,false);
 }finally{await instance.dispose();}
});

test('coating preserves input refusal, source summaries and native mode after capture',async()=>{
 const coating=(await import('../experiments/painted-steel-teacher.experiment.mjs')).default;
 for(const inputs of [null,[]]){let opened=0;await assert.rejects(()=>coating.create({host:{scene:{async open(){opened++;throw Error('invalid inputs opened a scene');}}},inputs,record(){}}));assert.equal(opened,0);}
 const THREE=await import('../lib/three.webgpu.js'),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.01,100),gpu=device();gpu.addEventListener=()=>{};gpu.removeEventListener=()=>{};gpu.queue.onSubmittedWorkDone=async()=>{};
 let view={position:[2,2,3],target:[0,0,0],fov:42};const session={async attach(object){world.add(object);return {id:object.name};},setView(v){view=v;},readView:()=>view,onFrame:()=>()=>{},redraw(){},async dispose(){}};
 const host={scene:{async open(){return session;},rendering:()=>({renderer:{getDrawingBufferSize:v=>v.set(100,100),backend:{device:gpu}},scene:world,camera}),isVisible:()=>true,refreshPresentation(){}}};
 const instance=await coating.create({host,inputs:{},record(){}}),oldPublish=SurfaceTeacher.prototype.publish,oldRead=SurfaceTeacher.prototype.readLinear;
 SurfaceTeacher.prototype.publish=()=>{};SurfaceTeacher.prototype.readLinear=async()=>new Float32Array(8*8*4);
 try{
  const changed=await instance.operations.source({height:.06});assert.ok(changed.sourceSummary?.geometricSupportFraction>0);
  await instance.operations.capture({width:8,height:8,samples:1});assert.equal(instance.read().effective.width,8,'native mode must not dispatch an additional full-viewport trace');
 }finally{SurfaceTeacher.prototype.publish=oldPublish;SurfaceTeacher.prototype.readLinear=oldRead;await instance.dispose();}
});
