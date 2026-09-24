import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const initStart = source.indexOf('async function initScene()');
const initEnd = source.indexOf('  renderer = new THREE.WebGPURenderer', initStart);
assert.ok(initStart >= 0 && initEnd > initStart, 'host bootstrap is present');
const bootstrap = source.slice(initStart, initEnd);
const importAt = bootstrap.indexOf('compositionModule = await importCompositionModule');
const acquireAt = bootstrap.indexOf('requestKaminosSharedWebGpuDevice({');
assert.ok(importAt >= 0 && acquireAt > importAt, 'composition requirements load before shared device acquisition');
assert.match(bootstrap, /if \(compositionModule \|\| samHostConfig\?\.mounted\) \{[\s\S]*?requestKaminosSharedWebGpuDevice/,
  'ordinary scenes retain the existing independent-device path');
assert.match(bootstrap, /compositionModule\?\.sharedGpuBufferRequirements !== undefined/,
  'declared composition requirements make device admission strict, including malformed declarations');
assert.match(bootstrap, /if \(strictSharedDevice\)[\s\S]*?compositionSetupError = error;[\s\S]*?throw error;/,
  'strict acquisition failure cannot fall back to an independent device');

const volumeInit = source.slice(source.indexOf('async function initKaminosVolumeRoute()'));
const guardAt = volumeInit.indexOf('if (compositionSetupError) throw compositionSetupError;');
const prototypeAt = volumeInit.indexOf('volumePrototype = createKaminosVolumePrototype({');
assert.ok(guardAt >= 0 && guardAt < prototypeAt, 'scene recovery cannot create Pyro after a strict bootstrap failure');
assert.match(volumeInit, /sharedGpuContext: sharedGpu/,
  'Pyro receives the exact host device context');
const mountAt = volumeInit.indexOf('compositionModule.mountComposition({');
assert.ok(mountAt > prototypeAt, 'composition mounts only after the volume prototype exists');
assert.match(volumeInit.slice(mountAt, mountAt + 300), /sharedGpu,/,
  'composition receives the same host device context');

console.log('shared-device composition bootstrap contracts passed');
