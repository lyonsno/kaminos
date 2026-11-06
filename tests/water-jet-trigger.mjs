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
await live.dispose();
console.log('Water jet trigger resumes preserved water and respects release');
