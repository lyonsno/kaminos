// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCrustRoute,validateCrustFrames} from '../mineral-worlds/crust-bench-contract.mjs';
const route=()=>({experiment:'mineral-crust',rendererBackend:'webgpu',source:{repoRoot:'/owned'},registered:true,objectId:'crust-1',model:'capillary-crust-strips-v1'});
test('timing rejects a fallback renderer, substituted source or unregistered scene',()=>{
 assert.equal(validateCrustRoute(route(),'/owned').objectId,'crust-1');
 for(const patch of [{rendererBackend:'webgl'},{source:{repoRoot:'/other'}},{registered:false},{experiment:'material-study'},{model:'other'}])assert.throws(()=>validateCrustRoute({...route(),...patch},'/owned'));
});
test('timing rejects missing, stale or malformed scene frames',()=>{
 assert.throws(()=>validateCrustFrames([]));
 assert.throws(()=>validateCrustFrames([{frame:1,drawn:false,cpuMs:1,gpuMs:.2}]));
 assert.throws(()=>validateCrustFrames([{frame:1,drawn:true,cpuMs:1,gpuMs:.2},{frame:1,drawn:true,cpuMs:1,gpuMs:.2}]));
 assert.throws(()=>validateCrustFrames([{frame:1,drawn:true,cpuMs:1,gpuMs:NaN}]));
 assert.equal(validateCrustFrames([{frame:1,drawn:true,cpuMs:1,gpuMs:.2}]).length,1);
});
