// kaminos-test: node
import assert from 'node:assert/strict';
import {createMotionCollection} from '../experiments/creature-motion/motion-collection.mjs';
const library=createMotionCollection();
const motion=(prompt='walk',cond='a')=>({status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',cooperative:true,controllerNorm:'valid-joints',assetCondSha256:cond.repeat(64),prompt,seed:1,frames:2,joints:2,skeleton:{jointNames:['root','foot'],parents:[-1,0],fps:30},positions:Array(12).fill(0),localRotations:[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1]});
const a=await library.add(motion()),b=await library.add(motion('hop'));
assert.notEqual(a.id,b.id);assert.equal(library.list(a.skeletonKey).length,2);
const other=await library.add(motion('walk','b'));assert.notEqual(a.skeletonKey,other.skeletonKey);assert.equal(library.list(a.skeletonKey).length,2);
const snapshot=library.export();const restored=createMotionCollection();await restored.import(snapshot);assert.equal(restored.list().length,3);await restored.import(snapshot);assert.equal(restored.list().length,3);
await assert.rejects(()=>library.add({...motion(),positions:[]}),/positions/);
await assert.rejects(()=>library.add({...motion(),textEncoder:'fallback'}),/route/);
const bad=structuredClone(snapshot);bad.motions[0].motion.prompt='changed';await assert.rejects(()=>restored.import(bad),/digest/);assert.equal(restored.list().length,3);
assert(library.read().bytes>0);assert.equal(library.list(a.skeletonKey).length,2);
console.log('motion collection retention, skeleton separation, export/import and corrupt-output rejection pass');
