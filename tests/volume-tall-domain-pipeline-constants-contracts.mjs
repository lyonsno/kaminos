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
console.log('volume tall-domain pipeline constants contracts passed');
