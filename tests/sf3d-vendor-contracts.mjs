import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SF3D_PRODUCER_COMMIT} from '../sf3d-host-device.mjs';

// Observed library build from sf3d-webgpu public main 0ff8dc4, generated with
// vite.lib.config.js. This pins consumed code, not a live GPU parity claim.
const root = new URL('../lib/sf3d/', import.meta.url);
const bundle = readFileSync(new URL('sf3d-producer.js', root));
assert.equal(createHash('sha256').update(bundle).digest('hex'), 'd3d40d3c1b3f9901ecc4d56ae3201bffd30625eef426af14c65ab762d01fd1f6', 'consumer must use the landed producer build including worker tet-path repair');
assert.ok(readFileSync(new URL('BUILD.txt', root), 'utf8').includes(SF3D_PRODUCER_COMMIT));
const workers = [...bundle.toString().matchAll(/new URL\('assets\/([\w-]+\.js)'/g)].map(match => match[1]);
assert.equal(new Set(workers).size, 5);
for (const worker of workers) assert.ok(existsSync(new URL(`assets/${worker}`, root)), `missing bundled worker ${worker}`);
console.log('SF3D landed vendor identity and worker presence passed');
