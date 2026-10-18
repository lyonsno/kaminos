// kaminos-test: node
import assert from 'node:assert/strict';
import {waitSceneFrame} from '../tools/scene-frame-wait.mjs';
let disposed=0,frame=25,error=null;
globalThis.window={__kaminosVolumePrototype:{debugState:()=>({active:!error,error})},kaminosSceneGIDebugState:()=>({sceneFrames:frame})};
const page={async waitForFunction(predicate,after){let result=predicate(after);assert.equal(result,false,'A fixed clean frame cannot pretend to advance');error='static-light-transparent-caster:mesh_0';result=predicate(after);assert.ok(result,'Recorded runtime failure must end the wait without a console exception');return {jsonValue:async()=>result,dispose:async()=>{disposed++;}};}};
await assert.rejects(waitSceneFrame(page,25),/transparent-caster/);assert.equal(disposed,1);
error=null;frame=26;
await waitSceneFrame({waitForFunction:async(predicate,after)=>({jsonValue:async()=>predicate(after),dispose:async()=>{disposed++;}})},25);
assert.equal(disposed,2);delete globalThis.window;
