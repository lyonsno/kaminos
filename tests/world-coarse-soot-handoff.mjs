import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import * as worldSmoke from '../volume-world-smoke.mjs';
import * as materialHierarchy from '../volume-material-hierarchy-gpu.mjs';
import * as worldOptics from '../volume-world-smoke-optics.mjs';
import { WORLD_RENDER_STRIDE, WORLD_RENDER_WGSL } from '../volume-world-render.mjs';
import { COMPOSED_SMOKE_WGSL } from '../scene-smoke-reconstruction.mjs';
import { SCENE_VOLUME_SOURCE_WGSL } from '../scene-volume-source.mjs';
import { EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

test('coarse soot transport excludes soot from gaseous Laplacian diffusion and sharpens soot peaks', () => {
  assert.equal(typeof worldSmoke.coarseSootClump, 'function');

  // Zero soot stays zero even with positive neighbor Laplacian.
  assert.equal(worldSmoke.coarseSootClump(0, 0.4, 0.25), 0);

  // A local soot peak (negative Laplacian) is preserved/sharpened rather than diffused down.
  const peakSoot = 0.24;
  const sharpened = worldSmoke.coarseSootClump(peakSoot, -0.15, 0.25);
  assert.ok(
    sharpened >= peakSoot,
    `expected local soot peak to resist diffusion (got ${sharpened} < ${peakSoot})`,
  );

  // Both coarse material solvers must use coarseSootClump on r.a.x and restrict w * lapA to .yzw.
  assert.match(worldSmoke.WORLD_SMOKE_SHARED_WGSL, /fn coarseSootClump\(/);
  assert.match(worldSmoke.WORLD_SMOKE_WGSL, /coarseSootClump\(r\.a\.x,\s*lapA\.x,\s*dt\)/);
  assert.doesNotMatch(worldSmoke.WORLD_SMOKE_WGSL, /r\.a\s*=\s*max\(vec4<f32>\(0\),\s*r\.a\s*\*\s*\(1\.0\s*-\s*6\.0\s*\*\s*w\)\s*\+\s*neighbors\s*\*\s*w\)/);
  assert.match(
    materialHierarchy.MATERIAL_HIERARCHY_WGSL,
    /coarseSootClump\(r\.a\.x,\s*lapA\.x,\s*dt\)/,
  );
  assert.doesNotMatch(
    materialHierarchy.MATERIAL_HIERARCHY_WGSL,
    /r\.a\s*=\s*max\(vec4<f32>\(0\),\s*r\.a\s*\*\s*\(1\.0\s*-\s*6\.0\s*\*\s*w\)\s*\+\s*neighbors\s*\*\s*w\)/,
  );
  // Smoke-only coarse World grid zeroes Plane B instead of evolving thermal moments.
  assert.match(worldSmoke.WORLD_SMOKE_WGSL, /vec4<f32>\(nextSoot,nextHeat,0\.0,0\.0\),vec4<f32>\(0\.0\)/);
  assert.match(materialHierarchy.MATERIAL_HIERARCHY_WGSL, /vec4<f32>\(nextSoot,nextHeat,0\.0,0\.0\),vec4<f32>\(0\.0\)/);
});

test('fine-to-coarse donor envelope tapers smoothly inside upper walls and corners so coarse advection takes over before the box edge', () => {
  assert.equal(typeof worldSmoke.fineDonorEnvelope, 'function');

  const top = 3.0;
  // Core combustion zone near the fire bed stays 100% Fine-authoritative.
  assert.equal(worldSmoke.fineDonorEnvelope([0, 0, 0], top), 1);
  // Bottom floor does not get sponged away.
  assert.ok(worldSmoke.fineDonorEnvelope([0, -0.95, 0], top) > 0.9);
  // Outer side walls and ceiling hand off to the coarse solver (0 donor overwrite).
  assert.equal(worldSmoke.fineDonorEnvelope([0.98, 1.0, 0], top), 0);
  assert.equal(worldSmoke.fineDonorEnvelope([0, top - 0.05, 0], top), 0);

  // Rounded ellipsoidal interior taper reduces corner weight smoothly below axis-aligned mid-wall weight.
  const midWall = worldSmoke.fineDonorEnvelope([0.65, 1.0, 0], top);
  const corner = worldSmoke.fineDonorEnvelope([0.65, 1.0, 0.65], top);
  assert.ok(midWall > 0.1 && midWall < 0.95, `expected interior transition weight at x=0.65, got ${midWall}`);
  assert.ok(corner < midWall, `expected rounded corner weight (${corner}) < mid-wall weight (${midWall})`);

  // Both coarse material solvers use fineDonorWeight instead of raw fineCellFraction box overwrite.
  assert.match(worldSmoke.WORLD_SMOKE_SHARED_WGSL, /fn fineDonorWeight\(/);
  assert.match(worldSmoke.WORLD_SMOKE_SHARED_WGSL, /fn priorFineDonorWeight\(/);
  assert.match(worldSmoke.WORLD_SMOKE_WGSL, /fineDonorWeight\(p,\s*u\.material\.w\)/);
  assert.match(materialHierarchy.MATERIAL_HIERARCHY_WGSL, /fineDonorWeight\(p,\s*n\.loPitch\.w\)/);

  // R1: remapMaterial preserves exterior coarse-advected smoke (total - owned) inside the tapered handoff region.
  assert.equal(typeof worldSmoke.remapWorldMaterial, 'function');
  const remapped = worldSmoke.remapWorldMaterial(1.0, 0.3, 0.3, 0.3);
  assert.ok(Math.abs(remapped.total - 1.0) < 1e-6, `expected remapMaterial to preserve total=1.0 when old=next=0.3, got ${remapped.total}`);
  assert.ok(Math.abs(remapped.owned - 0.3) < 1e-6, `expected remapMaterial to preserve owned=0.3, got ${remapped.owned}`);
  assert.match(worldSmoke.WORLD_SMOKE_WGSL, /fn remapMaterial[^]*?let old=priorFineDonorWeight\(source,sourcePitch\);[^]*?let next=priorFineDonorWeight\(p,pitch\);/);
});

test('world smoke optics use a rounded corner-free interior blend and sub-grid coarse soot clumping', () => {
  assert.equal(typeof worldOptics.fineOpticalEnvelope, 'function');
  assert.equal(typeof worldOptics.worldSubgridClump, 'function');

  const top = 3.0;
  assert.equal(worldOptics.fineOpticalEnvelope([0, 0, 0], top), 1);
  assert.ok(worldOptics.fineOpticalEnvelope([0, -0.95, 0], top) > 0.95);
  assert.equal(worldOptics.fineOpticalEnvelope([0.99, 1.0, 0], top), 0);
  assert.equal(worldOptics.fineOpticalEnvelope([0, top - 0.02, 0], top), 0);

  const faceWeight = worldOptics.fineOpticalEnvelope([0.7, 1.0, 0], top);
  const cornerWeight = worldOptics.fineOpticalEnvelope([0.7, 1.0, 0.7], top);
  assert.ok(cornerWeight < faceWeight, `expected rounded optical envelope at corner (${cornerWeight} < ${faceWeight})`);

  // Sub-grid clumping modulates dense coarse plumes across World grid space without wall-clock drift.
  const c0 = worldOptics.worldSubgridClump([0.15, 1.4, -0.2], 0.8);
  const c1 = worldOptics.worldSubgridClump([0.85, 2.1, 0.45], 0.8);
  assert.notEqual(c0, c1);
  assert.ok(c0 > 0.35 && c0 < 1.85);
  assert.ok(c1 > 0.35 && c1 < 1.85);

  assert.match(worldOptics.WORLD_SMOKE_OPTICS_WGSL, /fn fineOpticalEnvelope\(/);
  assert.match(worldOptics.WORLD_SMOKE_OPTICS_WGSL, /fn worldSubgridClump\(/);
  assert.match(worldOptics.WORLD_SMOKE_OPTICS_WGSL, /fn worldSubgridWarp\(/);
  assert.match(worldOptics.WORLD_SMOKE_OPTICS_WGSL, /fn worldGridPoint\(/);
  // R3.2: worldSmokeBlend returns near unattenuated when !worldSmokeOn().
  assert.match(worldOptics.WORLD_SMOKE_OPTICS_WGSL, /if\(!worldSmokeOn\(\)\|\|any\(p<worldRender\.loPitch\.xyz\)\|\|any\(p>worldRender\.hiEnabled\.xyz\)\)\{return near;\}/);
});

test('scene lighting and volume source blend smoothly across the rounded interior handoff and full tall domain', () => {
  assert.match(COMPOSED_SMOKE_WGSL, /fineIncidentEnvelope\(p,\s*hi\.y\)/);
  assert.match(COMPOSED_SMOKE_WGSL, /smoothstep\(0\.0,exteriorCoverage\.loBlend\.w,distance\)/);
  assert.match(SCENE_VOLUME_SOURCE_WGSL, /worldSubgridWarp\(p,worldRender\.loPitch\.w\)/);
  assert.match(SCENE_VOLUME_SOURCE_WGSL, /worldSubgridWarp\(p,worldRender\.middleLoPitch\.w\)/);
  assert.match(SCENE_VOLUME_SOURCE_WGSL, /worldSubgridClump\(p,\s*medium\.absorption\s*\+\s*medium\.scattering\)/);
  assert.match(EMISSIVE_TRANSPORT_WGSL, /2\.0\s*\*\s*f32\(GRID_Y\)\s*\/\s*f32\(GRID\)\s*-\s*1\.0/);
  assert.match(EMISSIVE_TRANSPORT_WGSL, /select\(2\.0,spanY,direction\/2u==1u\)\/f32\(LIGHT_GRID\)/);
});

test('resident World optical brick preparation performs Material-first sub-grid warp and clumping so camera ray steps pay zero per-step hash evaluations', () => {
  assert.match(WORLD_RENDER_WGSL, /fn worldRenderSampleGas\(/);
  assert.match(WORLD_RENDER_WGSL, /worldSubgridWarpGrid\(q,\s*n\.loPitch\.w\)/);
  assert.match(WORLD_RENDER_WGSL, /worldSubgridClumpGrid\(q,\s*medium\.absorption\s*\+\s*medium\.scattering\)/);
  // Camera raymarching on the resident-atlas route returns worldResidentMaterial(p, ...) without evaluating worldSubgridWarp or worldSubgridClump on far.
  assert.match(
    worldOptics.WORLD_SMOKE_OPTICS_WGSL,
    /if\(worldRender\.atlas\.x>\.5\)\{let far=worldResidentMaterial\(p,smokeVisible,fireVisible\);if\(middleSmokeWeight\(p\)<=0\.0\)\{return far;\}/,
  );
});

test('smoke-only coarse World grid packs 4 subcell extinctions per texel (WORLD_RENDER_STRIDE = 253), eliminates coarse emission/combustion/thermal-moment ALU, and sponges Fine flame inside the Fine boundary collar', () => {
  assert.equal(WORLD_RENDER_STRIDE, 253, '3 header texels + 250 packed 4-subcell extinction texels = 253');
  const regionFn = worldOptics.WORLD_SMOKE_OPTICS_WGSL.slice(
    worldOptics.WORLD_SMOKE_OPTICS_WGSL.indexOf('fn regionSmokeMaterial('),
    worldOptics.WORLD_SMOKE_OPTICS_WGSL.indexOf('fn middleSmokeWeight('),
  );
  assert.doesNotMatch(regionFn, /thermalQuadrature|physicsSootKelvin|thermalRadiance|emissiveMaterial/, 'coarse regionSmokeMaterial must not evaluate blackbody or moment emission');
  assert.match(regionFn, /return EmissiveMaterial\(vec3<f32>\(0\.0\),sigma\*\(1\.0-albedo\),sigma\*albedo\);/);

  const residentFn = WORLD_RENDER_WGSL.slice(
    WORLD_RENDER_WGSL.indexOf('fn worldResidentMaterial('),
    WORLD_RENDER_WGSL.indexOf('struct WorldRenderGas'),
  );
  assert.match(residentFn, /row>>2u/, 'worldResidentMaterial unpacks 4 subcell extinctions per atlas texel');
  assert.match(residentFn, /return EmissiveMaterial\(vec3<f32>\(0\),sigma\*\(1\.0-albedo\),sigma\*albedo\);/);

  const transportFn = worldSmoke.WORLD_SMOKE_WGSL.slice(worldSmoke.WORLD_SMOKE_WGSL.indexOf('fn transportMaterial('));
  assert.doesNotMatch(transportFn, /reactantBurn|shiftThermalMoments|sootBurnoutSurvival/);
  const advanceFn = materialHierarchy.MATERIAL_HIERARCHY_WGSL.slice(
    materialHierarchy.MATERIAL_HIERARCHY_WGSL.indexOf('fn advanceBricks('),
    materialHierarchy.MATERIAL_HIERARCHY_WGSL.indexOf('fn restrictBricks('),
  );
  assert.doesNotMatch(advanceFn, /reactantBurn|shiftThermalMoments|sootBurnoutSurvival/);

  assert.equal(typeof worldOptics.fineFlameContainmentEnvelope, 'function');
  assert.equal(worldOptics.fineFlameContainmentEnvelope([0, 0, 0], 3), 1);
  assert.equal(worldOptics.fineFlameContainmentEnvelope([0.70, 1.0, 0], 3), 1, 'Fine flame box keeps 100% authority out to |x|,|z|=0.74');
  assert.ok(
    worldOptics.fineFlameContainmentEnvelope([0.70, 1.0, 0], 3) > worldOptics.fineOpticalEnvelope([0.70, 1.0, 0], 3),
    'Fine flame containment envelope preserves a wider 100% interior than the smoke blend envelope',
  );
  assert.equal(worldOptics.fineFlameContainmentEnvelope([0.97, 1.0, 0], 3), 0, 'Flame emission is sponged to 0 before the Fine wall');
  assert.equal(worldOptics.fineFlameContainmentEnvelope([0, 2.92, 0], 3), 0, 'Flame emission is sponged to 0 before the Fine ceiling');

  assert.match(core, /let spongedFuel = fuel \* \(1\.0 - collarSurvival\);/);
  assert.match(core, /smoke = smoke \+ spongedFuel \* select\(/);
  assert.match(core, /reactantFreshBurnRate = reactantFreshBurnRate \* collarSurvival;/);
  assert.match(core, /let warmBuoyancyCap = 450\.0 \/ max\(u\.emissive_physics\.y, 800\.0\);/);
});
