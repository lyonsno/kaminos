// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as format from '../neumip-model.mjs';
import {createNeumipStudent,neumipTrainingLayout,restoreNeumipParameters,createNeumipTraining} from '../neumip-training.mjs';

function fixture() {
  const texture = (n,c) => ({width:n,height:n,channels:c,data:Float32Array.from({length:n*n*c},(_,i)=>(i%13-6)/16)});
  const layers=[];
  for (const [prefix,sizes] of [['main',[12,24,24,24,6]],['offset_network',[8,24,24,24,1]]]) {
    for(let i=0;i<4;i++) layers.push({name:`${prefix}.mpl${i}`,input:sizes[i],output:sizes[i+1],relu:i<3,
      weights:Float32Array.from({length:sizes[i]*sizes[i+1]},(_,k)=>(k%7-3)/32),biases:new Float32Array(sizes[i+1]).fill(.025)});
  }
  return {offset:texture(4,6),mips:[texture(4,8),texture(2,8)],layers,architecture:'training-roundtrip'};
}

test('trained float fields export and reload through the existing author-format reader',()=>{
  assert.equal(typeof format.writeNeumipModel,'function','trained-model export is missing');
  const model=fixture();
  const restored=format.readNeumipModel(format.writeNeumipModel(model));
  assert.equal(restored.architecture,model.architecture);
  assert.deepEqual(restored.offset,model.offset);
  assert.deepEqual(restored.mips,model.mips);
  assert.deepEqual(restored.layers,model.layers);
  model.layers[0].weights[0]=NaN;
  assert.throws(()=>format.writeNeumipModel(model),/non-finite/);
});

test('64-square students have repeatable random initialization and independent pyramid storage',()=>{
  const a=createNeumipStudent({resolution:64,seed:2718}),b=createNeumipStudent({resolution:64,seed:2718});
  assert.deepEqual(a,b);
  assert.notDeepEqual(a.offset.data,createNeumipStudent({resolution:64,seed:2719}).offset.data);
  assert.deepEqual(a.mips.map(t=>t.width),[64,32,16,8,4,2]);
  const layout=neumipTrainingLayout(a);assert.equal(layout.count,71359);assert.equal(layout.weightCount,3103);
  const altered=layout.values.slice();altered[0]+=.25;altered[layout.fields[2].offset]+=.125;
  restoreNeumipParameters(a,layout,altered);
  assert.equal(a.layers.find(l=>l.name==='offset_network.mpl0').weights[0],altered[0]);
  assert.equal(a.mips[1].data[0],altered[layout.fields[2].offset]);
  const restored=format.readNeumipModel(format.writeNeumipModel(a));
  assert.deepEqual(neumipTrainingLayout(restored).values,altered);
  assert.throws(()=>createNeumipStudent({resolution:63}),/power of two/);
  assert.throws(()=>restoreNeumipParameters(a,layout,new Float32Array(1)),/Invalid fitted/);
});

// This fake tests JS call ordering only. Native numerical conformance remains
// in tools/neumip-training-check.mjs, executed through actual Dawn/Metal.
async function withFakeDevice(fn) {
  const previous={GPUBufferUsage:globalThis.GPUBufferUsage,GPUShaderStage:globalThis.GPUShaderStage,GPUMapMode:globalThis.GPUMapMode};
  Object.assign(globalThis,{GPUBufferUsage:{STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16},GPUShaderStage:{COMPUTE:1},GPUMapMode:{READ:1}});
  const encoder=()=>({clearBuffer(){},copyBufferToBuffer(a,ao,b,bo,n){new Uint8Array(b.data,bo,n).set(new Uint8Array(a.data,ao,n));},finish(){return {};},
    beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}});
  const device={
    createBuffer({size}){return {size,data:new ArrayBuffer(size),destroy(){},async mapAsync(){},getMappedRange(){return this.data;}};},
    createBindGroupLayout(){return {};},createPipelineLayout(){return {};},createBindGroup(){return {};},
    createShaderModule(){return {async getCompilationInfo(){return {messages:[]};}};},async createComputePipelineAsync(){return {};},
    createCommandEncoder:encoder,
    queue:{writeBuffer(b,offset,data){const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);new Uint8Array(b.data,offset,bytes.length).set(bytes);},submit(){},async onSubmittedWorkDone(){}},
  };
  try{return await fn(device);}finally{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
}

test('inference does not expose an unwritten or stale training loss',()=>withFakeDevice(async device=>{
  const gpu=await createNeumipTraining(device,createNeumipStudent({resolution:2}),{batchSize:2});
  try{gpu.setQueries(new Float32Array(8));const result=await gpu.evaluate();assert.equal('loss' in result,false,'inference must return only freshly computed outputs');}
  finally{gpu.dispose();}
}));

test('new queries invalidate targets even when the batch shape is unchanged',()=>withFakeDevice(async device=>{
  const gpu=await createNeumipTraining(device,createNeumipStudent({resolution:2}),{batchSize:2});
  try{
    gpu.setQueries(new Float32Array(8));gpu.setTargets(new Float32Array(3));
    gpu.setQueries(new Float32Array(8).fill(.2));
    assert.throws(()=>gpu.encodeUpdate(device.createCommandEncoder()),/targets.*current quer/i);
    await assert.rejects(gpu.gradients(),/targets.*current quer/i);
  }finally{gpu.dispose();}
}));

test('GPU target copies require a matching current source batch and encoder',()=>withFakeDevice(async device=>{
  const source=await createNeumipTraining(device,createNeumipStudent({resolution:2}),{batchSize:2});
  const learner=await createNeumipTraining(device,createNeumipStudent({resolution:2}),{batchSize:2});
  try{
    source.setQueries(new Float32Array(8));source.setTargets(new Float32Array(3));learner.setQueries(new Float32Array(16));
    assert.throws(()=>learner.copyTargetsFrom(device.createCommandEncoder(),source),/target.*batch/i);
    learner.setQueries(new Float32Array(8));source.setQueries(new Float32Array(8));
    assert.throws(()=>learner.copyTargetsFrom(device.createCommandEncoder(),source),/target.*batch/i);
    const encoder=device.createCommandEncoder();source.encodeTeacher(encoder);
    assert.throws(()=>learner.copyTargetsFrom(device.createCommandEncoder(),source),/encoder/i);
    assert.doesNotThrow(()=>learner.copyTargetsFrom(encoder,source));
    assert.doesNotThrow(()=>learner.encodeUpdate(encoder));
  }finally{source.dispose();learner.dispose();}
}));
