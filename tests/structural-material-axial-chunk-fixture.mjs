// kaminos-test: node
import assert from 'node:assert/strict';
import * as fixture from '../structural-material-stone-fixture.js';
import * as topology from '../structural-material-solid-topology.mjs';
import {materialComponents} from '../structural-material-solid-surface.mjs';
import {stoneMaterialParameters} from '../structural-material-workbench-host.mjs';

assert.equal(typeof fixture.buildAxialChunkFixture,'function','An explicit axial chunk fixture must exist without impersonating an imported mesh');
const body=fixture.buildAxialChunkFixture();
assert.equal(body.route,'kaminos.stone.axial-chunk-fixture.v1');
assert.deepEqual(body,fixture.buildAxialChunkFixture());
assert(body.positions.length>20&&body.tetrahedra.length>20);
assert(body.positions.every(p=>p.length===3&&p.every(Number.isFinite)));
assert.equal(typeof topology.prepareProceduralFixtureTopology,'function','Procedural fixture admission must be distinct from fTetWild provenance');
const model=topology.prepareProceduralFixtureTopology(body,{kind:'graph',young:100000,poisson:.25,density:1000,damageLaw:'event-frozen-isotropic-degradation-v1'});
assert.equal(model.route,'kaminos.procedural-fixture.material-topology.v1');
assert(Math.abs(model.volume-body.volume)<1e-10);
assert.equal(new Set(materialComponents(model.positions.length,Array.from(topology.packSolidTopology(model).bonds))).size,1);
assert.throws(()=>topology.prepareSolidTopology(body,{kind:'graph'}),/admitted exterior/);
assert.throws(()=>topology.prepareProceduralFixtureTopology({...body,route:'ftetwild-cpu-wildmeshing-0.4.1'},{kind:'graph'}),/explicit axial/);
const cut=Array.from(topology.packSolidTopology(model).bonds);
for(let i=0;i<model.bonds.length;i++){
 const [a,b]=model.bonds[i];
 if(body.positions[a][0]<body.neck.plane&&body.positions[b][0]>body.neck.plane||body.positions[b][0]<body.neck.plane&&body.positions[a][0]>body.neck.plane)cut[i*4+2]=0;
}
const groups=materialComponents(model.positions.length,cut),sizes=new Map();
groups.forEach(g=>sizes.set(g,(sizes.get(g)??0)+1));
assert.equal(sizes.size,2,'The narrow neck must separate two substantial lobes, not orphan fixture points');
assert([...sizes.values()].every(n=>n>20));
assert(body.supports.length>3&&body.supports.every(i=>body.positions[i][0]===body.bounds.min[0]));
assert(body.geometry.indices.length===body.geometry.exterior.length*3);
assert(body.geometry.properties.every(Number.isFinite));
assert(body.secondInjury.point[0]>body.neck.plane,'Secondary injury must target the detachable lobe');
assert.equal(stoneMaterialParameters('?stoneFixture=axial-chunks').get('fixture'),'axial-chunks','The fixture must be explicitly selectable in the actual Workbench producer');
assert.throws(()=>stoneMaterialParameters('?stoneFixture=unknown'),/fixture/);
assert.equal(stoneMaterialParameters('').has('fixture'),false);
console.log('Axial two-lobe fixture conserves volume, has explicit synthetic provenance, and retains a secondary injury site');
