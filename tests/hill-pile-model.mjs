// kaminos-test: node
import assert from 'node:assert/strict';
import {convexContact} from '../experiments/hill-terrain/convex-contact.mjs';
import {volumeSpatialConfig} from '../experiments/hill-terrain/volume-spatial.mjs';
import {makeVolumeSpecimen,volumePoseAnchors,packVolumeBodies,PARTICLE_WORDS} from '../experiments/hill-terrain/volume-model.mjs';
const pile=makeVolumeSpecimen({fixture:'hundred-rocks'});
assert.equal(pile.bodies.length,100,'Hundred-rock fixture constructs one hundred distinct physical bodies');
assert.equal(new Set(pile.bodies.map(b=>b.id)).size,100);
assert.ok(pile.particles.length/PARTICLE_WORDS>9798,'Soil occupies the larger pile domain');
assert.ok(pile.config.dimensions[0]>40&&pile.config.dimensions[1]>30);
pile.bodies[0].anchored=pile.bodies[99].anchored=false;
assert.equal(volumePoseAnchors(pile)[50].canRelease,true,'Other represented rocks remain independently releasable');
assert.equal(packVolumeBodies(pile.bodies).body.length,4000);
assert.throws(()=>makeVolumeSpecimen({fixture:'unknown'}),/fixture/i);

const packed=packVolumeBodies(pile.bodies),spatial=volumeSpatialConfig(pile,packed);
assert.equal(packed.convexOwners.length,packed.convex.length/4);
assert.ok(spatial.width>=2*spatial.radius);
assert.equal(new Uint32Array(spatial.uniform.buffer)[7],100);
assert.equal(spatial.cellCount,spatial.dimensions.reduce((n,v)=>n*v,1));
for(let i=0;i<100;i++){const start=packed.body[i*40+19],end=packed.body[i*40+27]+packed.body[i*40+35];assert.ok(Array.from(packed.convexOwners.slice(start,end)).every(owner=>owner===i));}

for(let i=25;i<100;i++){
 const body=pile.bodies[i],support=pile.bodies[i-25],lowered={...body,position:body.position.map((v,k)=>v-(k===1?.001:0))};
 assert.ok(convexContact(lowered,support),'Each upper rock must begin at its actual support contact, not suspended in a lattice');
}
