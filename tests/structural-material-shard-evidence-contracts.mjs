import assert from 'node:assert/strict';
const api=await import('../structural-material-shard-evidence.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(api?.inspectShardWitness,'Live shard evidence must reject missing and substituted mechanical authority');
for(const state of [null,{}, {route:'kaminos.picked-stone.stress-shards.webgpu.v0',phase:'interactive',identity:{backend:'cpu',adapterFallback:true}}])assert.ok(api.inspectShardWitness(state).length);
console.log('Missing/partial/fallback shard evidence cannot close');
