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

{
 const disposed=[],maps=new Map();let deny=true;
 const resource=name=>({dispose(){disposed.push(name);if(name==='second'&&deny)throw Error('map release denied');}});
 for(const name of ['first','second'])maps.set(name,resource(name));
 const retained=createEnvironmentLoader({presets:{first:{url:'first'},second:{url:'second'}},load:url=>Promise.resolve(maps.get(url)),apply(){},fallback:()=>null});
 retained.releaseFull();retained.select('first');await retained.whenSettled();retained.select('second');await retained.whenSettled();
 assert.throws(()=>retained.invalidateResources(),/map release denied/);deny=false;retained.invalidateResources();
 assert.equal(disposed.filter(name=>name==='first').length,1,'successful map releases must not repeat when retirement is retried');
 assert.equal(disposed.filter(name=>name==='second').length,2);
}
