// kaminos-test: node
import assert from 'node:assert/strict';
import {assertMountedScene} from '../visual-work.mjs';
const domain={id:'flame-field',type:'simulation-domain',source:'kaminos:simulation-domain',transform:{position:[1,5,3],rotation:[0,0,0],scale:[2,2,2]}};
// Observed runtime convention: source translation is one world scale below
// the authored center for the tall [-1,3] local domain.
const runtime={backend:'WebGPU:apple',active:true,ordinaryDomainTranslation:[1,3,3],ordinaryDomainScale:2};
assertMountedScene({objects:[domain]},[],{authoredObjects:[domain],volume:runtime});
for(const volume of [null,{...runtime,active:false},{...runtime,ordinaryDomainTranslation:[1,0,3]},{...runtime,ordinaryDomainScale:1}])assert.throws(()=>assertMountedScene({objects:[domain]},[],{authoredObjects:[domain],volume}),/domain|Mount/);
assert.throws(()=>assertMountedScene({objects:[domain]},[],{authoredObjects:[],volume:runtime}),/Mount/);
assert.throws(()=>assertMountedScene({objects:[{id:'mesh',type:'glb'}]},[],{authoredObjects:[{id:'mesh',type:'glb'}],volume:runtime}),/Mount/,'authored metadata must not substitute for a mounted mesh');
console.log('PASS virtual domain mount uses actual runtime transform, with no mesh-metadata substitution');
