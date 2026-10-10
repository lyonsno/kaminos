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
  assert.throws(()=>validateEpisode(good,'Celebration',768),'Selected resolution cannot silently fall back');
  for(const mutate of [
    x=>{x.status='running';},x=>{x.source='Old photograph';},x=>{x.identity.sharedDevice=false;},
    x=>{x.identity.backend.kind='wasm';},x=>{x.runs[0].moge.weights='stub';},
    x=>{x.runs[0].output.triangles=0;},x=>{x.runs[0].output.materialSize=[0,0];},
    x=>{x.runs[0].source='Old photograph';},x=>{delete x.identity.supermat;},
  ]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateEpisode(bad,'Celebration'));}
});

test('comparison witness rejects changed camera, lighting and unfair baseline',async()=>{
  const checks=await import('./witness-checks.js');
  assert.equal(typeof checks.validateComparison,'function','four-view fair comparison admission is missing');
  const common={map:'surface',camera:{position:[.2,0,1],orbit:[.2,0],quaternion:[0,0,0,1],zoom:.79},
    light:{x:.1,y:.2,position:[1,2,3],intensity:3,color:1},
    physicalbaseline:{exposure:1,relit:{uuid:'relit',roughness:.4,metalness:0,mapUUID:'photograph',roughnessMapUUID:null,metalnessMapUUID:null,emissiveMapUUID:null,emissiveIntensity:0},
      materials:{uuid:'materials',roughness:1,metalness:1,mapUUID:'albedo',roughnessMapUUID:'orm',metalnessMapUUID:'orm',emissiveMapUUID:'emission',emissiveIntensity:0},
      geometryId:'same',environmentIntensity:.6},normalsMatchSurface:true,
    gi:{enabled:true,settings:{steps:16},debugState:{estimator:{expFactor:2}}},glow:false,
    environment:{environment:'studio',source:'local/studio.hdr',rotation:0,intensity:1,direct:1}};
  const views=Object.fromEntries(['original','photo','relit','materials'].map(mode=>[mode,{...structuredClone(common),mode}]));
  for(const mode of ['relit','materials'])views[mode].physicalbaseline.activeMaterial=structuredClone(views[mode].physicalbaseline[mode]);
  assert.doesNotThrow(()=>checks.validateComparison(views));
  const differentHDR=structuredClone(views);differentHDR.materials.environment.rotation=90;
  assert.throws(()=>checks.validateComparison(differentHDR),'Different HDR lighting is not a fair comparison');
  for(const mutate of [v=>{delete v.photo;},v=>{v.original.camera.position=[0,0,1];},
    v=>{v.materials.light.intensity=5;},v=>{v.relit.physicalbaseline.relit.roughness=1;},
    v=>{v.materials.physicalbaseline.geometryId='other';},v=>{v.materials.gi.settings.steps=8;},
    v=>{v.materials.glow=true;},v=>{v.relit.physicalbaseline.exposure=2;},
    v=>{delete v.relit.physicalbaseline.activeMaterial;},
    v=>{delete v.materials.physicalbaseline.materials;},
    v=>{v.materials.physicalbaseline.activeMaterial=structuredClone(v.materials.physicalbaseline.relit);},
    v=>{v.relit.physicalbaseline.activeMaterial.roughness=1;},
    v=>{v.relit.physicalbaseline.activeMaterial.mapUUID='albedo';},
    v=>{v.relit.physicalbaseline.activeMaterial.roughnessMapUUID='orm';},
    v=>{v.materials.physicalbaseline.activeMaterial.roughnessMapUUID=null;},
    v=>{v.materials.physicalbaseline.activeMaterial.emissiveIntensity=1;},
    v=>{v.relit.physicalbaseline.relit.mapUUID='albedo';v.relit.physicalbaseline.activeMaterial.mapUUID='albedo';},
    v=>{v.materials.physicalbaseline.materials.roughnessMapUUID=null;v.materials.physicalbaseline.activeMaterial.roughnessMapUUID=null;},
    v=>{v.relit.physicalbaseline.relit.emissiveMapUUID='emission';v.relit.physicalbaseline.activeMaterial.emissiveMapUUID='emission';},
  ]) {
    const bad=structuredClone(views);mutate(bad);assert.throws(()=>checks.validateComparison(bad));
  }
});
