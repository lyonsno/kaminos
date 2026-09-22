import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SF3D_PRODUCER_COMMIT} from '../sf3d-host-device.mjs';

// Observed library build from sf3d-webgpu candidate 740b609, generated with
// vite.lib.config.js. This pins consumed code, not a live GPU parity claim.
const root = new URL('../lib/sf3d/', import.meta.url);
const bundle = readFileSync(new URL('sf3d-producer.js', root));
assert.equal(createHash('sha256').update(bundle).digest('hex'), '9157b9ebeee3455788fe82579c9d27719fb3cf7c0024acf72ecb69a78a329349', 'consumer must use the reviewed foreground-service producer candidate');
assert.ok(readFileSync(new URL('BUILD.txt', root), 'utf8').includes(SF3D_PRODUCER_COMMIT));
const workers = [...bundle.toString().matchAll(/new URL\('assets\/([\w-]+\.js)'/g)].map(match => match[1]);
assert.equal(new Set(workers).size, 5);
for (const worker of workers) assert.ok(existsSync(new URL(`assets/${worker}`, root)), `missing bundled worker ${worker}`);
console.log('SF3D landed vendor identity and worker presence passed');
