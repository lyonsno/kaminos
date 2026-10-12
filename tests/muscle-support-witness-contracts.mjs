import assert from 'node:assert/strict';
import {validateSupportSnapshot} from '../muscle-support-assay-witness.mjs';
const fixture={schema:'kaminos-muscle-support-assay-v1',status:'loaded',effectiveRoute:'dedicated-kaminos-procedural-assay',rendererBackend:'WebGPUBackend',registeredObjects:[{id:'a'},{id:'b'},{id:'c'}],selectedBone:'fixture-hinge-bone',metrics:[{},{},{}],fixture:{vertices:1},samples:[{positions:[[0,0,0],[0,0,0],[0,0,0]]}]};
assert.equal(validateSupportSnapshot(fixture),fixture);
for(const replacement of [{status:'loading'},{rendererBackend:'WebGLBackend'},{effectiveRoute:'cached-demo'},{registeredObjects:[{id:'a'},{id:'a'},{id:'b'}]},{selectedBone:'other'},{samples:[{positions:[[0,0,0],[0,0,0]]}]},{samples:[{positions:[[NaN,0,0],[0,0,0],[0,0,0]]}]}])assert.throws(()=>validateSupportSnapshot({...fixture,...replacement}));
console.log('support witness rejects unloaded, fallback, wrong route/bone, duplicate, partial, non-finite evidence');
