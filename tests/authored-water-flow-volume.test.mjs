// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredMlsInlets,authoredMlsSetup} from '../authored-mls-water.mjs';
import {createLocalLiquidEmitterSceneRecord,normalizeLocalLiquidSceneDocument} from '../local-liquid-scene-object.mjs';
import {defaultLocalLiquidSetup,normalizeLocalLiquidEmitter} from '../local-liquid-setup.mjs';
const initial=createLocalLiquidEmitterSceneRecord({id:'volume',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.5,samplesPerUnit:20}}});
const flow=createLocalLiquidEmitterSceneRecord({id:'stream',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:'kaminos.local-liquid-emitter.v1',rate:240,volumeRate:.03,baseRadius:.08,strength:1}});
const options=target=>({...defaultLocalLiquidSetup(),particleCount:10000,waterSampling:{spacing:.05,particleTarget:target,container:{min:[-2,-1,-2],max:[2,3,2]}}});
const settings=normalizeLocalLiquidEmitter(flow.localLiquidEmitter);
assert.equal(settings.volumeRate,.03,'The physical flow amount must survive normalization and save');
const amounts=[];
for(const target of [1000,8000]){
 const setup=authoredMlsSetup([initial,flow],options(target));
 const packet=authoredMlsInlets([initial,flow],0,1,setup.solver.cellSize);
 const amount=packet.emitters[0].source_flux_particles_per_second*setup.solver.cellSize**3/3;
 assert(Math.abs(amount-.03)<1e-12,'Sampling must not change the amount supplied by the stream');amounts.push(amount);
}
const legacy=structuredClone(flow);delete legacy.localLiquidEmitter.volumeRate;
const saved=normalizeLocalLiquidSceneDocument({objects:[initial,legacy],localLiquid:options(1000)});
const oldCell=authoredMlsSetup([initial,legacy],options(1000)).solver.cellSize;
const expected=240*oldCell**3/3;
assert(Math.abs(saved.emitters[1].localLiquidEmitter.volumeRate-expected)<1e-12,'Legacy mixed scenes keep the old amount when migrated');
const reopened=normalizeLocalLiquidSceneDocument({objects:JSON.parse(JSON.stringify(saved.emitters)),localLiquid:options(8000)});
assert.equal(reopened.emitters[1].localLiquidEmitter.volumeRate,saved.emitters[1].localLiquidEmitter.volumeRate,'Reopen cannot reinterpret a canonical flow after sampling edits');
assert.throws(()=>normalizeLocalLiquidEmitter({...flow.localLiquidEmitter,volumeRate:-1}),/volume|flow/i);
console.log('Physical source flow survives initial sampling changes and legacy save/reopen');

const {planSceneRestore,SCENE_SCHEMA,SCENE_VERSION}=await import('../scene-persistence-core.js');
const restored=planSceneRestore({schema:SCENE_SCHEMA,version:SCENE_VERSION,objects:[initial,legacy],localLiquid:options(1000)});
assert(Math.abs(restored.objects.find(r=>r.id==='stream').localLiquidEmitter.volumeRate-expected)<1e-12,'Actual editor restore must migrate before source construction');
