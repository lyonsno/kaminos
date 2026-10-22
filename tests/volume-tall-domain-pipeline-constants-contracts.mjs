import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The volume shader indexes fluid cells as x + y*GRID + z*GRID*GRID_Y over the
// tall domain. GRID_Y used to be a pipeline-overridable constant, and any
// pipeline that passed GRID without GRID_Y silently indexed the wrong rows.
// Since grid dimensions became runtime values (Noah 2026-10-12) every entry
// point seats GRID and GRID_Y together from its uniforms and no pipeline
// carries a shape constant, so that failure cannot recur.
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.ok(!/override GRID_Y: u32/.test(source), 'no tall-domain height override remains');
assert.match(source, /  GRID = u32\(u\.grid_shape\.x\);\n  GRID_Y = u32\(u\.grid_shape\.y\);/, 'GRID and GRID_Y are seated together');
const constantObjects = [...source.matchAll(/(?:constants\s*:\s*|Constants\s*=\s*)\{([^{}]*)\}/g)]
  .map(match => ({ body: match[1], line: source.slice(0, match.index).split('\n').length }))
  .filter(({ body }) => /(^|[\s,{])GRID(_Y)?\s*:/.test(body));
assert.deepEqual(constantObjects, [], 'no pipeline constant object carries a grid shape');
const irradiance = source.slice(source.indexOf('function ensureFireIrradianceResources'));
assert.match(irradiance.slice(0, irradiance.indexOf('irradianceSeedPipeline = device.createComputePipeline')),
  /irradiancePipelineConstants = \{\};/, 'fire irradiance pipelines carry no shape constant');

// Raymarch merge resolution: main's tall box and full-grid span together with
// the kiln branch's scene-depth clipping and preserved sample positions.
const multiplier = Number(source.match(/const VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER = (\d+);/)?.[1]);
assert.equal(multiplier, 2, 'tall domain is 1x2x1');
const raymarch = source.slice(source.indexOf('fn raymarchVolume(in: VSOut,'));
for (const [expression, meaning] of [
  ['let domainHalfY = f32(GRID_Y) / f32(GRID);', 'the raymarch box half-height follows the grid shape (grid height control)'],
  ['let hit = boxHit(ro - vec3<f32>(0.0, domainHalfY - 1.0, 0.0), rd, vec3<f32>(1.0, domainHalfY, 1.0));', 'raymarch box spans world y [-1, -1 + 2 GRID_Y/GRID] (y [-1, 3] at the auto height)'],
  ['if (!fullGridCapture && min(hit.y, sceneDepthEndT) <= max(hit.x, sceneDepthStartT)) {', 'scene depth in front of the box is a miss'],
  ['let endT = select(min(hit.y, sceneDepthEndT), 2.0 * domainHalfY, fullGridCapture);', 'full-grid capture spans the tall box (4.0 at the auto height)'],
  ['let dtBase = (select(endT, select(hit.y, 2.0 * domainHalfY, fullGridCapture), preserveSamplePositions) - startT) / steps;',
    'depth clipping keeps ordinary sample positions stable'],
]) {
  assert.ok(raymarch.includes(expression), `raymarch resolution lost: ${meaning}`);
}

// The fire light field publishes the coverage it actually has inside the tall box.
const lightField = source.slice(source.indexOf('function fireIrradianceLightField()'));
// Since the grid height control (report §34) the bounds come from the raymarch
// domain box the camera samples, which spans y [-1, -1 + 2 gridHeight/gridSize].
assert.match(lightField, /const domainBox = raymarchDomainBox\(gridSize, gridHeight\);/, 'light-field bounds derive from the raymarch domain box');
assert.match(lightField, /worldMax: domainBox\.max\.map\(\(value, axis\) => value \* productTransform\.scale \+ productTransform\.translate\[axis\]\),\s*worldBoundsAuthority: 'full-volume-domain-equal-cell-pitch-v1'/,
  'light-field bounds cover the full tall volume');
const { raymarchDomainBox } = await import('../volume-grid-shape.mjs');
assert.deepEqual(raymarchDomainBox(64, 128).max, [1, 3, 1], 'the auto box reaches y = 3');
console.log('volume tall-domain pipeline constants contracts passed');
