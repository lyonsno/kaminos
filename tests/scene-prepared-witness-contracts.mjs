import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scratch/beaming-distributed-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('      assert.equal(state.volume.error,null);');
const end=source.indexOf('      await page.screenshot',start);
assert.ok(start>0&&end>start);
const check=state=>vm.runInNewContext(source.slice(start,end),{assert,state,density:.35,extinction:.1});
const valid={density:.35,extinction:.1,lighting:{smokeMode:'distributed',directions:96,frame:{volumeReceivers:8192,smokeReconstruction:{identity:'prepared-geometry-visible-v1',dimensions:[64,128,64],cameraTriangleTests:0,staticPreparations:1,updates:10}}},
  volume:{error:null,controls:{density:.35,physicalSmokeExtinction:.1},physicalColor:{material:{smokeExtinction:.10000000149},incidentLight:{legacyDispatched:false}}}};
check(valid);
for(const corrupt of [
  v=>{v.volume.controls.density=3.55;},
  v=>{v.volume.physicalColor.material.smokeExtinction=8;},
  v=>{v.lighting.smokeMode='legacy';},
  v=>{v.lighting.directions=24;},
  v=>{v.lighting.frame.volumeReceivers=0;},
  v=>{v.lighting.frame.smokeReconstruction.dimensions=[16,32,16];},
  v=>{v.lighting.frame.smokeReconstruction.staticPreparations=0;},
  v=>{v.lighting.frame.smokeReconstruction.updates=0;},
  v=>{v.volume.physicalColor.incidentLight.legacyDispatched=true;},
  v=>{v.volume.error='device lost';},
]){const wrong=structuredClone(valid);corrupt(wrong);assert.throws(()=>check(wrong),'shadowed controls, wrong route, stale preparation or failed output must not pass');}
console.log('prepared witness rejects shadowed effective controls and incomplete/wrong resources');
