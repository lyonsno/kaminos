import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
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
