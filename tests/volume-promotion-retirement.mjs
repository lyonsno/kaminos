// kaminos-test: node
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateBasinPromotionPackage,mountBasinPromotionPackage,writeBasinPromotionPackage} from '../volume-basin-promotion-package.mjs';
import {mountPromotedFireActor} from '../volume-fire-actor-mount.mjs';
const root=new URL('../artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/',import.meta.url);
const channelPath=new URL('current.json',root),channel=JSON.parse(readFileSync(channelPath));
const packagePath=new URL(channel.current.packageRelativePath,root),raw=readFileSync(packagePath),document=JSON.parse(raw);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedRevision='basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95';
test('a real historical package remains valid under its original revision and bytes',()=>{
 assert.equal(document.revision,expectedRevision);assert.equal(hash(raw),channel.current.packageSha256);
 assert.equal(validateBasinPromotionPackage(document),document);
 const altered=structuredClone(document);altered.routes.visual['splat-only']='/unrelated';assert.throws(()=>validateBasinPromotionPackage(altered));
});
test('mounting an old package preserves its data while emitting current cockpit URLs',()=>{
 const out=mkdtempSync(join(tmpdir(),'kaminos-retired-promotion-'));
 try{
  const receipt=mountBasinPromotionPackage({channelPath:channelPath.pathname,handle:document.handle,revision:document.revision,settingsStorePath:join(out,'settings'),origin:'http://localhost:8123',outPath:join(out,'mount.json')});
  assert.equal(receipt.mount.sourcePackage.sha256,hash(raw));assert.equal(receipt.mount.revision,expectedRevision);
  assert.deepEqual(JSON.parse(readFileSync(receipt.settingsPresetPath)),document.settingsPreset.artifact);
  assert.equal(new URL(receipt.mount.loader.targetUrl).pathname,'/volume-settings-preset.html');
  assert.equal(new URL(receipt.mount.loader.targetUrl).searchParams.get('preset'),document.settingsPreset.presetId);
  assert.deepEqual(Object.keys(receipt.mount.loader.visualUrls),['raymarch-only']);
  assert.deepEqual(receipt.mount.loader.retiredVisualViews,['splat-only','smoke-hybrid','full-hybrid-diagnostic']);
  assert.equal(hash(readFileSync(packagePath)),hash(raw));
 }finally{rmSync(out,{recursive:true,force:true});}
});
test('new packages bind a current route identity and preserve the authored basin snapshot',()=>{
 const out=mkdtempSync(join(tmpdir(),'kaminos-current-promotion-'));
 try{
  const result=writeBasinPromotionPackage({handle:document.handle,sourceCommit:document.sourceCommit,settingsPresetDocument:document.settingsPreset.artifact,settingsSchema:document.settingsPreset.schema,effectiveState:document.effectiveState,packagePath:join(out,'package.json')});
  const current=JSON.parse(readFileSync(result.packagePath));assert.equal(validateBasinPromotionPackage(current),current);
  assert.equal(current.routes.identity,'kaminos.volume.basin-route-templates.v2');assert.deepEqual(Object.keys(current.routes.visual),['raymarch-only']);
  assert.equal(new URL(current.routes.visual['raymarch-only'],'http://localhost').pathname,'/volume-settings-preset.html');
  assert.deepEqual(current.settingsPreset.artifact,document.settingsPreset.artifact);assert.equal(current.effectiveState.composition.effective,document.effectiveState.composition.effective);
  const unknown=structuredClone(current);unknown.routes.identity='unknown';assert.throws(()=>validateBasinPromotionPackage(unknown));
 }finally{rmSync(out,{recursive:true,force:true});}
});
test('fire actor activation exposes retired splat intent and requests the retained renderer',()=>{
 const out=mkdtempSync(join(tmpdir(),'kaminos-current-actor-'));
 try{
  const {mount}=mountPromotedFireActor({channelPath:channelPath.pathname,handle:document.handle,revision:document.revision,settingsStorePath:join(out,'settings'),origin:'http://localhost:8123',outPath:join(out,'actor.json'),actorId:'retained-fire',consumer:{id:'test',surface:'workbench',anchor:'source'},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},policy:{simulation:{gridResolution:8},smoke:{renderScale:.5,raySteps:8,adaptiveRays:0,enabled:true},splats:{enabled:true},scheduling:{flameContinuity:'live-every-frame'}}});
  assert.equal(mount.representation.composition,'raymarch-only-v0');assert.equal(mount.representation.rendererIdentity,'native-3d-compute-fluid-raymarch-v0');
  assert.equal(mount.representation.authoring.composition,document.effectiveState.composition.effective);
  assert.equal(mount.policy.requested.splats.enabled,true);assert.equal(mount.policy.effective.splats.enabled,false);
  assert.equal(mount.runtimeApplication.presentation.boundarySplats,'off');assert.equal(mount.policy.retiredOptions[0].key,'splats.enabled');
 }finally{rmSync(out,{recursive:true,force:true});}
});

test('cockpit promotion records the live renderer controls used by actor policy',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=index.indexOf('function buildVolumeBasinPromotionEffectiveState()');
 const end=index.indexOf('async function exportBasinPromotionPackage()',start);
 const debug={active:true,error:null,routeIdentity:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:test',simGrid:8,frameCount:9,simStepCount:11,controls:{renderScale:.5,raySteps:8,adaptiveRays:0}};
 const context={URL,window:{location:{href:'http://localhost/',origin:'http://localhost'}},volumePrototype:{debugState:()=>debug},currentVolumeSettingsPresetRendererState:()=>debug,activeVolumeSettingsPresetReceipt:null,buildVolumeSettingsPreset:()=>({route:'/?kaminos_volume_smoke=1',schemaIdentity:'test',controlCount:1,rendererControlCount:0})};
 const state=runInNewContext(index.slice(start,end)+'\nbuildVolumeBasinPromotionEffectiveState()',context);
 assert.equal(state.renderer.renderScale,.5);assert.equal(state.renderer.raySteps,8);assert.equal(state.renderer.adaptiveRays,0);assert.equal(state.renderer.active,true);assert.equal(state.simulator.grid,8);
});
