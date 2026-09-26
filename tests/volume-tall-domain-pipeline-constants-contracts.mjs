import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The volume shader indexes fluid cells as x + y*GRID + z*GRID*GRID_Y over the
// tall 1x2x1 domain. GRID_Y is a pipeline-overridable constant with a fixed
// default, so any pipeline that passes GRID without GRID_Y silently indexes the
// wrong rows at every grid size except the default. Pipelines composed in from
// older cubic-domain branches (fire irradiance light field, MSAA scene-depth
// clipping) must carry it too.
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(source, /override GRID_Y: u32/, 'volume shader declares the tall-domain height override');

const constantObjects = [...source.matchAll(/(?:constants\s*:\s*|Constants\s*=\s*)\{([^{}]*)\}/g)]
  .map(match => ({ body: match[1], line: source.slice(0, match.index).split('\n').length }))
  .filter(({ body }) => /(^|[\s,{])GRID\s*:/.test(body));
assert.ok(constantObjects.length >= 5, `found ${constantObjects.length} GRID pipeline constant objects`);
for (const { body, line } of constantObjects) {
  assert.match(body, /GRID_Y\s*:\s*gridHeight/, `volume-core.js:${line} passes GRID without GRID_Y`);
}

const irradiance = source.slice(source.indexOf('function ensureFireIrradianceResources'));
assert.match(irradiance.slice(0, irradiance.indexOf('irradianceSeedPipeline = device.createComputePipeline')),
  /irradiancePipelineConstants = \{[^}]*GRID_Y: gridHeight/, 'fire irradiance seed reads the tall fluid grid');

// Raymarch merge resolution: main's tall box and full-grid span together with
// the kiln branch's scene-depth clipping and preserved sample positions.
const multiplier = Number(source.match(/const VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER = (\d+);/)?.[1]);
assert.equal(multiplier, 2, 'tall domain is 1x2x1');
const raymarch = source.slice(source.indexOf('fn raymarchVolume(in: VSOut, sceneDepthEndT: f32, preserveSamplePositions: bool)'));
for (const [expression, meaning] of [
  ['let hit = boxHit(ro - vec3<f32>(0.0, 1.0, 0.0), rd, vec3<f32>(1.0, 2.0, 1.0));', 'raymarch box spans world y [-1, 3]'],
  ['if (!fullGridCapture && min(hit.y, sceneDepthEndT) <= max(hit.x, 0.0)) {', 'scene depth in front of the box is a miss'],
  ['let endT = select(min(hit.y, sceneDepthEndT), 4.0, fullGridCapture);', 'full-grid capture spans the tall box'],
  ['let dtBase = (select(endT, select(hit.y, 4.0, fullGridCapture), preserveSamplePositions) - startT) / steps;',
    'depth clipping keeps ordinary sample positions stable'],
]) {
  assert.ok(raymarch.includes(expression), `raymarch resolution lost: ${meaning}`);
}

// The fire light field publishes the coverage it actually has inside the tall box.
const lightField = source.slice(source.indexOf('function fireIrradianceLightField()'));
assert.match(lightField, /worldMax: \[1, -1 \+ 2 \* gridHeight \/ gridSize, 1\],\s*worldBoundsAuthority: 'full-volume-domain-equal-cell-pitch-v1'/,
  'light-field bounds cover the full tall volume');
console.log('volume tall-domain pipeline constants contracts passed');
