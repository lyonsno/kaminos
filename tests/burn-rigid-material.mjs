// kaminos-test: node
import assert from 'node:assert/strict';
import {Box3,Vector3} from '../lib/three.core.js';
import {createBurnFractureGpu} from '../burn-fracture-gpu.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

await withKaminosGpu(async({device})=>{
 const owned=[],buffer=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 const material=new Float32Array(24);for(let i=0;i<3;i++)material[i*8+5]=1;
 const resident=buffer(material),sectionsBuffer=buffer(Float32Array.of(1,0,0,1,1,0,0,1)),damageBuffer=buffer(new Float32Array(8));
 const cells=Array.from({length:3},(_,index)=>({index,position:[0,index+.5,0],halfExtents:[.5,.5,.5],volume:1}));
 const bonds=Array.from({length:2},(_,i)=>({id:'bond-'+i,a:i,b:i+1,area:1,normal:[0,1,0],anchorA:[0,.5,0],anchorB:[0,-.5,0],linearStiffness:1e6,rotationalStiffness:1e6}));
 const prepared={cells,bonds,floorY:0,config:{timeStep:1/60,substeps:1,solverIterations:8,strength:1e6}};
 const sections={count:2,buffer:sectionsBuffer,damageBuffer,device,mapping:{connections:bonds.map(({id,a,b})=>({id,a,b}))}};
 const field={device,residentState:()=>({bounds:new Box3(new Vector3(-.5,0,-.5),new Vector3(.5,3,.5)),dimensions:[1,3,1],after:resident})};
 const mapping={counts:Uint32Array.of(1,1,1),spans:Uint32Array.of(0,1,1,1,2,1),cells:Uint32Array.of(0,1,2)};
 const renderer={backend:{device,isWebGPUBackend:true,get:()=>({})}};
 const floor={position:[0,-.1,0],halfExtents:[4,.1,4],quaternion:[0,0,0,1],friction:.5};let dynamics;
 try{
  dynamics=await createBurnFractureGpu({renderer,prepared,sections,field,regionMapping:mapping,regionMasses:[1,1,1],finiteSupports:[floor]});
  assert.equal(dynamics.read().motionModel,'burn-connected-rigid-compounds-v1','The ordinary live material path must select rigid motion, not silently run elastic mechanics');
  dynamics.advance(3);const cold=await dynamics.snapshot();
  assert.equal(cold.state.steps,180,'Exact advance retains the entire supplied time');assert.deepEqual(cold.alive,[true,true]);
  for(let i=0;i<3;i++){assert.ok(Math.abs(cold.positions[i*4+1]-(i-1))<.003,'Cold stack rests without hidden pre-settling or elastic compression');assert.ok(Math.abs(cold.velocities[i*4+1])<.02);}
  material[13]=0;device.queue.writeBuffer(resident,0,material);
  dynamics.advance(.2);const burned=await dynamics.snapshot();
  assert.deepEqual(burned.alive,[false,false],'Consumed connecting material releases both attachments');
  assert.equal(burned.positions[7],0,'Consumed region has no remaining mechanical mass');
  assert.ok(Math.abs(burned.positions[1]+1)<.003,'Unconsumed base remains supported');
  assert.ok(burned.positions[9]<.9&&burned.velocities[9]<-1,'Disconnected surviving top actually falls');
  assert.equal(burned.matrices[16],0,'Consumed region disappears through the existing resident presentation ABI');
  material[13]=1;device.queue.writeBuffer(resident,0,material);dynamics.reset();const reset=await dynamics.snapshot();
  assert.equal(reset.state.steps,0);assert.deepEqual(reset.alive,[true,true]);
  for(let i=0;i<3;i++)assert.equal(reset.positions[i*4+1],i-1);
  dynamics.setContactsEnabled(false);dynamics.advance(.2);const free=await dynamics.snapshot();assert.ok(free.velocities[1]<-1,'Contact toggle releases the whole connected assembly');
  assert.deepEqual(free.alive,[true,true],'No mechanical stress estimate may break a cold connection');
  assert.equal(dynamics.read().runtimeReadbacks,0);
 }finally{dynamics?.dispose();owned.forEach(b=>b.destroy());}
});
