import assert from 'node:assert/strict';
const api=await import('../structural-material-shard-render.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});assert.ok(api?.createShardGeometry,'Shard consumer must batch contiguous material runs');
const g={numProp:12,properties:[0,0,0,0,0,1,0,0,1,0,0,1, 1,0,0,0,0,1,1,0,1,0,0,1, 0,1,0,0,0,1,0,1,1,0,0,1],indices:[0,1,2,0,1,2,0,1,2,0,1,2],exterior:[true,true,false,false]};
const mesh=api.createShardGeometry(g);assert.deepEqual(mesh.groups,[{start:0,count:6,materialIndex:0},{start:6,count:6,materialIndex:1}]);assert.equal(mesh.attributes.position.count,12);assert.equal(mesh.attributes.tangent.itemSize,4);mesh.dispose();
assert.throws(()=>api.createShardGeometry({...g,exterior:[true]}),/complete/i);
console.log('Actual shard render geometry preserves attributes and batches complete material runs');
