import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const producer = core.slice(core.indexOf('// Fire irradiance light field:'), core.indexOf('fn csTransportPredict'));
const resources = core.slice(core.indexOf('function ensureFireIrradianceResources'), core.indexOf('function encodeFireIrradianceLightField'));
const field = core.slice(core.indexOf('function fireIrradianceLightField()'));
const receiver = page.slice(page.indexOf('function createFireLightFieldReceiverPass'), page.indexOf('function createFireLightFieldReceiverPass') + 16000);

assert.match(producer, /IRRADIANCE_GRID_Y/);
assert.match(producer, /gid\.y\s*>=\s*IRRADIANCE_GRID_Y/);
for (const expression of ['brickStart', 'brickEnd']) {
  const brick = producer.match(new RegExp(`let ${expression} = [^\\n]+`))?.[0];
  assert.ok(brick, `WGSL ${expression} expression exists`);
  assert.match(brick, /vec3<f32>\(f32\(GRID\), f32\(GRID_Y\), f32\(GRID\)\)/,
    `WGSL ${expression} dimensions convert unsigned grid constants to floats explicitly`);
  assert.match(brick, /vec3<f32>\(f32\(IRRADIANCE_GRID\), f32\(IRRADIANCE_GRID_Y\), f32\(IRRADIANCE_GRID\)\)/,
    `WGSL ${expression} divisors convert unsigned light-grid constants to floats explicitly`);
}
assert.match(field, /worldMax:\s*\[1, -1 \+ 2 \* gridHeight \/ gridSize, 1\]/);
assert.match(field, /gridY:\s*irradianceGridSize\s*\*\s*VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER/);
assert.match(resources, /const atlasWidth = irradianceGridSize \* FIRE_IRRADIANCE_ATLAS_TILES_X;/);
assert.match(resources, /const atlasHeight = irradianceGridHeight \* atlasTilesY;/);
assert.match(resources, /size:\s*\{\s*width: atlasWidth,\s*height: atlasHeight,/,
  'allocated atlas uses the named dimensions');
assert.match(resources, /state\.fireLightFieldBytes = latticeBytes \* 2\s*\+ atlasWidth \* atlasHeight \* 8;/,
  'atlas allocation telemetry includes the full rectangular texture height');
assert.match(receiver, /atlasGridY/);
assert.match(receiver, /fieldWorldMin/);
assert.doesNotMatch(receiver, /fireCenterWorld\s*=\s*metaCore\.xyz\.mul\(2\.0\)\.sub\(vec3\(1\.0\)\)/);

// Independent deterministic address oracle for the rectangular producer and
// atlas. It exercises every voxel and checks the source formulas used to map
// those oracle addresses back to the WGSL buffer/texture layout.
assert.match(producer, /return cell\.x \+ cell\.y \* IRRADIANCE_GRID \+ cell\.z \* IRRADIANCE_GRID \* IRRADIANCE_GRID_Y;/,
  'linear Z stride includes the rectangular Y dimension');
assert.match(producer, /let tileY = gid\.y \/ IRRADIANCE_GRID_Y;/,
  'atlas row selects a rectangular tile by its full Y extent');
assert.match(producer, /gid\.y % IRRADIANCE_GRID_Y/,
  'atlas row maps back to the Y cell within a rectangular tile');
assert.match(receiver, /uvw\.y\.mul\(atlasGridY\)/,
  'receiver samples the rectangular tile height');
assert.match(receiver, /tileY\.mul\(atlasGridY\)/,
  'receiver offsets atlas rows by the rectangular tile height');
for (const grid of [32, 48]) {
  const ny = grid * 2;
  const tilesX = 8;
  const tilesY = Math.ceil(grid / tilesX);
  const seenLinear = new Set();
  const seenAtlas = new Set();
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const linear = x + y * grid + z * grid * ny;
        const atlasX = (z % tilesX) * grid + x;
        const atlasY = Math.floor(z / tilesX) * ny + y;
        assert.ok(linear >= 0 && linear < grid * ny * grid);
        assert.ok(atlasX >= 0 && atlasX < grid * tilesX);
        assert.ok(atlasY >= 0 && atlasY < ny * tilesY);
        seenLinear.add(linear);
        seenAtlas.add(`${atlasX},${atlasY}`);
      }
    }
  }
  assert.equal(seenLinear.size, grid * ny * grid, `${grid}x${ny}x${grid} linear indices are unique`);
  assert.equal(seenAtlas.size, grid * ny * grid, `${grid}x${ny}x${grid} atlas addresses are unique`);
}
console.log('fire light field tall-domain contracts passed');
