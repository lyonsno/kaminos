import assert from 'node:assert/strict';
import { evaluateSolidMaterial } from '../structural-material-solid-kernels.js';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,MAP_READ:8};

const fixture={kind:'pmb',positions:[[0,0,0],[1,0,0]],indices:[[0,1,1,0]],parameters:[[1,1,0,0]]};
const device={limits:{maxStorageBufferBindingSize:1e9},createBuffer(){throw new Error('GPU allocation reached');}};
for(const bad of [
  {positions:[[0,0],[1,0,0,0]]},
  {indices:[[0,1.5,1,0]]},
  {indices:[[0,1,2,0]]},
  {indices:[[0,1,1]]},
  {parameters:[[0,1,0,0]]},
  {parameters:[[1,-1,0,0]]},
])await assert.rejects(evaluateSolidMaterial(device,{...fixture,...bad}),error=>!error.message.includes('GPU allocation reached'),'Malformed material inputs must reject before GPU allocation');
await assert.rejects(evaluateSolidMaterial(device,fixture),/GPU allocation reached/);
console.log('Material GPU input contracts passed');
