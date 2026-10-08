import assert from 'node:assert/strict';
const api=await import('../structural-material-shard-release-evidence.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(api?.inspectClosedInput,'Release acceptance must reject missing or contradictory input evidence');
const fixture={inputs:[{kind:'move',data:{generation:1,displacement:[.1,0,0]}},{kind:'gesture-finish-request',data:{generation:1,finalDisplacement:[.1,0,0]}},{kind:'release',data:{}}],signals:[{type:'pointerup',buttons:0},{type:'after-up',closed:true,moveRejected:true,finalVectorPreserved:true},{type:'pointermove',buttons:0}]};
assert.deepEqual(api.inspectClosedInput(fixture),[]);
for(const bad of [{inputs:[],signals:[]},{...fixture,signals:[]},{...fixture,inputs:[...fixture.inputs,{kind:'move',data:{generation:1,displacement:[1,0,0]}}]},{...fixture,signals:fixture.signals.map(s=>s.type==='after-up'?{...s,finalVectorPreserved:false}:s)},{...fixture,signals:[{type:'pointerup',buttons:0},{type:'after-up',closed:false,moveRejected:false},{type:'pointermove',buttons:0}]}])assert.ok(api.inspectClosedInput(bad).length,'A successful-looking empty/late/unclosed trace cannot close release ownership');
const newer={...fixture,inputs:[...fixture.inputs,{kind:'move',data:{generation:2,displacement:[.2,0,0]}}]};assert.deepEqual(api.inspectClosedInput(newer),[]);
const onlyBefore={...fixture,signals:[{type:'pointermove',buttons:0},{type:'pointerup',buttons:0},{type:'after-up',closed:true,moveRejected:true}]};assert.ok(api.inspectClosedInput(onlyBefore).length,'Unheld movement before release cannot substitute for movement after release');
console.log('Local release-evidence contract rejects absent signals and old-generation input; synthetic trace is not native conformance evidence');
