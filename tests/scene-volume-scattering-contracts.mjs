import assert from 'node:assert/strict';
import * as source from '../scene-volume-source.mjs';
const textures=[],groups=[];
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const device={createTexture(spec){const t={spec,createView(){return {texture:t};},destroy(){t.destroyed=true;}};textures.push(t);return t;},
 createComputePipeline(){return {getBindGroupLayout(i){return i;}};},createBindGroup(spec){groups.push(spec);return spec;}};
const field=source.createSceneVolumeSource({device,module:{},uniformBuffer:{},fluidBuffers:[{}],frontBuffers:[{}],grid:4,gridY:8});
assert.equal(field.describe().scatteringTexture,null,'allocated scattering is not current data');
const encoder={beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}};
field.encode(encoder,0,7);assert.equal(field.describe().scatteringTexture,textures[1]);
assert.equal(textures[1].spec.format,'r32float');
assert.equal(groups.at(-1).entries.length,2,'seed exports emission/extinction and actual scattering together');
field.invalidate('test');assert.equal(field.describe().scatteringTexture,null);
field.destroy();assert.ok(textures[1].destroyed);
const scattering=await import('../scene-volume-scattering.mjs');
assert.equal(typeof scattering.composeScatteredSource,'function');
// Incident values already contain the master gain: never multiply them again.
assert.deepEqual(scattering.composeScatteredSource([2,3,4,5],.25,[8,4,2],2),[6,7,8.5,5]);
assert.deepEqual(scattering.composeScatteredSource([2,3,4,5],0,[8,4,2],2),[4,6,8,5]);
assert.deepEqual(scattering.composeScatteredSource([0,0,0,5],.25,[0,0,0],4),[0,0,0,5]);
assert.deepEqual(scattering.composeScatteredSource([2,3,4,5],.25,[0,0,0],0),[0,0,0,5]);
for(const sigma of [-1,NaN,Infinity])assert.throws(()=>scattering.composeScatteredSource([2,3,4,5],sigma,[8,4,2],2));
console.log('single-scatter source, master gain and source-frame lifecycle passed');
