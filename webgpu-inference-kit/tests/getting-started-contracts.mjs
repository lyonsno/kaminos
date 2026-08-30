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

assert.equal(packageJson.version, '0.1.45');
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
assert.equal(report.routeId, 'example.affine-f32.webgpu-local.v0');
assert.deepEqual(report.outputs, [
  [1, 3, 5, 7],
  [-1, 9, 2, 21],
]);
assert.deepEqual(report.completions.map(row => row.jobId), ['first', 'second']);
assert.ok(report.completions.every(row => row.status === 'succeeded'));
assert.ok(report.completions.every(row => row.progress.length === 3));
assert.equal(surface.calls.computePipelineCreations, 1, 'the model pipeline must be route-reused');
assert.equal(surface.calls.dispatches.length, 2);
assert.equal(surface.calls.submissions, 4, 'each invocation submits one compute and one readback copy');
assert.ok(surface.calls.bufferDestructions.includes('getting-started.input'));
assert.ok(surface.calls.bufferDestructions.includes('getting-started.output'));

console.log('getting started contracts passed');
