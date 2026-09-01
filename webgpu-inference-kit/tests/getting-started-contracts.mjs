import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import { createMinimalWebGpuTestSurface } from './fixtures/minimal-webgpu-test-device.mjs';

const packageRoot = new URL('../', import.meta.url);
const guideUrl = new URL('docs/getting-started.md', packageRoot);
const exampleUrl = new URL('examples/minimal-model-port.mjs', packageRoot);
const runnerUrl = new URL('examples/minimal-model-port-runner.mjs', packageRoot);

await Promise.all([access(guideUrl), access(exampleUrl), access(runnerUrl)]);

const [guide, runner, packageJson, example] = await Promise.all([
  readFile(guideUrl, 'utf8'),
  readFile(runnerUrl, 'utf8'),
  readFile(new URL('package.json', packageRoot), 'utf8').then(JSON.parse),
  import(exampleUrl),
]);

assert.equal(packageJson.version, '0.1.47');
assert.ok(packageJson.files.includes('examples'));
assert.equal(
  packageJson.exports['./examples/minimal-model-port'],
  './examples/minimal-model-port.mjs',
);
assert.equal(typeof example.createMinimalModelAdapter, 'function');
assert.equal(typeof example.runMinimalModelPort, 'function');

const runnerBlock = guide.match(
  /<!-- exact-source: examples\/minimal-model-port-runner\.mjs -->\s*```js\n([\s\S]*?)\n```/,
);
assert.ok(runnerBlock, 'the guide must embed the exact runnable browser entrypoint');
assert.equal(`${runnerBlock[1]}\n`, runner, 'the guide runner must not drift from the executable file');
assert.match(guide, /npm install @kaminos\/webgpu-inference-kit/);
assert.match(guide, /navigator\.gpu/);
assert.match(guide, /two queued invocations/i);
assert.match(guide, /complete output/i);

const surface = createMinimalWebGpuTestSurface();
const report = await example.runMinimalModelPort({
  gpu: surface.gpu,
  sessionId: 'getting-started-source-test',
  jobIds: ['first', 'second'],
  inputs: [
    [0, 1, 2, 3],
    [-1, 4, 0.5, 10],
  ],
});

assert.equal(report.schema, 'kaminos.webgpu-inference-kit.getting-started.v0');
assert.equal(report.status, 'succeeded');
assert.equal(report.session.status, 'closed');
assert.equal(
  report.session.backendIdentity.adapterName,
  'Kaminos deterministic test adapter',
  'the example must preserve source-observed adapter identity',
);
assert.equal(report.routeId, 'example.affine-f32.webgpu-local.v0');
assert.deepEqual(report.outputs, [
  [1, 3, 5, 7],
  [-1, 9, 2, 21],
]);
assert.deepEqual(report.completions.map(row => row.jobId), ['first', 'second']);
assert.ok(report.completions.every(row => row.status === 'succeeded'));
const expectedProgress = [
  { sequence: 1, phase: 'input-upload', completed: 1, total: 3 },
  { sequence: 2, phase: 'gpu-dispatch', completed: 2, total: 3 },
  { sequence: 3, phase: 'output-readback', completed: 3, total: 3 },
];
for (const completion of report.completions) {
  assert.deepEqual(
    completion.progress.map(({ sequence, value }) => ({ sequence, ...value })),
    expectedProgress,
    'progress must preserve the documented ordered semantic contract',
  );
}
assert.equal(surface.calls.computePipelineCreations, 1, 'the model pipeline must be route-reused');
assert.deepEqual(surface.calls.dispatches, [[1, 1, 1], [1, 1, 1]]);
assert.equal(surface.calls.submissions, 4, 'each invocation submits one compute and one readback copy');
assert.ok(surface.calls.bufferDestructions.includes('getting-started.input'));
assert.ok(surface.calls.bufferDestructions.includes('getting-started.output'));

const fixtureDevice = await (await surface.gpu.requestAdapter()).requestDevice();
assert.throws(
  () => fixtureDevice.createShaderModule({
    label: 'getting-started.affine-f32',
    code: '@compute @workgroup_size(4) fn main() {}',
  }),
  /deterministic affine fixture rejected unexpected shader source/,
  'the deterministic fixture must not manufacture affine output for unrelated WGSL',
);

for (const role of ['input', 'output']) {
  const missingStorageSurface = createMinimalWebGpuTestSurface({
    omitStorageUsageFor: role,
  });
  await assert.rejects(
    example.runMinimalModelPort({
      gpu: missingStorageSurface.gpu,
      sessionId: `getting-started-missing-${role}-storage`,
    }),
    /deterministic affine fixture rejected unexpected .* buffer usage/,
    `the deterministic fixture must reject a ${role} buffer without STORAGE usage`,
  );

  const substitutedBufferSurface = createMinimalWebGpuTestSurface({
    substituteBoundBufferFor: role,
  });
  await assert.rejects(
    example.runMinimalModelPort({
      gpu: substitutedBufferSurface.gpu,
      sessionId: `getting-started-substituted-${role}-buffer`,
    }),
    /deterministic affine fixture rejected unexpected .* buffer identity/,
    `the deterministic fixture must reject a same-labeled substitute ${role} buffer`,
  );
}

const failingSurface = createMinimalWebGpuTestSurface({ failSubmissionAt: 1 });
let injectedFailure;
try {
  await example.runMinimalModelPort({
    gpu: failingSurface.gpu,
    sessionId: 'getting-started-failure-test',
    jobIds: ['failing-first', 'drained-second'],
  });
} catch (error) {
  injectedFailure = error;
}
assert.ok(injectedFailure, 'the injected queue-submission failure must reject the example');
assert.match(injectedFailure.message, /deterministic queue submission failure/);
assert.equal(injectedFailure.completion?.jobId, 'failing-first');
assert.equal(injectedFailure.completion?.status, 'failed');
assert.deepEqual(
  injectedFailure.completion?.progress.map(({ sequence, value }) => ({ sequence, ...value })),
  [{ sequence: 1, phase: 'input-upload', completed: 1, total: 3 }],
  'failed submission must not fabricate dispatch or readback progress',
);
assert.equal(injectedFailure.sessionSnapshot?.status, 'closed');
assert.equal(injectedFailure.sessionSnapshot?.coordinator?.status, 'idle');
assert.equal(injectedFailure.sessionSnapshot?.coordinator?.pendingAdmissionCount, 0);
assert.deepEqual(injectedFailure.sessionSnapshot?.routes, []);
assert.equal(injectedFailure.sessionSnapshot?.residency?.totalResidentDeclaredBytes, 0);
assert.deepEqual(injectedFailure.sessionSnapshot?.residency?.routes, []);
assert.equal(
  failingSurface.calls.bufferDestructions.filter(label => label === 'getting-started.input').length,
  1,
  'failed execution must destroy the model input exactly once',
);
assert.equal(
  failingSurface.calls.bufferDestructions.filter(label => label === 'getting-started.output').length,
  1,
  'failed execution must destroy the model output exactly once',
);
assert.equal(failingSurface.calls.deviceDestructions, 1, 'the owned device must close exactly once');

console.log('getting started contracts passed');
