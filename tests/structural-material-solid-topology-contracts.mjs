import assert from 'node:assert/strict';
const imported=await import('../structural-material-solid-topology.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
assert.ok(imported?.prepareSolidTopology,'An exterior-derived material topology is required');
const mesh={status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6};
for(const kind of ['graph','pmb']){
 const model=imported.prepareSolidTopology(mesh,{kind,young:1000,poisson:.25,density:2,horizon:1.5});
 assert.equal(model.positions.length,4);assert.ok(Math.abs(model.masses.reduce((a,b)=>a+b,0)-1/3)<1e-12);
 assert.equal(model.bonds.length,6);assert.equal(model.incidence.length,kind==='graph'?4:12);
 for(const element of model.elements)assert.equal(new Set(element.filter((_,i)=>i<(kind==='graph'?4:2)).map(i=>model.colors[i])).size,kind==='graph'?4:2);
 assert.equal(model.incidenceOffsets.at(-1),model.incidence.length);
 assert.ok(model.masses.every(m=>m>0));
}
assert.throws(()=>imported.prepareSolidTopology({...mesh,status:'failed'},{kind:'graph'}),/admitted/);
assert.throws(()=>imported.prepareSolidTopology({...mesh,tetrahedra:[[0,1,2,4]]},{kind:'graph'}),/indices/);
console.log('Exterior-derived topology preserves mass, complete incidence and conflict-free colors');
