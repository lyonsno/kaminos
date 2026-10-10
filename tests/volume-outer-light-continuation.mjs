import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continueOuterSmokeRadiance as f,OUTER_SMOKE_OPTICS_WGSL} from '../volume-outer-smoke.mjs';
const incident=[.02,.3,2];
assert.deepEqual(f([0,0,0],1,10),[0,0,0],'a black boundary cannot invent exterior illumination');
assert.deepEqual(f(incident,0,4),incident,'boundary radiance must be continuous');
assert.ok(f(incident,1e-6,4).every((v,i)=>Math.abs(v-incident[i])<1e-5));
assert.ok(f(incident,100,4).every(v=>v<1e-12),'opaque continuation extinguishes incident light, not reveals ambient');
assert.deepEqual(f(incident,1,0),incident.map(v=>v/2),'retain existing geometric approximation');
for(const d of [0,.01,.5,1,4]) {
  let previous=incident;
  for(const sigma of [0,.1,1,10,100]) {
    const value=f(incident,d,sigma);
    assert.ok(value.every((v,i)=>v>=0&&v<=previous[i]),'more extinction cannot increase incoming radiance');
    previous=value;
  }
}
assert.deepEqual(f(incident,-1,-1),incident,'negative distance/extinction retain clamping');
// CPU checks alone must not admit a shader that still manufactures ambient.
assert.match(OUTER_SMOKE_OPTICS_WGSL,/return incident\s*\*\s*w;/);
assert.doesNotMatch(OUTER_SMOKE_OPTICS_WGSL,/ambient|mix\(/);
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
assert.match(core,/continueOuterSmokeRadiance\(incidentAt\(q\),length\(p-q\),extinction\)/);
assert.doesNotMatch(core,/fn outerSmokeAmbient\(/);
console.log('boundary continuity, zero-source preservation and monotonic attenuation passed');
