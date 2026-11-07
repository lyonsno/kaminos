// kaminos-test: node
import assert from 'node:assert/strict';
import {buildConvexRock} from '../experiments/hill-terrain/rock-geometry.mjs';
import {makeVolumeSpecimen,rockMoments,packVolumeBodies,weatherBody,volumeConfig,PARTICLE_WORDS} from '../experiments/hill-terrain/volume-model.mjs';
import {convexContact} from '../experiments/hill-terrain/convex-contact.mjs';
const cube=buildConvexRock([[1,0,0,1],[-1,0,0,1],[0,1,0,1],[0,-1,0,1],[0,0,1,1],[0,0,-1,1]]),m=rockMoments(cube,3);
assert.ok(Math.abs(m.volume-8)<1e-10);assert.ok(Math.abs(m.mass-24)<1e-10);assert.ok(m.center.every(x=>Math.abs(x)<1e-10));assert.ok(Math.abs(m.inertia[0]-16)<1e-10);
assert.throws(()=>volumeConfig({dt:1}),/CFL/);
const model=makeVolumeSpecimen(),packed=packVolumeBodies(model.bodies);assert.equal(model.bodies.length,9);assert.ok(model.particles.length/PARTICLE_WORDS>1000);assert.equal(packed.body.length,9*40);assert.equal(packed.vertices.length/4,packed.vertexBodies.length);
assert.ok(model.conditioning.maxShift>.069&&model.conditioning.maxShift<.071);for(let i=0;i<9;i++)for(let j=0;j<i;j++)assert.ok((convexContact(model.bodies[i],model.bodies[j])?.depth??0)<1e-6,'prepared volumes must have exclusive interiors');
const mass=()=>model.bodies.reduce((n,b)=>n+b.mass,0)+Array.from({length:model.particles.length/PARTICLE_WORDS},(_,i)=>model.particles[i*PARTICLE_WORDS+3]).reduce((a,b)=>a+b,0);
const before=mass(),result=weatherBody(model,7,.04),after=mass();assert.ok(result.lostMass>0&&result.addedParticles>0);assert.ok(Math.abs(after-before)/before<1e-7,'weathering transfers mass from solid rock to loose material');
assert.ok(model.bodies[7].volume<makeVolumeSpecimen().bodies[7].volume);
console.log(JSON.stringify({particles:model.particles.length/PARTICLE_WORDS,rockBodies:model.bodies.length,weathering:result,massRelativeError:Math.abs(after-before)/before}));
