import assert from 'node:assert/strict';
const module=await import('../structural-material-bounded-evidence.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(module?.inspectBoundedWitness,'Bounded native witness authority inspector required');
assert.ok(module.inspectBoundedWitness({route:'kaminos.picked-stone.interior-shards.webgpu.v0'}).length);
assert.ok(module.inspectBoundedWitness({route:'kaminos.picked-stone.bounded-shards.webgpu.v0',phase:'interactive',identity:{backend:'webgpu',adapterFallback:false}}).length);
const fixture={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',phase:'interactive',failure:null,identity:{backend:'webgpu',adapterFallback:false},state:{energyKernel:'isotropic-degradation-v1',constitutiveLayout:'event-frozen-isotropic-degradation-v1',model:{points:4,elements:1,bonds:6},state:Array(64).fill(0),bonds:[0,1,1,0,0,2,1,0,0,3,1,0,1,2,1,0,1,3,1,0,2,3,1,0]},pieces:[{binding:{route:'kaminos.deformable-surface.node-associated-four-split.v0'},renderedPositions:[0,0,0,1,0,0,0,1,0]}]};
assert.deepEqual(module.inspectBoundedWitness(fixture),[]);
for(const mutate of [w=>w.identity.backend='cpu',w=>w.identity.adapterFallback=true,w=>w.state.state.pop(),w=>w.pieces=[],w=>w.pieces[0].renderedPositions=[0,0,0],w=>w.state.energyKernel='dense-reference',w=>w.phase='failed']){const w=structuredClone(fixture);mutate(w);assert.ok(module.inspectBoundedWitness(w).length);}
assert.ok(module.inspectBoundedWitness(fixture,{points:5,elements:1,bonds:6}).length);
assert.ok(module.maximumBoundedSurfaceError,'Full native surface comparison must not depend on argument spreading');
const count=200000,gpu=Array.from({length:count},()=>[0,0,0]),reference=Array(count*3).fill(0);reference[count*3-1]=1;
assert.equal(module.maximumBoundedSurfaceError([{gpu,reference}]),1);
assert.throws(()=>module.maximumBoundedSurfaceError([{gpu:[[0,0,0]],reference:[]}]),/complete/i);
console.log('Wrong/fallback route, partial state, absent/blank surfaces and growing mechanics cannot close bounded evidence');
