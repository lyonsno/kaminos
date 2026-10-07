import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFingerFluidLiveInletPacket, measureFingerFluidLiveInletSchedulerCapacity } from '../finger-fluid-webgpu-core.js';
import { normalizeLocalLiquidEmitter, localLiquidInletPacket, defaultLocalLiquidSetup } from '../local-liquid-setup.mjs';
import { createLocalLiquidEmitterSceneRecord, normalizeLocalLiquidSceneDocument } from '../local-liquid-scene-object.mjs';

const packet = profile => ({simulation_authority:'live_simulation',authority:{simulation_safe:true},emitters:[{id:'water',active:true,emission_state:'jet',aim_world:[1,0,0],inlet_profile:profile}]});
test('live inlet preserves an explicit plug profile and rejects unknown profiles',()=>{
 assert.equal(normalizeFingerFluidLiveInletPacket(packet('plug')).inlets[0].profile,'plug');
 assert.throws(()=>normalizeFingerFluidLiveInletPacket(packet('spray')),/profile/);
 assert.equal(normalizeFingerFluidLiveInletPacket(packet(undefined)).inlets[0].profile,'round_poiseuille');
});
test('new authored water sources save a plug profile; legacy saved sources retain their profile',()=>{
 const record=createLocalLiquidEmitterSceneRecord({id:'water',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}});
 assert.equal(record.localLiquidEmitter.inletProfile,'plug');
 const reopened=normalizeLocalLiquidSceneDocument({localLiquid:defaultLocalLiquidSetup(),objects:[JSON.parse(JSON.stringify(record))]});
 assert.equal(localLiquidInletPacket(reopened.setup,reopened.emitters).emitters[0].inlet_profile,'plug');
 const legacy={schema:'kaminos.local-liquid-emitter.v1',baseRadius:.08,strength:1.15,rate:1200};
 assert.deepEqual(normalizeLocalLiquidEmitter(legacy),legacy);
 assert.throws(()=>normalizeLocalLiquidEmitter({...legacy,inletProfile:'spray'}),/profile/);
});
test('plug scheduler uses equal lane weights without losing the explicit pool capacity',()=>{
 const input={radius:.08,maximumSpeed:1.15,releasePoolBudget:4096,residenceSeconds:20,residenceDistanceWorld:100};
 const plug=measureFingerFluidLiveInletSchedulerCapacity({...input,profile:'plug'});
 const lanes=plug.laneCount;
 assert.equal(plug.laneResidenceCeilingParticleReleaseRate,Math.floor(input.releasePoolBudget/lanes)*lanes/input.residenceSeconds);
 assert.ok(plug.schedulerCeilingParticleReleaseRate<=plug.aggregateResidenceCeilingParticleReleaseRate);
});

test('airborne coverage is explicit and rejects an unknown route',async()=>{
 const core=await import('../finger-fluid-webgpu-core.js');
 assert.equal(typeof core.resolveFingerFluidLiquidFireContactCoverage,'function','airborne coverage needs an explicit supported route');
 assert.equal(core.resolveFingerFluidLiquidFireContactCoverage('active-liquid-particles'),'active-liquid-particles');
 assert.throws(()=>core.resolveFingerFluidLiquidFireContactCoverage('all-stuff'),/coverage/);
});

test('airborne header preserves support count as a subset and fails inconsistent accounting',async()=>{
 const core=await import('../finger-fluid-webgpu-core.js');
 const header={schema:core.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA,packing:core.KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING,magic:0x4b4c4643,version:1,allocationGeneration:1,epoch:2,writeTick:3,valid:true,complete:true,sourceCount:4,packedCount:4,contactCount:1,rejectedCount:0,capacity:4,overflowCount:0,malformedCount:0,sourceFrameId:'fixture',flags:2};
 const identity={allocationGeneration:1,epoch:2,minimumWriteTick:3,sourceFrameId:'fixture'};
 assert.equal(core.validateLiquidFireContactDescriptorHeader(header,identity),header);
 assert.throws(()=>core.validateLiquidFireContactDescriptorHeader({...header,flags:1},identity),/accounting/);
 assert.throws(()=>core.validateLiquidFireContactDescriptorHeader({...header,packedCount:3},identity),/accounting/);
 assert.throws(()=>core.validateLiquidFireContactDescriptorHeader({...header,flags:77},identity),/coverage/);
});

test('volume capture rejects stale ticks, a missing airborne population and a wrong effective profile',async()=>{
 const evidence=await import('../local-liquid-stream-evidence.mjs').catch(()=>({}));
 assert.equal(typeof evidence.assertLiquidVolumeCapture,'function','the capture needs a falsifiable raw-record validator');
 const valid={profile:'plug',coverage:'active-liquid-particles',volumeMeaning:'world-volume-per-particle',requestedProfile:'plug',effectiveProfile:'plug',expectedProfile:'plug',sourceFrameId:'kaminos/finger-fluid-bench:gpu-simulation-frame',sourceFrameHash:0x6c2673d1,producerTick:3,allocationGeneration:1,epoch:2,header:[0x4b4c4643,1,1,2,3,1,1,0x6c2673d1,1,1,0,0,1,0,0,32,2,0,0,0],records:[0,1,0,0,0,1,0,1,0,1,0,.08,0,-1,0,-1,0,0,0,0,1,.1,0,.0001,1,2,3,0,0,1,3,2]};
 assert.equal(evidence.assertLiquidVolumeCapture(valid).airborneCount,1);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,effectiveProfile:'round_poiseuille'}),/profile/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,producerTick:4}),/tick/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,effectiveProfile:undefined}),/profile/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,sourceFrameHash:0}),/source frame/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,sourceFrameId:'foreign'}),/source frame/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,header:valid.header.map((v,i)=>i===7?999:v)}),/source frame/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,records:[]}),/partial/);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,header:valid.header.map((v,i)=>i===16?1:v)}),/coverage/);
});

test('new streams derive supply from aperture and speed without silently clipping explicit saved rates',async()=>{
 const core=await import('../finger-fluid-webgpu-core.js');
 const record=createLocalLiquidEmitterSceneRecord({id:'auto-water',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}});
 assert.equal(record.localLiquidEmitter.rate,null);
 const source=localLiquidInletPacket(defaultLocalLiquidSetup(),[record]);
 assert.equal(source.emitters[0].active,true);
 assert.equal(Object.hasOwn(source.emitters[0],'source_flux_particles_per_second'),false);
 const economics=core.planFingerFluidLiveInletEconomics(source,49152).inlets[0];
 assert.ok(Math.abs(economics.effective.particleReleaseRate-Math.PI*.08**2*1.15/(.055**3))<1e-10);
 assert.equal(economics.effective.releaseAuthority,'derived_from_aperture_and_speed');
 const manual={...record,localLiquidEmitter:{...record.localLiquidEmitter,rate:1200}};
 assert.equal(localLiquidInletPacket(defaultLocalLiquidSetup(),[manual]).emitters[0].source_flux_particles_per_second,1200);
 assert.equal(localLiquidInletPacket(defaultLocalLiquidSetup(),[{...manual,localLiquidEmitter:{...manual.localLiquidEmitter,rate:0}}]).emitters[0].active,false);
 assert.throws(()=>normalizeLocalLiquidEmitter({...manual.localLiquidEmitter,rate:undefined}),/rate/);
});

test('capture independently rejects a contradictory GPU source-frame hash',async()=>{
 const evidence=await import('../local-liquid-stream-evidence.mjs');
 const valid={profile:'plug',coverage:'active-liquid-particles',volumeMeaning:'world-volume-per-particle',requestedProfile:'plug',effectiveProfile:'plug',expectedProfile:'plug',sourceFrameId:'kaminos/finger-fluid-bench:gpu-simulation-frame',sourceFrameHash:0x6c2673d1,producerTick:3,allocationGeneration:1,epoch:2,header:[0x4b4c4643,1,1,2,3,1,1,0x6c2673d1,1,1,0,0,1,0,0,32,2,0,0,0],records:[0,1,0,0,0,1,0,1,0,1,0,.08,0,-1,0,-1,0,0,0,0,1,.1,0,.0001,1,2,3,0,0,1,3,2]};
 assert.equal(evidence.assertLiquidVolumeCapture(valid).airborneCount,1);
 assert.throws(()=>evidence.assertLiquidVolumeCapture({...valid,header:valid.header.map((v,i)=>i===7?999:v)}),/source frame/);
});
