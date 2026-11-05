// kaminos-test: node
import assert from 'node:assert/strict';
import {createBurnFractureReleaseGpu, BURN_FRACTURE_WGSL, BURN_CONTACT_RELEASE_WGSL} from '../burn-fracture-release-gpu.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';

await withKaminosGpu(async ({device}) => withGpuErrorScopes(device,'burn-contact-release',async () => {
 const owned=[];
 const buffer=(data,usage=GPUBufferUsage.STORAGE)=>{
  const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  owned.push(b);device.queue.writeBuffer(b,0,data);return b;
 };
 const read=async b=>{
  const copy=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,copy,0,b.size);device.queue.submit([e.finish()]);await copy.mapAsync(GPUMapMode.READ);return new Float32Array(copy.getMappedRange().slice(0));}
  finally{copy.unmap();copy.destroy();}
 };
 const jointData=new Float32Array(3*44),words=new Uint32Array(jointData.buffer);
 [[0,1,0,1],[2,3,0,1],[0,2,0,0]].forEach((ids,i)=>{words.set(ids,i*44);jointData[i*44+16]=100;jointData[i*44+17]=100;});
 const contactData=Float32Array.from({length:5*36},(_,i)=>i+.25);
 [[0,4,1,7],[2,4,1,7],[4,1,1,7],[0,4,0,7],[3,4,1,7]].forEach((ids,i)=>contactData.set(ids,i*36));
 const joints=buffer(jointData),contacts=buffer(contactData),sections=buffer(Float32Array.of(1,0,0,1,1,0,0,1,1,0,0,1));
 const coefficients=buffer(Float32Array.of(1,100,100,0,1,100,100,0,1,100,100,0));
 const geometryData=new Float32Array(36);for(let i=0;i<3;i++)geometryData[i*12+7]=1;
 const geometry=buffer(geometryData),parameters=buffer(Uint32Array.of(4,3,0,0,0,0,0,0),GPUBufferUsage.UNIFORM);
 let stage;
 const encode=()=>{const e=device.createCommandEncoder();stage.encode(e);device.queue.submit([e.finish()]);};
 try{
  stage=await createBurnFractureReleaseGpu({device,joints,sections,coefficients,geometry,parameters,contacts,initialJoints:jointData,bodies:4,bonds:3});
  encode();
  assert.deepEqual(await read(contacts),contactData,'An unchanged attachment system must retain contact warmstarts');
  device.queue.writeBuffer(sections,16,Float32Array.of(.5,0,0,1));encode();
  assert.deepEqual(await read(contacts),contactData,'Partial section weakening without a break must retain contact warmstarts');
  device.queue.writeBuffer(sections,0,Float32Array.of(0,0,0,1));
  encode();
  const expected=contactData.slice();
  for(const i of [0,2]){expected.fill(0,i*36+20,i*36+23);expected.fill(0,i*36+24,i*36+28);}
  assert.equal(new Uint32Array((await read(joints)).buffer)[3],0,'Production section exhaustion must actually break the joint');
  assert.deepEqual(await read(contacts),expected,'A newly broken attachment must clear only its endpoints\' cached contact reactions');
  device.queue.writeBuffer(contacts,0,contactData);encode();
  assert.deepEqual(await read(contacts),contactData,'A historical break must not clear reactions every frame');
  // A stress failure occurs outside this stage, after the previous engine step.
  device.queue.writeBuffer(joints,44*4+12,Uint32Array.of(0));encode();
  const afterStress=contactData.slice();
  for(const i of [1,4]){afterStress.fill(0,i*36+20,i*36+23);afterStress.fill(0,i*36+24,i*36+28);}
  assert.deepEqual(await read(contacts),afterStress,'Stress failure must invalidate reactions before the next solve as well');
  device.queue.writeBuffer(joints,0,jointData);device.queue.writeBuffer(contacts,0,contactData);device.queue.writeBuffer(geometry,0,geometryData);
  stage.reset();encode();
  assert.deepEqual(await read(contacts),expected,'Reset must restore attachment history before another consumption transition');
  stage.dispose();stage.dispose();
  assert.throws(()=>encode(),/disposed/);assert.throws(()=>stage.reset(),/disposed/);
 }finally{stage?.dispose();owned.forEach(b=>b.destroy());}
}), {wgslSources:[{label:'burn-section-release',code:BURN_FRACTURE_WGSL,entryPoint:'weaken'},
 ...['markChanged','resetContacts'].map(entryPoint=>({label:'burn-contact-release-'+entryPoint,code:BURN_CONTACT_RELEASE_WGSL,entryPoint}))]});
