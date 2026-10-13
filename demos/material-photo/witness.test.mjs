import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { pixelSummary } from './photo-contracts.js';

test('cache witness rejects a rerun, stale resolution, mislabeled source and incomplete restore',async()=>{
  const {validateCachedRestoration}=await import('./witness-checks.js');
  assert.equal(typeof validateCachedRestoration,'function','cached display requires distinct restoration admission');
  const state={status:'cached',source:'orb',runs:[{}],identity:{sharedDevice:true,backend:{kind:'webgpu-local'}},
    cache:{geometry:true,materials:true,size:512,source:'browser-result-storage'},result:{surfaceVertices:4,triangles:2,materialSize:[512,512]}};
  assert.doesNotThrow(()=>validateCachedRestoration(state,'orb',512,1));
  for(const change of [x=>x.runs.push({}),x=>{x.cache.size=1024;},x=>{x.result.materialSize=[1024,1024];},x=>{x.source='bag';},
    x=>{x.status='done';},x=>{x.cache.materials=false;},x=>{x.identity.sharedDevice=false;},x=>{x.gpuErrors=['validation'];}]){
    const bad=structuredClone(state);change(bad);assert.throws(()=>validateCachedRestoration(bad,'orb',512,1));
  }
});
test('reload byte admission rejects changed or missing channels with otherwise valid metadata',async()=>{
  const {validateRestoredHashes}=await import('./witness-checks.js');
  assert.equal(typeof validateRestoredHashes,'function','reload needs actual raw-byte continuity');
  const names=['image','albedo','roughness','metallic','orm','plane-albedo','plane-orm'];
  const expected=Object.fromEntries(names.map(name=>[name,{sha256:`${name}-digest`}]));
  const actual=Object.fromEntries(names.map(name=>[name,`${name}-digest`]));
  assert.doesNotThrow(()=>validateRestoredHashes(actual,expected));
  for(const name of names){assert.throws(()=>validateRestoredHashes({...actual,[name]:'changed'},expected));
    const missing={...actual};delete missing[name];assert.throws(()=>validateRestoredHashes(missing,expected));}
});

test('effects witness rejects stale controls, wrong views and mutated retained materials',async()=>{
  const {validateEffectsPresentation}=await import('./witness-checks.js');
  assert.equal(typeof validateEffectsPresentation,'function','effects need effective controls and retained-output admission');
  const effects={glowIntensity:4,glowThreshold:.1,bloom:true,bloomIntensity:1,bloomRadius:.5,bloomThreshold:.2,emissionReflection:0,exposure:1};
  const p={mode:'materials',map:'surface',glow:true,effects,emissiveIntensity:4,
    physicalbaseline:{activeMaterial:{mapUUID:'albedo',roughnessMapUUID:'orm',metalnessMapUUID:'orm'}}};
  const raw=p.physicalbaseline.activeMaterial;
  assert.doesNotThrow(()=>validateEffectsPresentation(p,effects,raw));
  for(const mutate of [x=>{x.effects.bloomRadius=.1;},x=>{x.mode='photo';},x=>{x.map='metallic';},
    x=>{x.glow=false;},x=>{x.emissiveIntensity=1;},x=>{x.physicalbaseline.activeMaterial.metalnessMapUUID='changed';},
    x=>{delete x.effects;},x=>{x.physicalbaseline.activeMaterial.mapUUID='photograph';}]){
    const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateEffectsPresentation(bad,effects,raw));
  }
});

test('contrast witness rejects stale arms, unchanged applied maps and unequal lighting',async()=>{
  const checks=await import('./witness-checks.js');
  assert.equal(typeof checks.validateContrastArms,'function','contrast arms need effective-setting admission');
  const make=mode=>({presentation:{mode:'materials',map:'surface',light:{intensity:1},camera:{orbit:[0,0]},environment:{textureUUID:'hdr',intensity:1},
    gi:{enabled:true,view:'scene',settings:{gain:1},debugState:{identity:'three-ssilvb-scene-gi-v1',estimator:{expFactor:2},frames:10}},physicalbaseline:{exposure:1,activeMaterial:{roughnessMapUUID:mode==='original'?'raw':mode,mapUUID:'same-albedo'}},
    contrast:{settings:{mode,roughness:.5,metallic:.5},gains:{roughness:mode==='original'?0:.5,metallic:0}}}});
  const good=Object.fromEntries(['original','manual','highlight'].map(mode=>[mode,make(mode)]));
  assert.doesNotThrow(()=>checks.validateContrastArms(good));
  const advancing=structuredClone(good);advancing.manual.presentation.gi.debugState.frames=20;advancing.highlight.presentation.gi.debugState.frames=30;
  assert.doesNotThrow(()=>checks.validateContrastArms(advancing),'render progress is not illumination drift');
  for(const mutate of [arms=>{delete arms.manual;},arms=>{arms.manual.presentation.contrast.settings.mode='original';},
    arms=>{arms.highlight.presentation.light.intensity=2;},arms=>{arms.manual.presentation.physicalbaseline.activeMaterial.roughnessMapUUID='raw';},
    arms=>{arms.highlight.presentation.gi.view='ao';},arms=>{arms.manual.presentation.map='roughness';},
    arms=>{arms.manual.presentation.gi.enabled=false;},arms=>{arms.manual.presentation.gi.settings.gain=2;},
    arms=>{arms.manual.presentation.gi.debugState.estimator.expFactor=3;},arms=>{arms.manual.presentation.gi.debugState.identity='other';}]){
    const bad=structuredClone(good);mutate(bad);assert.throws(()=>checks.validateContrastArms(bad));
  }
});

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
    x=>{x.gpuErrors=['Invalid rendered material pipeline'];},
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
  const isolated=structuredClone(views),cutout={sample:'orb',source:'hand-authored-example-cutout',width:20,height:20};
  for(const mode of ['original','photo']){isolated[mode].cutout=null;isolated[mode].physicalbaseline.geometryId='complete-photograph';}
  for(const mode of ['relit','materials'])isolated[mode].cutout=structuredClone(cutout);
  assert.doesNotThrow(()=>checks.validateComparison(isolated),'the unlit baselines must retain their background geometry');
  for(const mutate of [v=>{v.original.cutout=structuredClone(cutout);},v=>{v.materials.cutout=null;},
    v=>{v.materials.cutout.width=10;},v=>{v.original.physicalbaseline.geometryId='different-background';},
    v=>{v.materials.physicalbaseline.geometryId='different-subject';}]){
    const bad=structuredClone(isolated);mutate(bad);assert.throws(()=>checks.validateComparison(bad));
  }
});
