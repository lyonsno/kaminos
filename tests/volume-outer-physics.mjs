// kaminos-test: node
import assert from 'node:assert/strict';
import * as outer from '../volume-outer-smoke.mjs';
import {resolvePhysicsAppearance, physicsAppearanceUniformValues, SOOT_BURNOUT_WGSL} from '../volume-physics-appearance.mjs';

assert.equal(typeof outer.outerPhysicsUniformValues, 'function', 'exterior must consume the fine effective physics-appearance receipt');
const config=outer.outerSmokeConfig({materialMode:'reactant-raw',donorMode:'joined-full'});
for(const view of [true,false]) {
  const receipt=resolvePhysicsAppearance({physicalMaterialLaw:2,physicalKelvinPerHeat:2400,physicalSootBurnoutRate:.7,physicalSootBurnoutKelvin:1500},
    {reactantAdmitted:true,emissiveRouteEffective:view});
  assert.deepEqual(outer.outerPhysicsUniformValues(config,receipt),physicsAppearanceUniformValues(receipt),
    'same Kelvin and burnout calibration, including when drawing is disabled');
}
const disabled=resolvePhysicsAppearance({},{});
assert.deepEqual(outer.outerPhysicsUniformValues(config,null),physicsAppearanceUniformValues(disabled));
assert.deepEqual(outer.outerPhysicsUniformValues(outer.outerSmokeConfig(),resolvePhysicsAppearance({physicalMaterialLaw:2,physicalSootBurnoutRate:1},{reactantAdmitted:true})),physicsAppearanceUniformValues(disabled));
assert.throws(()=>outer.outerPhysicsUniformValues(config,{identity:'unknown'}),/physics appearance/);
const shader=outer.outerSmokeShader(config,32);
assert.ok(shader.includes(SOOT_BURNOUT_WGSL.replaceAll('u.emissive_physics','params.physicsLaw')), 'share producer burnout equation, not a separately invented exterior law');
assert.ok(shader.includes('result.material.x *= burnout') && shader.includes('result.velocity.w *= burnout'), 'optical and raw soot must retire together');
assert.ok(shader.indexOf('let burnout=')<shader.indexOf('result.material=nearMaterial(c)'), 'already-evolved donors replace provisional exterior aging');
console.log('outer physics appearance contract passed');
