import assert from 'node:assert/strict';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {buildSmokeReconstructionCells,createDistributedSmokeBindings} from '../scene-smoke-reconstruction.mjs';
import {createVolumeGather} from '../scene-volume-gather.mjs';

const dimensions=[4,8,4],pitch=.5;
const triangles=[
  {a:[-.75,-1,-1],b:[-.75,3,-1],c:[-.75,3,1]},
  {a:[-.75,-1,-1],b:[-.75,3,1],c:[-.75,-1,1]},
  {a:[-1,-.6,-1],b:[1,.4,-1],c:[1,.4,1]},
  {a:[-1,-.6,-1],b:[1,.4,1],c:[-1,-.6,1]},
];
const packed=buildTriangleVisibility(triangles).packGpu();
const bins=buildSmokeReconstructionCells(packed,dimensions);
assert.deepEqual(bins.dimensions,[5,9,5]);
const unpack=index=>{
  const at=index*12,a=Array.from(packed.triangles.slice(at,at+3));
  return {a,b:a.map((v,i)=>v+packed.triangles[at+4+i]),c:a.map((v,i)=>v+packed.triangles[at+8+i])};
};
const reference=buildTriangleVisibility(Array.from({length:packed.triangleCount},(_,i)=>unpack(i)));
let seed=1,segmentCount=0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const queries=Array.from({length:250},()=>[random()*2-1,random()*4-1,random()*2-1]);
queries.push([-1,-1,-1],[1,3,1],[-.75,.25,.25],[-.75001,.25,.25]);
const localCache=new Map();
for(const p of queries) {
  const base=p.map(v=>Math.floor((v+1)/pitch-.5));
  const bin=base.map((v,i)=>Math.max(0,Math.min(dimensions[i],v+1)));
  const id=bin[0]+5*(bin[1]+9*bin[2]),start=bins.words[2*id],count=bins.words[2*id+1];
  if(!localCache.has(id))localCache.set(id,buildTriangleVisibility(Array.from(bins.words.slice(start,start+count),unpack)));
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++) {
    const receiver=[x,y,z].map((v,i)=>-1+(Math.max(0,Math.min(dimensions[i]-1,base[i]+v))+.5)*pitch);
    const d=receiver.map((v,i)=>v-p[i]),length=Math.hypot(...d);if(length===0)continue;
    const expected=reference.trace(p,d,{maxDistance:length});
    const actual=localCache.get(id).trace(p,d,{maxDistance:length});
    assert.equal(Boolean(actual),Boolean(expected),'local triangle bins must preserve full-scene segment visibility');
    if(expected)assert.ok(Math.abs(actual.distance-expected.distance)<1e-10);
    segmentCount++;
  }
}
const many=buildTriangleVisibility(Array.from({length:5000},()=>triangles[0])).packGpu();
assert.equal(buildSmokeReconstructionCells(many,dimensions).maxCandidates,5000,'no silent per-cell candidate cap');
assert.throws(()=>buildSmokeReconstructionCells(packed,[4,0,4]),/positive smoke/);
assert.throws(()=>buildSmokeReconstructionCells({triangles:[],triangleCount:1},dimensions),/packed static/);
const broken={...packed,triangles:packed.triangles.slice()};broken.triangles[0]=NaN;
assert.throws(()=>buildSmokeReconstructionCells(broken,dimensions),/finite/);

const capacityGeometry=buildTriangleVisibility([
  {a:[-1,-1,-1],b:[1,3,-1],c:[1,3,1]},
  {a:[-1,-1,-1],b:[1,3,1],c:[-1,-1,1]},
]).packGpu();
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2};
const allocated=[];
const capacityDevice={limits:{maxStorageBufferBindingSize:128},queue:{writeBuffer(){}},
  createBuffer(){const b={destroyed:false,destroy(){this.destroyed=true;}};allocated.push(b);return b;}};
assert.throws(()=>createVolumeGather(capacityDevice,{geometry:capacityGeometry,receivers:[],volumeGrid:1,directions:2}),
  /smoke reconstruction cell triangle candidates needs 192 bytes; device supports 128/);
assert.equal(allocated.filter(b=>!b.destroyed).length,0,'candidate capacity failure must leave no undisposed GPU buffers');

globalThis.GPUShaderStage={FRAGMENT:2};
let groups=0;
const device={createBindGroupLayout:value=>value,createBindGroup:value=>{groups++;return value;}};
const bindings=createDistributedSmokeBindings(device);
const texture={createView:()=>({})},r={identity:'geometry-visible-trilinear-v1',cellIndices:{},triangles:{}};
const frame={texture,smokeReconstruction:r};
bindings.update(frame);bindings.update({...frame,generation:2});assert.equal(groups,1,'live coefficient update does not rebuild static bindings');
bindings.update({...frame,smokeReconstruction:{...r,cellIndices:{}}});assert.equal(groups,2,'same texture with new visibility must rebind');
bindings.update({...frame,smokeReconstruction:{...r,triangles:{}}});assert.equal(groups,3);
assert.throws(()=>bindings.update({texture}),/reconstruction resources/);
assert.throws(()=>bindings.update({...frame,smokeReconstruction:{...r,identity:'old'}}),/reconstruction resources/);
console.log(`smoke reconstruction bins preserve ${segmentCount} reference segments, uncapped candidates and binding lifetime`);
