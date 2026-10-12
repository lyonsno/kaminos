import assert from 'node:assert/strict';
const module=await import('../structural-material-bounded-fragments.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(module?.buildBoundedFragments,'Damage-owned bounded fragment construction is required');
const positions=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra=[[0,1,2,3]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const bonds=mask=>edges.flatMap(([a,b],i)=>[a,b,Number(!(mask&(1<<i))),0]);
const volume=mesh=>{let v=0;for(let i=0;i<mesh.geometry.indices.length;i+=3){const p=mesh.geometry.indices.slice(i,i+3).map(j=>mesh.geometry.properties.slice(j*12,j*12+3));v+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;}return v;};
for(let mask=0;mask<64;mask++){
 const result=module.buildBoundedFragments({positions,tetrahedra,bonds:bonds(mask)});
 assert.equal(result.mechanicalPoints,4);assert.equal(result.mechanicalElements,1);
 assert.equal(result.cellCount,4);assert.ok(result.visualVertices<=32);
 assert.ok(Math.abs(result.pieces.reduce((s,p)=>s+volume(p),0)-1/6)<1e-12,`Closed volume for mask ${mask}`);
 for(const p of result.pieces){assert.ok(p.binding.entries.every(e=>e.ids.length<=4&&e.ids.every(id=>p.nodes.includes(id))));const out=module.applyBoundedFragmentBinding(p.binding,positions);assert.ok(out.every((point,i)=>point.every((v,k)=>Math.abs(v-p.binding.entries[i].rest[k])<1e-12)));}
}
const intact=module.buildBoundedFragments({positions,tetrahedra,bonds:bonds(0)});
assert.equal(intact.pieces.length,1);assert.equal(intact.interiorTriangles,0);assert.equal(intact.exteriorTriangles,24);
const split=module.buildBoundedFragments({positions,tetrahedra,bonds:bonds(63)});
assert.equal(split.pieces.length,4);
const moved=positions.map((p,i)=>p.map((v,k)=>v+(i===1&&k===0?100:0)));
for(const p of split.pieces){const out=module.applyBoundedFragmentBinding(p.binding,moved);for(let i=0;i<out.length;i++)assert.ok(out[i].every((v,k)=>Math.abs(v-p.binding.entries[i].rest[k]-(p.nodes[0]===1&&k===0?100:0))<1e-12));}
const sharedPositions=[...positions,[0,0,-1]],sharedTets=[[0,1,2,3],[0,2,1,4]],sharedEdges=[...edges,[0,4],[1,4],[2,4]],sharedBonds=sharedEdges.flatMap(([a,b])=>[a,b,1,0]);
const joined=module.buildBoundedFragments({positions:sharedPositions,tetrahedra:sharedTets,bonds:sharedBonds});
assert.equal(joined.interiorTriangles,0);assert.equal(joined.exteriorTriangles,36);assert.ok(Math.abs(joined.pieces.reduce((s,p)=>s+volume(p),0)-1/3)<1e-12);
assert.ok(module.buildFixedCellShell,'A prebuilt shell must avoid rebuilding geometry on each damage event');
const shell=module.buildFixedCellShell({positions,tetrahedra,bonds:bonds(0)}),count=shell.geometry.indices.length;
for(let mask=0;mask<64;mask++){const out=module.applyFixedCellShell(shell.binding,positions,bonds(mask));assert.equal(shell.geometry.indices.length,count);assert.ok(out.every((p,i)=>p.every((v,k)=>Math.abs(v-shell.binding.entries[i].rest[k])<1e-12)));}
const detached=module.applyFixedCellShell(shell.binding,moved,bonds(63));assert.ok(detached.every((p,i)=>p.every((v,k)=>Math.abs(v-shell.binding.entries[i].rest[k]-(shell.binding.entries[i].anchor===1&&k===0?100:0))<1e-12)));
assert.throws(()=>module.buildBoundedFragments({positions,tetrahedra,bonds:[]}),/complete|bond/i);
assert.throws(()=>module.buildBoundedFragments({positions,tetrahedra,bonds:[...bonds(0).slice(0,2),2,...bonds(0).slice(3)]}),/liveness/i);
console.log('All 64 damage patterns conserve closed volume; finite ownership and shared-face cancellation pass');
