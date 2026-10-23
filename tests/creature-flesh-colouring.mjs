// kaminos-test: node
import assert from 'node:assert/strict';
import {prepareGpuVolume} from '../experiments/creature-flesh/volume.mjs';
// A Freudenthal lattice has tetrahedral 4-cliques and admits four colours.
// Extra colours are unnecessary sequential barriers in every solver iteration.
const positions=[],tetrahedra=[],size=3,id=(i,j,k)=>(k*size+j)*size+i;
for(let k=0;k<size;k++)for(let j=0;j<size;j++)for(let i=0;i<size;i++)positions.push([i,j,k]);
for(let k=0;k<size-1;k++)for(let j=0;j<size-1;j++)for(let i=0;i<size-1;i++)for(const perm of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
 const q=[i,j,k],t=[id(...q)];for(const a of perm){q[a]++;t.push(id(...q));}tetrahedra.push(t);
}
const source={positions,tetrahedra,pinned:positions.map(()=>false)},p=prepareGpuVolume(source);
assert.equal(p.colourCount,4,'Four-colour lattice must not require extra sequential solve phases');
for(const t of tetrahedra)assert.equal(new Set(t.map(i=>p.graph[i*4+2])).size,4,'Concurrent vertices must not share an element');
assert.deepEqual(prepareGpuVolume(source).graph,p.graph,'Same topology retains deterministic ordering');
console.log('Lattice uses four deterministic conflict-free solve phases');
