// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    if (uniforms[368] > 1.5) {',source.indexOf('if(distributedGroup)'));
const end=source.indexOf('    if (uniforms[368] <= 1.5',start);
assert.ok(start>0&&end>start);
for(const mode of ['unlit','point','distributed']) {
 let legacyCalls=0,sourceCalls=0;
 const uniforms=new Float32Array(400);uniforms[368]=2;
 const state={physicalColor:{}};
 const context={uniforms,state,encoder:{},currentFluid:1,options:{},
  distributedGroup:mode==='distributed'?{}:null,
  distributedFrame:{generation:7,frame:12,volumeReceivers:8192,directions:96},
  scenePointBindGroup:mode==='point'?{}:null,scenePointFrame:{generation:7,frame:12},
  sceneSourcePreparedEncoders:new Set(),encodeSharedSceneSource(){sourceCalls++;},
  emissiveLightField:{encode(){legacyCalls++;}}};
 vm.runInNewContext(source.slice(start,end),context);
 assert.equal(legacyCalls,0,'no route may resurrect the retired incident solver');
 assert.equal(sourceCalls,1,'shared scene source preparation remains independent');
 const actual=state.physicalColor.incidentLight;
 assert.equal(actual.model,mode==='distributed'?'distributed-volume-direct-radiance-v0':mode==='point'?'scene-point':'unlit');
 assert.equal(actual.legacyDispatched,false);
 if(mode==='unlit')assert.equal(actual.reason,'distributed-lighting-not-connected');
 else assert.equal(actual.generation,7);
}
console.log('unattached, point and distributed illumination receipts pass without legacy dispatch');
