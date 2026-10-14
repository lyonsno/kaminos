// kaminos-test: node
import assert from 'node:assert/strict';
import {defaultLocalLiquidSetup,localLiquidInletPacket,LOCAL_LIQUID_EMITTER_SCHEMA,LOCAL_LIQUID_EMITTER_CAPACITY} from '../local-liquid-setup.mjs';
import {createLocalLiquidEmitterSceneRecord,normalizeLocalLiquidSceneDocument,localLiquidRuntimeSourceState} from '../local-liquid-scene-object.mjs';
import {authoredDropSetup} from '../authored-water-host.mjs';
const finite=Array.from({length:6},(_,i)=>createLocalLiquidEmitterSceneRecord({id:'drop-'+i,transform:{position:[-1.5+i*.6,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width:.5,samplesPerUnit:32}}}));
const setup=defaultLocalLiquidSetup();
assert.equal(authoredDropSetup(finite).solver.particleCount,24576);
const restored=normalizeLocalLiquidSceneDocument({localLiquid:setup,objects:finite});assert.equal(restored.emitters.length,6,'Finite membership is independent of continuous inlet slots');
assert.equal(localLiquidRuntimeSourceState({localLiquid:setup,objects:finite},9).inletPacket.emitters.length,0);
const flow=Array.from({length:LOCAL_LIQUID_EMITTER_CAPACITY+1},(_,i)=>createLocalLiquidEmitterSceneRecord({id:'flow-'+i,transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'continuous',rate:1200,baseRadius:.08,strength:1.15}}));
assert.equal(localLiquidInletPacket(setup,[...finite,...flow.slice(0,LOCAL_LIQUID_EMITTER_CAPACITY)]).emitters.length,LOCAL_LIQUID_EMITTER_CAPACITY);
assert.throws(()=>localLiquidInletPacket(setup,[...finite,...flow]),/capacity/,'Actual continuous overflow still fails loud');
assert.throws(()=>localLiquidInletPacket(setup,[{...finite[0],type:'invalid'}]),/scene object/,'Finite filtering cannot bypass source validation');
assert.throws(()=>localLiquidInletPacket(setup,[{...finite[0],localLiquidEmitter:{...finite[0].localLiquidEmitter,drop:{width:-1}}}]),/width/);
console.log('Finite-only and mixed scene membership preserve actual inlet capacity and every source validation');
