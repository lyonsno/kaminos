import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../serve.py', import.meta.url), 'utf8');

assert.match(server, /KAMINOS_SMOKE_ORACLE_DIR/, 'server exposes an explicit smoke-oracle image root');
assert.match(server, /"smoke-oracle"\s*:\s*KAMINOS_SMOKE_ORACLE_DIR/, 'smoke-oracle root is registered with the read API');

assert.match(index, /id="kaminos-image-witness"/, 'Kaminos owns a first-class image witness surface');
assert.match(index, /function initKaminosImageWitnessRoute\(/, 'image witness has an explicit route initializer');
assert.match(index, /kaminos_image_witness/, 'image witness is selected by an explicit route parameter');
assert.match(index, /image_root/, 'image witness records the requested browse root');
assert.match(index, /image_path/, 'image witness records the requested source path');
assert.match(index, /window\.__kaminosImageWitnessState/, 'image witness publishes registration state for browser witnesses');
assert.match(index, /requestedRoute/, 'image witness distinguishes requested route identity');
assert.match(index, /effectiveRoute/, 'image witness records effective route identity');
assert.match(index, /registered:\s*false/, 'image witness begins unregistered rather than implying success');
assert.match(index, /naturalWidth/, 'image registration requires a decoded image with dimensions');
assert.match(index, /nonblankPixelCount/, 'image witness checks pixel content instead of accepting a blank image');
assert.match(index, /status:\s*'failed'/, 'image witness fails loud when loading or pixel inspection fails');
assert.match(index, /image_authority/, 'operator route carries source authority explicitly');
assert.match(index, /image_downgrade/, 'operator route carries evidentiary downgrade explicitly');

console.log('Kaminos image witness route contracts passed');
