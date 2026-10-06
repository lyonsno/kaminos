import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    if (uniforms[368] > 1.5) {',source.indexOf('if(distributedGroup)'));
const end=source.indexOf('    if (uniforms[368] <= 1.5',start);
assert.ok(start>0&&end>start);
for(const distributed of [true,false]) {
  let legacyCalls=0,sourceCalls=0;
  const uniforms=new Float32Array(400);uniforms[368]=2;
  const state={physicalColor:{}};
  const context={uniforms,state,encoder:{},currentFluid:1,options:{},EMISSIVE_LIGHT_GRID:32,
    distributedGroup:distributed?{}:null,distributedFrame:{generation:7,frame:12,volumeReceivers:8192,directions:96},
    sceneSourcePreparedEncoders:new Set(),encodeSharedSceneSource(){sourceCalls++;},
    emissiveLightField:{encode(){legacyCalls++;}}};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(legacyCalls,distributed?0:1,'only the consumed smoke solver may dispatch');
  assert.equal(sourceCalls,1,'shared scene source preparation remains independent');
  assert.equal(state.physicalColor.incidentLight.model,distributed?'distributed-volume-direct-radiance-v0':'six-direction-single-scattering-v1');
}
console.log('exclusive smoke solver dispatch contracts passed');
