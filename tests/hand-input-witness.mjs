// kaminos-test: node
import assert from 'node:assert/strict';
const checks=await import('../tools/hand-input-witness-checks.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
assert.equal(typeof checks.assertHandObservation,'function','hand witness needs effective-route and visible-side admission');
const row={model:'spiralconv',side:'right',state:{enabled:true,effectiveModel:'spiralconv',phase:'tracking',identity:{backend:'webgpu-local',mobrecon:{decoder:'spiralconv'}},last:{frameId:3,captureId:'session_3',hands:[{handedness:'right',hasHand:true,verticesMeters:Array(778*3).fill(.1)}]}},view:{visible:true,sides:['right']}};
assert.doesNotThrow(()=>checks.assertHandObservation(row));
for(const mutate of [r=>r.state.effectiveModel='dsconv',r=>r.state.identity.mobrecon.decoder='dsconv',r=>r.state.last.hands=[],r=>r.state.last.hands[0].verticesMeters=[],r=>r.view.visible=false,r=>r.view.sides=[],r=>r.state.last.captureId=null,r=>r.state.phase='waiting']){
  const bad=structuredClone(row);mutate(bad);assert.throws(()=>checks.assertHandObservation(bad));
}
const native=structuredClone(row);native.model='wilor';native.state.effectiveModel='wilor';native.state.identity={model:'wilor',backend:'mlx-metal',weightsSha256:'1'.repeat(64)};
checks.assertHandObservation(native);
native.state.identity.backend='cpu';assert.throws(()=>checks.assertHandObservation(native));
console.log('hand witness rejects substituted, absent, incomplete and invisible observations');

assert.throws(()=>checks.assertHandObservation(row,{frameId:3,captureId:'session_3'}),/earlier source/);
assert.throws(()=>checks.assertHandObservation(row,{frameId:2,captureId:'session_3'}),/earlier source/);
checks.assertHandObservation(row,{frameId:2,captureId:'session_2'});
