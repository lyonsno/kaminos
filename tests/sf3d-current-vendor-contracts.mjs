import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { SF3D_PRODUCER_COMMIT } from '../sf3d-host-device.mjs';

const root = new URL('../lib/sf3d/', import.meta.url);
const bundle = readFileSync(new URL('sf3d-producer.js', root));
assert.equal(createHash('sha256').update(bundle).digest('hex'),
  '9c2a57a3c3772482ce89592d19f1bd1dbd17e651763dea7f4bc32fb591463230',
  'current-main consumer pins the already-smoked landed 0.1.53 producer build');
assert.ok(bundle.toString().includes("WEBGPU_INFERENCE_KIT_VERSION = '0.1.53'"));
assert.ok(readFileSync(new URL('BUILD.txt', root), 'utf8').includes(SF3D_PRODUCER_COMMIT));
const workers = [...bundle.toString().matchAll(/new URL\('assets\/([\w-]+\.js)'/g)].map(match => match[1]);
assert.equal(new Set(workers).size, 5);
for (const worker of workers) assert.ok(existsSync(new URL(`assets/${worker}`, root)), `missing bundled worker ${worker}`);

console.log('current-main SF3D vendor identity and worker presence passed');
