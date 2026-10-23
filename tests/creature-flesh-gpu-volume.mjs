// kaminos-test: node
import assert from 'node:assert/strict';
import * as volume from '../experiments/creature-flesh/volume.mjs';
// Existing reference API must not masquerade as a device-backed physical solve.
assert.equal(typeof volume.prepareGpuVolume,'function','Missing GPU topology/colouring preparation');
const source={positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,1]],tetrahedra:[[0,1,2,3],[1,2,3,4]],pinned:[true,false,true,true,false]};
const p=volume.prepareGpuVolume(source);
assert.equal(p.nodes,5);assert.equal(p.elements,2);
for(const t of source.tetrahedra)assert.equal(new Set(t.map(i=>p.graph[i*4+2])).size,4,'No same-colour incident nodes may race');
assert.ok(p.mass.every(m=>m>0));
for(let i=0;i<5;i++){
 const start=p.graph[i*4],count=p.graph[i*4+1];
 for(let j=0;j<count;j++){const e=p.graph[20+(start+j)*2],local=p.graph[21+(start+j)*2];assert.equal(source.tetrahedra[e][local],i);}
}
assert.throws(()=>volume.prepareGpuVolume({...source,tetrahedra:[[0,0,1,2]]}),/volume/);
console.log('GPU graph has complete incidence, positive mass and conflict-free colours; not a GPU execution claim');
