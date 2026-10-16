// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { preprocessForSuperMat } from '../models/supermat/supermat-preprocess.js';

const out = await fs.mkdtemp(path.join(os.tmpdir(), 'supermat-module-'));
const root = path.resolve(import.meta.dirname, '..');
const previousSelf = globalThis.self;
const previousWorker = globalThis.Worker;
const previousFetch = globalThis.fetch;
try {
  if (process.argv.includes('--baseline')) {
    // Existing adapter bundled by itself: its worker URL points at an absent file.
    await build({ entryPoints: [path.join(root, 'models/supermat/supermat-route.js')],
      bundle: true, format: 'esm', platform: 'browser', target: 'esnext',
      outfile: path.join(out, 'supermat-inference.js') });
  } else {
    const { buildSuperMatModule } = await import('../scripts/build-supermat-module.mjs');
    await buildSuperMatModule(out);
  }
  const moduleUrl = pathToFileURL(path.join(out, 'supermat-inference.js'));
  const workerUrl = new URL('./supermat-cpu-worker.js', moduleUrl);
  assert.ok(existsSync(workerUrl), 'independent SuperMat module must ship its co-located CPU worker');
  const api = await import(moduleUrl.href);
  for (const name of ['createSuperMatAdapter', 'createWebGpuInferenceSession', 'requestBrowserWebGpuDevice', 'superMatDeviceOptions']) {
    assert.equal(typeof api[name], 'function', `${name} must be independently importable`);
  }
  assert.match(api.SUPERMAT_HOSTED_WEIGHTS_URL, /^https:\/\/huggingface.co\/.+\/resolve\/[a-f0-9]{40}\/f16\/$/);
  await assert.rejects(api.createSuperMatAdapter({ weightsUrl: api.SUPERMAT_HOSTED_WEIGHTS_URL }), /registered kit session route/);

  const replies = [];
  globalThis.self = { postMessage: reply => replies.push(reply) };
  await import(workerUrl.href);
  const image = { width: 2, height: 1, data: new Uint8Array([255, 64, 0, 255, 0, 128, 255, 80]) };
  self.onmessage({ data: { executionId: 'outside-app', operationId: 'supermat.preprocess',
    moduleId: 'supermat.cpu-phases.v0', payload: { width: 2, height: 1, size: 64, data: image.data.buffer } } });
  assert.equal(replies[0].status, 'completed');
  assert.equal(replies[0].executionId, 'outside-app');
  assert.equal(replies[0].moduleId, 'supermat.cpu-phases.v0');
  assert.equal(replies[0].output.alpha.byteLength, 64 * 64);
  assert.deepEqual(new Float32Array(replies[0].output.planes), preprocessForSuperMat(image, 64));
  self.onmessage({ data: { executionId: 'invalid-operation', operationId: 'not-supermat', moduleId: 'supermat.cpu-phases.v0' } });
  assert.equal(replies[1].status, 'failed');
  assert.match(replies[1].error.message, /unknown SuperMat CPU operation/);
  // Synthetic empty weights stop at worker construction: this verifies the
  // emitted adapter's actual URL, not model numerics or GPU conformance.
  let requestedWorker = null;
  globalThis.Worker = class {
    constructor(url) { requestedWorker = url.href; throw new Error('worker URL probe stops before GPU work'); }
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ schema: 'supermat.browser-weight-package.v0',
    status: 'succeeded', constants: { vScale: 1 }, resources: [] }));
  const adapter = await api.createSuperMatAdapter({
    route: { runtime: { device: { features: new Set() } }, loadModelResourcesFromSource() { assert.fail('no synthetic resources'); } },
    weightsUrl: 'https://example.invalid/weights/',
  });
  try {
    await assert.rejects(adapter.run({ image, size: 64 }), /worker URL probe stops before GPU work/);
    assert.ok(requestedWorker, 'adapter must request a worker');
    assert.equal(await fs.realpath(new URL(requestedWorker)), await fs.realpath(workerUrl),
      'emitted adapter must request the worker shipped beside it');
  } finally { adapter.release(); }
  console.log('SuperMat standalone adapter/helper imports and real worker preprocessing: PASS');
} finally {
  if (previousSelf === undefined) delete globalThis.self;
  else globalThis.self = previousSelf;
  if (previousWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = previousWorker;
  globalThis.fetch = previousFetch;
  await fs.rm(out, { recursive: true, force: true });
}
