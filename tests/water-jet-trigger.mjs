// kaminos-test: node
import assert from 'node:assert/strict';
import experiment from '../experiments/water-jet-study.experiment.mjs';

const objects=[{id:'jet',type:'local-liquid-emitter',localLiquidEmitter:{mode:'continuous',emissionEnabled:false}}];
let paused=true,releases=0,flush=Promise.resolve();
const water={read:()=>({runtime:{paused},simulation:{present:true}}),commitEdits:()=>flush,edit(id,patch){Object.assign(objects.find(row=>row.id===id).localLiquidEmitter,patch);},async release(){releases++;paused=false;},pause(){paused=!paused;}};
globalThis.window={kaminosSceneAuthoring:{read:()=>({objects})},kaminosWaterSources:water};
const session={readView:()=>({}),dispose:async()=>{}};
const live=await experiment.create({host:{scene:{open:async()=>session}},inputs:{seed:false},record(){}});
await live.operations.squirt(true);
assert.equal(paused,false,'Holding squirt after manual stepping must resume the existing solver');
assert.equal(releases,0,'Resuming must preserve evolved water');
assert.equal(objects[0].localLiquidEmitter.emissionEnabled,true);
await live.operations.squirt(false);assert.equal(objects[0].localLiquidEmitter.emissionEnabled,false);
let finish;flush=new Promise(resolve=>finish=resolve);
const pressing=live.operations.squirt(true);await live.operations.squirt(false);finish();await pressing;
assert.equal(objects[0].localLiquidEmitter.emissionEnabled,false,'Releasing during pending edits must not latch emission on');
let mounted=false,inletEnabled=false,mountFinished;
water.read=()=>({runtime:mounted?{paused:false}:null,simulation:{present:true}});
water.commitEdits=async()=>{};
water.edit=(id,patch)=>{Object.assign(objects[0].localLiquidEmitter,patch);if(mounted)inletEnabled=objects[0].localLiquidEmitter.emissionEnabled;};
water.release=async()=>{const initial=objects[0].localLiquidEmitter.emissionEnabled;await new Promise(resolve=>mountFinished=resolve);mounted=true;inletEnabled=initial;};
const mounting=live.operations.squirt(true);await Promise.resolve();await live.operations.squirt(false);mountFinished();await mounting;
assert.equal(inletEnabled,false,'Releasing during a cold mount must update the mounted inlet snapshot');
await live.dispose();
console.log('Water jet trigger resumes preserved water and respects release');
