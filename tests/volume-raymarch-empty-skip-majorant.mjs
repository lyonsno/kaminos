// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { WORLD_RENDER_WGSL } from '../volume-world-render.mjs';
import { WORLD_SMOKE_OPTICS_WGSL } from '../volume-world-smoke-optics.mjs';
import { DISPLAY_RECONSTRUCTION_WGSL } from '../volume-display-reconstruction.mjs';
import { HISTORY_ALLOCATION_WGSL } from '../volume-history-allocation.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

test('prepareWorldRender stores workgroup-reduced leaf brick majorants and worldResidentMaterial elides empty-brick subcell reads', () => {
  assert.match(WORLD_RENDER_WGSL, /var<workgroup>\s+worldBrickMax:\s*array<vec2<f32>,\s*64>/);
  assert.match(
    WORLD_RENDER_WGSL,
    /writeWorldAtlas\(start\+2u,\s*vec4<f32>\(m\.x,\s*m\.y,\s*max\(m\.x,\s*m\.y\),\s*1(?:\.0)?\)\)/,
    'leaf bricks store (maxEmission, maxSigma, maxSupport, 1) in their unused third header texel',
  );
  const residentFn = WORLD_RENDER_WGSL.slice(
    WORLD_RENDER_WGSL.indexOf('fn worldResidentMaterial('),
    WORLD_RENDER_WGSL.indexOf('struct WorldRenderGas'),
  );
  const emptyCheck = residentFn.indexOf('if(leafBounds.w>0.5&&leafBounds.z<=1e-4){return EmissiveMaterial(vec3<f32>(0),0,0);}');
  const trilinearLoop = residentFn.indexOf('for(var z=0u;z<2u;z++)');
  assert.ok(emptyCheck >= 0 && emptyCheck < trilinearLoop, 'empty leaf bricks return zero before 8-corner subcell loads');
  assert.match(WORLD_RENDER_WGSL, /fn worldLeafExitDistance\(/);
});

test('worldSmokeBlend early-outs when blend weight is zero and incidentAt is gated by positive scattering', () => {
  const blendFn = WORLD_SMOKE_OPTICS_WGSL.slice(WORLD_SMOKE_OPTICS_WGSL.indexOf('fn worldSmokeBlend('));
  const weightGuard = blendFn.indexOf('if(weight<=1e-4){return near;}');
  const materialCall = blendFn.indexOf('worldSmokeMaterial(p,smokeVisible,fireVisible)');
  assert.ok(weightGuard >= 0 && weightGuard < materialCall, 'interior Fine steps with zero World blend weight skip worldSmokeMaterial');

  assert.doesNotMatch(
    core,
    /let scatteredSource\s*=\s*medium\.scattering\s*\*\s*incidentAt\(p\);/,
    'unconditional incidentAt(p) on zero-scattering/empty steps is forbidden',
  );
  assert.match(
    core,
    /let scatteredSource\s*=\s*select\(vec3<f32>\(0(?:\.0)?\),\s*medium\.scattering\s*\*\s*incidentAt\(p\),\s*medium\.scattering\s*>\s*1e-5\);/,
    'incidentAt(p) is gated by medium.scattering > 1e-5',
  );
});

test('Fine binary empty-space skipping and 8-corner majorant adaptive stepping remain active with displayReconstruction and worldActive', () => {
  assert.match(DISPLAY_RECONSTRUCTION_WGSL, /fn sampleDisplayMaterialWithSupport\(/);
  assert.match(DISPLAY_RECONSTRUCTION_WGSL, /fn displayCellExitDistance\(/);
  assert.match(
    core,
    /if\s*\(!opticalStepping\s*&&\s*!guided\s*&&\s*!fullGridCapture\s*&&\s*!opticalTrace\s*&&\s*directSupport\s*<=\s*0\.0001\)/,
    'Fine empty-cell skip runs in standard marching even when displayReconstructionActive() and worldActive are enabled',
  );
  assert.match(
    core,
    /let cellExit\s*=\s*select\(directCellExitDistance\(p,\s*rd\),\s*displayCellExitDistance\(p,\s*rd\),\s*displayReconstructionActive\(\)\);/,
    'Fine empty-cell skip uses displayCellExitDistance when 2x display reconstruction is active',
  );
  assert.match(
    core,
    /let adaptiveScale\s*=\s*mix\(2\.25,\s*0\.75,\s*fine\);/,
    'majorant-bounded adaptive step scale refines below 1.0x in high-majorant flame sheets and coarsens in low-density smoke',
  );
});

test('guided and history allocators elide unused DDA stops and concentrate history weight without ds self-attenuation', () => {
  assert.match(
    HISTORY_ALLOCATION_WGSL,
    /let effectiveSpan\s*=\s*max\(ds,\s*rayGuidance\.loPitch\.w\);/,
    'history guidance score uses at least cell pitch so narrowing ds does not erase cell importance',
  );
  assert.match(
    HISTORY_ALLOCATION_WGSL,
    /if\(OPTICAL_STEP_MODE==4u\)\{return end;\}/,
    'uniform budgeted mode skips per-cell DDA stops in guidanceStop',
  );
  assert.match(
    HISTORY_ALLOCATION_WGSL,
    /if\(!insideFine&&worldRender\.atlas\.x>0\.5\)\{\s*var n=vec4<f32>\(0\);let b=worldResidentLeafBounds\(p,&n\);/,
    'joins guidance weights outer World segments by leaf-brick majorant support behind a short-circuit guard',
  );
  assert.match(
    core,
    /if\(guided\)\{recordRayGuidance\(p,medium\.emission\+scatteredSource,max\(sigma,brickSupport\/max\(pitch,1e-4\)\),trans,ds\);\}/,
    'outer World history guidance records leaf-brick majorant support',
  );
  assert.match(
    core,
    /if\(guided\)\{recordRayGuidance\(p,emission,max\(sigma,displaySupport\*0\.35\*visibleSmokeAuthority\),trans,localDt\);\}/,
    'Fine history guidance records 8-corner display majorant support',
  );
});

test('R1 regression: worldLeafExitDistance, displayCellExitDistance, and directCellExitDistance never drop near-face slab axes when tx <= 1e-4', () => {
  const leafExitFn = WORLD_RENDER_WGSL.slice(
    WORLD_RENDER_WGSL.indexOf('fn worldLeafExitDistance('),
    WORLD_RENDER_WGSL.indexOf('fn worldResidentMaterial('),
  );
  assert.doesNotMatch(leafExitFn, /if\s*\(\s*t[xyz]\s*>\s*(?:1e-4|0\.0001)\s*\)/, 'worldLeafExitDistance must not ignore near-face exit axes');
  assert.match(leafExitFn, /best=min\(best,max\(0\.0,tx\)\)/);
  assert.match(leafExitFn, /best=min\(best,max\(0\.0,ty\)\)/);
  assert.match(leafExitFn, /best=min\(best,max\(0\.0,tz\)\)/);

  const displayExitFn = DISPLAY_RECONSTRUCTION_WGSL.slice(
    DISPLAY_RECONSTRUCTION_WGSL.indexOf('fn displayCellExitDistance('),
  );
  assert.doesNotMatch(displayExitFn, /if\s*\(\s*t[xyz]\s*>\s*(?:1e-4|0\.0001)\s*\)/, 'displayCellExitDistance must not ignore near-face exit axes');
  assert.match(displayExitFn, /best=min\(best,max\(0\.0,tx\)\)/);
  assert.match(displayExitFn, /best=min\(best,max\(0\.0,ty\)\)/);
  assert.match(displayExitFn, /best=min\(best,max\(0\.0,tz\)\)/);

  const directExitStart = core.indexOf('fn directCellExitDistance(');
  const directExitFn = core.slice(directExitStart, core.indexOf('\n}\n', directExitStart) + 3);
  assert.doesNotMatch(directExitFn, /if\s*\(\s*t[xyz]\s*>\s*(?:1e-4|0\.0001)\s*\)/, 'directCellExitDistance must not ignore near-face exit axes');
  assert.match(directExitFn, /best = min\(best, max\(0\.0, tx\)\);/);

  // Numerical witness: a sample 5e-5 ray units from the -X face (q.x = 1.00001, dqdt.x = -200,
  // dqdt.y = 10, dqdt.z = 10) must exit at tx = 5e-5, not overshoot to ty/tz = 0.05 or cap 0.20.
  const q = { x: 1.00001, y: 1.5, z: 1.5 };
  const dqdt = { x: -200.0, y: 10.0, z: 10.0 };
  let bestFixed = 1.0e6;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dqdt[axis]) > 0.0001) {
      const b = dqdt[axis] > 0.0 ? Math.floor(q[axis]) + 1.0 : Math.floor(q[axis]);
      const tAxis = (b - q[axis]) / dqdt[axis];
      bestFixed = Math.min(bestFixed, Math.max(0.0, tAxis));
    }
  }
  const exitFixed = Math.min(bestFixed, 0.20);
  assert.ok(exitFixed > 0 && exitFixed <= 1e-4, `expected near-face exit <= 1e-4, got ${exitFixed}`);
});

test('worldPointSupportAndStep reuses cached leaf bounds from worldResidentMaterial without a second octree traversal', () => {
  assert.match(WORLD_RENDER_WGSL, /var<private>\s+lastWorldLeafNode:\s*vec4<f32>;/);
  assert.match(WORLD_RENDER_WGSL, /var<private>\s+lastWorldLeafBounds:\s*vec4<f32>;/);
  const supportFn = WORLD_SMOKE_OPTICS_WGSL.slice(
    WORLD_SMOKE_OPTICS_WGSL.indexOf('fn worldPointSupportAndStep('),
    WORLD_SMOKE_OPTICS_WGSL.indexOf('fn worldSmokeBlend('),
  );
  assert.doesNotMatch(supportFn, /worldResidentLeafBounds\(/, 'worldPointSupportAndStep must not walk the octree a second time');
  assert.match(supportFn, /let n=lastWorldLeafNode;let leafBounds=lastWorldLeafBounds;/);
  assert.match(
    core,
    /let emptyBrickSkip=!guided&&!opticalStepping&&brickExit>0\.0&&sigma\+length\(medium\.emission\)<=1e-4&&u\.occupancy_controls\.x>1e-4;\s*if\(!emptyBrickSkip\)\{rayMaterialSamples \+= 1u;\}/,
    'empty outer-World leaf brick skips do not inflate rayMaterialSamples',
  );
});
