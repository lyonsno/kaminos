import assert from 'node:assert/strict';
import {validateMotion} from '../tools/marionette-motion-batch.mjs';
const raw={status:'completed',frames:60,joints:2,cooperative:true,controllerNorm:'valid-joints',
 positions:Array(360).fill(1),localRotations:Array(480).fill(1),rootTranslation:Array(180).fill(1),rootFacing:Array(240).fill(1),offsets:Array(6).fill(1),features:Array(1440).fill(1)};
assert.throws(()=>validateMotion(raw,2),/identity/, 'output with missing source/prompt identity must not pass');
const valid={...raw,route:'unimate.text-to-motion.webgpu-local.v0',prompt:'An object walks forward.',seed:1,textEncoder:'browser T5',assetCondSha256:'a'.repeat(64)};
assert.equal(validateMotion(valid,2),valid);
for(const mutate of [x=>x.features.pop(),x=>x.positions.fill(0),x=>x.offsets.fill(0),x=>x.rootFacing[0]=NaN,x=>x.joints=3,x=>x.cooperative=false,x=>x.controllerNorm='padded-joints',x=>x.textEncoder='captured embedding',x=>x.prompt='',x=>delete x.assetCondSha256]) {
 const x=structuredClone(valid);mutate(x);assert.throws(()=>validateMotion(x,2));
}
console.log('motion retention identity, finite/full output and fallback controls pass');
