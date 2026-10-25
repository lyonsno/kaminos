// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {composeFingerFluidVelocityReads} from '../finger-fluid-velocity-composition.mjs';
const source=fs.readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const start=source.indexOf('fn compute_velocity_viscosity('),end=source.indexOf('\n@compute',start);
const velocity=source.slice(start,end);
assert.equal(composeFingerFluidVelocityReads(velocity,'pbf'),velocity,'PBF preserves the actual immutable reconstructed velocity field');
const ipbf=composeFingerFluidVelocityReads(velocity,'ipbf');
assert.ok(ipbf.includes('var velocity = particle.delta.xyz;'));
assert.ok(ipbf.includes('particles[neighborIndex].velocity.xyz'));
assert.ok(!ipbf.includes('((particles[neighborIndex].predicted.xyz - particles[neighborIndex].position.xyz) / params.dt)'));
assert.throws(()=>composeFingerFluidVelocityReads('renamed shader','pbf'),/anchor missing/,'Unknown source must fail instead of silently composing the wrong velocity');
