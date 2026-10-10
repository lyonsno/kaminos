import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayEmissiveRGB, EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';
import { displayAgXRGB, agxLinearRGB } from '../volume-agx.mjs';

assert.deepEqual(displayEmissiveRGB([4, .2, .01], 0, .2),
  displayEmissiveRGB([4, .2, .01], 0, .9),
  'default AgX display must not depend on the old highlight knee');
const camera = EMISSIVE_TRANSPORT_WGSL.split('fn emissiveCamera(')[1].split('const LIGHT_GRID')[0];
assert.match(camera, /agxDisplay/, 'the actual volume camera must consume AgX');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const control = schema.rendererControls.find(c => c.key === 'volume-tone-mapping');
assert.equal(control?.additiveDefault, 'agx', 'missing saved display choice defaults to AgX');
assert.deepEqual(control.allowedValues, ['agx', 'custom']);
assert.deepEqual(displayAgXRGB([0,0,0]), [0,0,0]);
for (const rgb of [[-2,0,0], [.18,.18,.18], [1,0,0], [0,10,0], [0,0,100], [1e20,1e20,1e20]]) {
  assert.ok(displayAgXRGB(rgb).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
}
const rgb = [4,.2,.01];
assert.deepEqual(displayAgXRGB(rgb, 1), displayAgXRGB(rgb.map(v => v*2)));
assert.deepEqual(displayEmissiveRGB(rgb), displayAgXRGB(rgb));
assert.notDeepEqual(displayEmissiveRGB(rgb), displayEmissiveRGB(rgb,0,.6,undefined,'custom'));
assert.ok(agxLinearRGB([.18,.18,.18]).every(v => v > .2 && v < .3));
console.log('AgX default, knee independence, production camera and persistence pass');
