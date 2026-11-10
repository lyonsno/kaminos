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
