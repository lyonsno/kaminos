import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { pixelSummary } from './photo-contracts.js';

test('surface capture excludes title-only false closure and restores overlays on failure', async()=>{
  const {captureSurfaceFrame}=await import('./witness-checks.js');
  assert.equal(typeof captureSurfaceFrame,'function','Surface-only capture isolation is missing');
  const overlays=[{style:{visibility:''}},{style:{visibility:'visible'}}];
  const evaluate=async expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>overlays},requestAnimationFrame:callback=>callback()});
  // A blank canvas plus white title text would pass the old nonblank threshold.
  const blank=new Uint8Array(80*80*4), title=blank.slice(); title.fill(255,0,1100*4);
  assert.ok(pixelSummary(title,80,80).nonBackground>1000);
  const sample=await captureSurfaceFrame(evaluate,async()=>pixelSummary(overlays.every(o=>o.style.visibility==='hidden')?blank:title,80,80));
  assert.equal(sample.nonBackground,0);
  assert.deepEqual(overlays.map(o=>o.style.visibility),['','visible']);
  await assert.rejects(()=>captureSurfaceFrame(evaluate,async()=>{throw Error('CDP failed');}),/CDP failed/);
  assert.deepEqual(overlays.map(o=>o.style.visibility),['','visible']);
});
test('witness rejects false completion, stale source and wrong device', async()=>{
  const url=new URL('./witness-checks.js',import.meta.url);
  assert.ok(existsSync(url),'No completed-output admission exists for the two-model witness');
  const {validateEpisode}=await import(url);
  const good={status:'done',source:'Celebration',identity:{sharedDevice:true,backend:{kind:'webgpu-local'},
    supermat:{routeId:'supermat.image-to-pbr.webgpu-local.v0'}},runs:[{source:'Celebration',status:'done',
    moge:{weights:'local'},supermat:{dutyCount:12},output:{surfaceVertices:16,triangles:18,materialSize:[512,512]}}]};
  assert.doesNotThrow(()=>validateEpisode(good,'Celebration'));
  for(const mutate of [
    x=>{x.status='running';},x=>{x.source='Old photograph';},x=>{x.identity.sharedDevice=false;},
    x=>{x.identity.backend.kind='wasm';},x=>{x.runs[0].moge.weights='stub';},
    x=>{x.runs[0].output.triangles=0;},x=>{x.runs[0].output.materialSize=[0,0];},
    x=>{x.runs[0].source='Old photograph';},x=>{delete x.identity.supermat;},
  ]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateEpisode(bad,'Celebration'));}
});
