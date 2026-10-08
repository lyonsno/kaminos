import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=await import('../structural-material-shard-evidence.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(api?.inspectShardWitness,'Live shard evidence must reject missing and substituted mechanical authority');
for(const state of [null,{}, {route:'kaminos.picked-stone.stress-shards.webgpu.v0',phase:'interactive',identity:{backend:'cpu',adapterFallback:true}}])assert.ok(api.inspectShardWitness(state).length);
if(process.argv[2]){const r=JSON.parse(fs.readFileSync(process.argv[2])),observed=r.observations.find(o=>o.name==='second-injury').effective;assert.deepEqual(api.inspectShardWitness(observed),[]);for(const mutate of [w=>w.identity.backend='cpu',w=>w.state.runId='stale',w=>w.pieces[0].renderedPositions=[],w=>w.events[0].tension=0,w=>w.state.stresses[0].invalid=true,w=>w.pieces.pop()]){const w=structuredClone(observed);mutate(w);assert.ok(api.inspectShardWitness(w).length,'Observed fixture mutation must lose evidence authority');}}
console.log('Missing/partial/fallback shard evidence cannot close');
