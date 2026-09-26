import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const producer = core.slice(core.indexOf('// Fire irradiance light field:'), core.indexOf('fn csTransportPredict'));
const field = core.slice(core.indexOf('function fireIrradianceLightField()'));
const receiver = page.slice(page.indexOf('function createFireLightFieldReceiverPass'), page.indexOf('function createFireLightFieldReceiverPass') + 16000);

assert.match(producer, /IRRADIANCE_GRID_Y/);
assert.match(producer, /gid\.y\s*>=\s*IRRADIANCE_GRID_Y/);
assert.match(field, /worldMax:\s*\[1, -1 \+ 2 \* gridHeight \/ gridSize, 1\]/);
assert.match(field, /gridY:\s*irradianceGridSize\s*\*\s*VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER/);
assert.match(receiver, /atlasGridY/);
assert.match(receiver, /fieldWorldMin/);
assert.doesNotMatch(receiver, /fireCenterWorld\s*=\s*metaCore\.xyz\.mul\(2\.0\)\.sub\(vec3\(1\.0\)\)/);
console.log('fire light field tall-domain contracts passed');
