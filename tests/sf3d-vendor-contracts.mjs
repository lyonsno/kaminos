import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SF3D_PRODUCER_COMMIT} from '../sf3d-host-device.mjs';

// Observed library build from sf3d-webgpu feature8527c03, generated with
// vite.lib.config.js. This pins consumed code, not a live GPU parity claim.
const root = new URL('../lib/sf3d/', import.meta.url);
const bundle = readFileSync(new URL('sf3d-producer.js', root));
assert.equal(createHash('sha256').update(bundle).digest('hex'), '8caa0c1ac023f791d70602ae57b62f10d1ace4837772c7e256bb2e8d8a58e879', 'consumer must use the pinned compatible 0.1.53 producer build');
assert.ok(bundle.toString().includes("WEBGPU_INFERENCE_KIT_VERSION = '0.1.53'"));
assert.ok(readFileSync(new URL('BUILD.txt', root), 'utf8').includes(SF3D_PRODUCER_COMMIT));
const workers = [...bundle.toString().matchAll(/new URL\('assets\/([\w-]+\.js)'/g)].map(match => match[1]);
assert.equal(new Set(workers).size, 5);
for (const worker of workers) assert.ok(existsSync(new URL(`assets/${worker}`, root)), `missing bundled worker ${worker}`);
console.log('SF3D pinned vendor identity and worker presence passed');
