import assert from 'node:assert/strict';
import { prepareSolidTopology,packSolidTopology } from '../structural-material-solid-topology.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
const imported=await import('../structural-material-solid-resident.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
assert.ok(imported?.createSolidResident,'The material state must persist across GPU steps');
const device={limits:{maxStorageBufferBindingSize:1e9},createBuffer(){throw new Error('GPU allocation reached');}};
for(const descriptor of [{},{kind:'fallback',points:4,elements:1,bonds:6,colorCount:4},{kind:'graph',points:4,elements:1,bonds:6,colorCount:0}])await assert.rejects(imported.createSolidResident(device,descriptor,{}),error=>!error.message.includes('GPU allocation reached'));
const model=prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6},{kind:'graph'}),descriptor={kind:'graph',bufferLayout:model.bufferLayout,points:4,elements:1,bonds:6,colorCount:4};
await assert.rejects(imported.createSolidResident(device,descriptor,packSolidTopology(model)),/GPU allocation reached/,'Valid packing must reach allocation rather than reject an earlier unrelated contract');
for(const mutate of [a=>{for(let i=0;i<4;i++)a.state[i*16+7]=0;},a=>{a.incidence[6]=1;},a=>{a.incidence[0]=1;}]){const arrays=packSolidTopology(model);mutate(arrays);await assert.rejects(imported.createSolidResident(device,descriptor,arrays),error=>!error.message.includes('GPU allocation reached'),'Racing colors or redirected/missing force incidence must reject before allocation');}
console.log('Resident material admission rejects incomplete or substituted routes');
