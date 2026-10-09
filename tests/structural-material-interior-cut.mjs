import assert from 'node:assert/strict';
const api=await import('../structural-material-interior-cut.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof api.splitMaterialInterior,'function','Fracture must split the material interior, not just release graph edges');
const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],mesh={positions:rest,tetrahedra:[[0,1,2,3]],domains:[0]},position=p=>[2+p[0]*1.1+p[1]*.1,-1+p[1]*.9,p[2]*1.05],velocity=p=>[p[0]+1,p[1]*2,p[2]-2],fields={positions:rest.map(position),velocities:rest.map(velocity),pinned:rest.map(()=>false)};
const volume=(a,b,c,d)=>{const u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]),w=d.map((x,k)=>x-a[k]);return Math.abs(u[0]*(v[1]*w[2]-v[2]*w[1])-u[1]*(v[0]*w[2]-v[2]*w[0])+u[2]*(v[0]*w[1]-v[1]*w[0]))/6;};
const momentum=(m,f)=>{const sum=[0,0,0];m.tetrahedra.forEach(ids=>{const mass=volume(...ids.map(i=>m.positions[i]));ids.forEach(i=>sum.forEach((_,k)=>sum[k]+=mass*f.velocities[i][k]/4));});return sum;};
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const compact=api.splitMaterialInterior(mesh,fields,{targetDomain:0,normal:[1,0,0],offset:.3,children:[1,2]});
assert.ok(compact.parents.every(p=>p.length<=2),'A plane cut must use original corners and edge intersections, not introduce cell-center unknowns');
assert.equal(compact.mesh.tetrahedra.length,4,'One corner cut is one tetrahedron plus a three-tetrahedron prism');
const pairedRest=[...rest,[1,1,1]],paired={positions:pairedRest,tetrahedra:[[0,1,2,3],[4,1,2,3]],domains:[0,0]},pairedFields={positions:pairedRest.map(position),velocities:pairedRest.map(velocity),pinned:pairedRest.map(()=>false)};
const pairedCut=api.splitMaterialInterior(paired,pairedFields,{targetDomain:0,normal:[1,0,0],offset:.3,children:[1,2]});
const sharedFaces=new Map();
for(const ids of pairedCut.mesh.tetrahedra)for(const face of [[0,1,2],[0,1,3],[0,2,3],[1,2,3]]){
 const nodes=face.map(i=>ids[i]);if(!nodes.every(i=>Math.abs(pairedCut.mesh.positions[i].reduce((s,v)=>s+v,0)-1)<1e-10))continue;
 const key=nodes.slice().sort((a,b)=>a-b).join(',');sharedFaces.set(key,(sharedFaces.get(key)??0)+1);
}
assert.equal(sharedFaces.size,3,'The shared triangle splits into a triangle and a quadrilateral');
assert.ok([...sharedFaces.values()].every(n=>n===2),'Adjacent clipped cells must use identical shared-face triangles');
for(const normal of [[1,0,0],[1,1,0].map(v=>v/Math.sqrt(2)),[1,1,-1].map(v=>v/Math.sqrt(3))]){
 const cut=api.splitMaterialInterior(mesh,fields,{targetDomain:0,normal,offset:normal[2]<0?0:.3,children:[1,2]});
 close(cut.receipt.volumeBefore,1/6);close(cut.receipt.volumeAfter,1/6);assert.ok(cut.mesh.domains.includes(1)&&cut.mesh.domains.includes(2));
 const families=cut.mesh.positions.map(()=>0),owners=cut.mesh.positions.map(()=>new Set());cut.mesh.tetrahedra.forEach((ids,t)=>{assert.equal(new Set(ids).size,4);assert.ok(volume(...ids.map(i=>cut.mesh.positions[i]))>0);ids.forEach(i=>{families[i]++;owners[i].add(cut.mesh.domains[t]);});});
 assert.ok(families.every(n=>n>0),'Every point must belong to real retained material');assert.ok(owners.every(s=>s.size===1),'The crack interface must not share material points');
 cut.mesh.positions.forEach((p,i)=>{position(p).forEach((v,k)=>close(v,cut.fields.positions[i][k]));velocity(p).forEach((v,k)=>close(v,cut.fields.velocities[i][k]));close(cut.parents[i].reduce((s,e)=>s+e.weight,0),1);});
 momentum(mesh,fields).forEach((v,k)=>close(v,momentum(cut.mesh,cut.fields)[k]));
 const again=api.splitMaterialInterior(cut.mesh,cut.fields,{targetDomain:1,normal:[0,1,0],offset:.2,children:[3,4]});close(again.receipt.volumeAfter,1/6);assert.ok(again.mesh.domains.includes(2),'Repeated injury must preserve unrelated fragments');
}
assert.throws(()=>api.splitMaterialInterior(mesh,fields,{targetDomain:0,normal:[1,0,0],offset:2,children:[1,2]}),/intersect/);
assert.throws(()=>api.splitMaterialInterior(mesh,fields,{targetDomain:0,normal:[2,0,0],offset:.3,children:[1,2]}),/unit/);
assert.throws(()=>api.splitMaterialInterior(mesh,{...fields,velocities:[]},{targetDomain:0,normal:[1,0,0],offset:.3,children:[1,2]}),/fields/);
console.log('Interior cut conserves volume and linear-field momentum, preserves pose/velocity, duplicates interfaces and survives repeated injury');
