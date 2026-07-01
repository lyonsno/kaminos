import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packageJsonPath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');
const witnessPath = join(root, 'pipeline-witness.mjs');
const wrapperPath = join(root, 'scripts', 'run-sharp-webgpu-adapter.mjs');

assert.ok(existsSync(packageJsonPath), 'Kaminos pipeline tooling must declare npm dependencies');
assert.ok(existsSync(packageLockPath), 'Kaminos pipeline tooling must lock npm dependency versions');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
assert.equal(
  packageJson.dependencies?.['@kaminos/webgpu-inference-kit'],
  '^0.1.1',
  'Pipeline scheduler evidence must use the runtime WebGPU inference kit package',
);

const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
const lockedKit = packageLock.packages?.['node_modules/@kaminos/webgpu-inference-kit'];
assert.equal(lockedKit?.version, '0.1.1', 'WebGPU inference kit lockfile must pin the adopted package version');
assert.equal(
  lockedKit?.integrity,
  'sha512-OQ6Jxqb22RKuxKsa7BVz6LM7HWu0tXDteEc+6tZX/7t907PnZngGC8UNpbItM9HHb4xac6T9FpYF+mcHaFtSQg==',
  'WebGPU inference kit lockfile must preserve the published package integrity Cranial handed off',
);

for (const sourcePath of [witnessPath, wrapperPath]) {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /from ['"]@kaminos\/webgpu-inference-kit['"]/,
    `${sourcePath} must import scheduler/backpressure validators from the shared WebGPU kit`,
  );
  assert.match(
    source,
    /validateWebGpuRouteSchedulerProfile/,
    `${sourcePath} must validate the nested scheduler profile through the shared WebGPU kit`,
  );
  assert.match(
    source,
    /validateWebGpuRouteBackpressureProfile/,
    `${sourcePath} must validate the nested backpressure profile through the shared WebGPU kit`,
  );
  assert.doesNotMatch(
    source,
    /schema:\s*['"]kaminos\.webgpu-route-scheduler\.v0['"],\s*requestedScheduler:\s*breathingRoom/s,
    `${sourcePath} must not hand-build the canonical scheduler profile from breathing-room telemetry`,
  );
}
