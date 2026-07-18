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
  '^0.1.26',
  'Pipeline scheduler evidence must consume the foreground opportunity WebGPU inference kit package range',
);

const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
const lockedKit = packageLock.packages?.['node_modules/@kaminos/webgpu-inference-kit'];
assert.equal(lockedKit?.version, '0.1.26', 'WebGPU inference kit lockfile must pin Cranial foreground opportunity package version');
assert.ok(lockedKit?.integrity, 'WebGPU inference kit lockfile must preserve published package integrity');

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
  assert.match(
    source,
    /breathability/,
    `${sourcePath} must preserve kit breathability metadata inside Pipeline scheduler evidence`,
  );
  assert.doesNotMatch(
    source,
    /schema:\s*['"]kaminos\.webgpu-route-scheduler\.v0['"],\s*requestedScheduler:\s*breathingRoom/s,
    `${sourcePath} must not hand-build the canonical scheduler profile from breathing-room telemetry`,
  );
}

const comparisonSource = readFileSync(join(root, 'lib', 'sharp-breathing-room-comparison.mjs'), 'utf8');
assert.match(
  comparisonSource,
  /validateSharpBreathingRoomComparisonEvidence/,
  'Pipeline SHARP breathing-room comparison builder must call the shared kit validator',
);

const validationShimSource = readFileSync(join(root, 'lib', 'sharp-breathing-room-validation.mjs'), 'utf8');
assert.match(
  validationShimSource,
  /from ['"]@kaminos\/webgpu-inference-kit['"]/,
  'Pipeline SHARP breathing-room validation shim must re-export the published package gate',
);

const wrapperSource = readFileSync(wrapperPath, 'utf8');
assert.match(
  wrapperSource,
  /window\.__sharpDebug\?\.lastRun/,
  'Pipeline SHARP adapter wrapper must capture the SHARP browser debug run record, not only legacy scheduler telemetry',
);
for (const field of ['schedulerApplication', 'commandDutyReport', 'hostPhaseReport', 'foregroundOpportunityReport']) {
  assert.match(
    wrapperSource,
    new RegExp(field),
    `Pipeline SHARP adapter wrapper must preserve ${field} from the live scheduler route report`,
  );
}
assert.match(
  wrapperSource,
  /liveSchedulerRuntime/,
  'Pipeline SHARP adapter report must expose live scheduler runtime evidence without hiding it inside raw inference data',
);
