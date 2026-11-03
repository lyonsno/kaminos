import assert from 'node:assert/strict';
import test from 'node:test';

import * as worldSmoke from '../volume-world-smoke.mjs';
import * as materialHierarchy from '../volume-material-hierarchy-gpu.mjs';
import * as worldOptics from '../volume-world-smoke-optics.mjs';
import { COMPOSED_SMOKE_WGSL } from '../scene-smoke-reconstruction.mjs';
import { SCENE_VOLUME_SOURCE_WGSL } from '../scene-volume-source.mjs';
import { EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';

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
  // Thermal moments r.b.yzw must scale with sootScale so moments/soot never explodes in zero-soot cells.
  assert.match(worldSmoke.WORLD_SMOKE_WGSL, /r\.b\.yzw\s*\*\s*sootScale/);
  assert.match(materialHierarchy.MATERIAL_HIERARCHY_WGSL, /r\.b\.yzw\s*\*\s*sootScale/);
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
  assert.match(EMISSIVE_TRANSPORT_WGSL, /select\(2\.0,max\(top\+1\.0,2\.0\),direction\/2u==1u\)\/f32\(LIGHT_GRID\)/);
});
