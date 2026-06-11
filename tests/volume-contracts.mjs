import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="volume"/, 'sidebar exposes a Volume tab');
assert.match(index, /id="tab-volume"/, 'Volume tab content is present');
assert.match(index, /kaminos_volume_smoke/, 'URL route gate names the volume smoke prototype');
assert.match(index, /volume-core\.js/, 'index imports the volume prototype module');
assert.match(index, /initKaminosVolumeRoute/, 'index initializes the volume route explicitly');

const corePath = join(root, 'volume-core.js');
assert.ok(existsSync(corePath), 'volume-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';
assert.match(core, /export function createKaminosVolumePrototype/, 'volume module exports createKaminosVolumePrototype');
assert.match(core, /kaminos-volume-prototype-v0/, 'volume module exposes stable witness identity');
assert.match(core, /native-3d-procedural-raymarch-v0/, 'volume module records native 3D procedural raymarch route identity');

const witnessPath = join(root, 'volume-witness.mjs');
assert.ok(existsSync(witnessPath), 'volume-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_volume_smoke=1/, 'witness captures the explicit volume route');
assert.match(witness, /effectiveRoute/, 'witness records effective route identity');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
