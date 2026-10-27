// kaminos-test: node
import assert from 'node:assert/strict';
import {materialFixture} from '../tools/fracture-material-replay.mjs';
const p={x:1,y:2,z:3},b={index:0,rest:p,position:{x:9,y:9,z:9},halfExtents:[1,2,3],mass:4};
const report={commit:'observed',sourceDigest:'asset',initial:{material:{backend:'webgpu-avbd',hand:null,broken:0,bodies:[b],bonds:[{a:0,b:0,normal:p,anchorA:p,anchorB:p,alive:true,linearStiffness:12}],config:{strength:20},dimensions:{dx:1,dy:1,dz:1},floorY:-1}}};
const fixture=materialFixture(report);assert.deepEqual(fixture.cells[0].position,[1,2,3]);assert.deepEqual(fixture.bonds[0].anchorA,[1,2,3]);assert.equal(fixture.cells[0].mass,4);assert.equal(fixture.bonds[0].linearStiffness,12);
fixture.config.strength=30;fixture.cells[0].position[0]=100;assert.equal(report.initial.material.config.strength,20);assert.equal(report.initial.material.bodies[0].rest.x,1);
assert.throws(()=>materialFixture({...report,sourceDigest:null}),/source identity/);
assert.throws(()=>materialFixture({...report,initial:{material:{...report.initial.material,backend:'fallback'}}}),/observed WebGPU/);
assert.throws(()=>materialFixture({...report,initial:{material:{...report.initial.material,broken:1}}}),/intact ungrabbed/);
