// kaminos-test: node
import assert from 'node:assert/strict';
import {createEnvironmentLoader} from '../scene-environment-loader.mjs';
let resolveOld;const old=new Promise(r=>resolveOld=r);let calls=0;const shown=[];
const loader=createEnvironmentLoader({presets:{studio:{url:'hdr'}},load:()=>++calls===1?old:Promise.resolve('new-device-map'),apply:map=>shown.push(map),fallback:()=> 'neutral'});
loader.releaseFull();loader.select('studio');await new Promise(r=>setImmediate(r));
assert.equal(typeof loader.invalidateResources,'function','environment needs a device-loss invalidation boundary');
loader.invalidateResources();loader.select('studio');await loader.whenSettled();
resolveOld('dead-device-map');await new Promise(r=>setImmediate(r));
assert.equal(shown.at(-1),'new-device-map');assert(!shown.includes('dead-device-map'));assert.equal(calls,2);
loader.select('studio');assert.equal(calls,2);
console.log('lost-device environments cannot populate the replacement cache or scene');
