// kaminos-test: node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildSuperMatModule } from '../scripts/build-supermat-module.mjs';
import { preprocessForSuperMat } from '../models/supermat/supermat-preprocess.js';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'supermat-package-'));
const previous = { self: globalThis.self, Worker: globalThis.Worker, fetch: globalThis.fetch };
try {
  const output = path.join(scratch, 'artifacts');
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'keep.txt'), 'caller-owned output');
  if (process.argv.includes('--baseline')) {
    await buildSuperMatModule(output);
    assert.ok(await fs.stat(path.join(output, 'package.json')).catch(() => null),
      'standalone module build does not yet provide an installable model package');
  }
  const { packSuperMatModule } = await import('../scripts/pack-supermat-module.mjs');
  const packed = await packSuperMatModule({ out: output, version: '0.2.3' });
  assert.equal(packed.name, '@kaminos/supermat');
  assert.equal(packed.version, '0.2.3');
  assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'caller-owned output');
  const entries = execFileSync('tar', ['-tzf', packed.tarball], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(entries, ['GETTING_STARTED.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'package.json', 'supermat-cpu-worker.js', 'supermat-inference.js']
    .map(file => `package/${file}`).sort());

  const app = path.join(scratch, 'app');
  await fs.mkdir(app);
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', packed.tarball],
    { cwd: app, stdio: 'pipe' });
  const require = createRequire(path.join(app, 'package.json'));
  const entry = require.resolve('@kaminos/supermat');
  const worker = require.resolve('@kaminos/supermat/worker');
  const manifest = require('@kaminos/supermat/package.json');
  assert.equal(manifest.private, true, 'publication remains a separate operator decision');
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(await fs.readFile(path.join(path.dirname(entry), 'LICENSE')),
    await fs.readFile(new URL('../models/supermat/LICENSE', import.meta.url)));
  assert.deepEqual(await fs.readFile(path.join(path.dirname(entry), 'THIRD_PARTY_NOTICES.txt')),
    await fs.readFile(new URL('../webgpu-inference-kit/THIRD_PARTY_NOTICES.txt', import.meta.url)));
  assert.equal(manifest.version, '0.2.3');
  assert.equal(manifest.dependencies, undefined, 'the exercised standalone artifacts are self-contained');
  assert.equal(path.dirname(entry), path.dirname(worker));
  const api = await import(pathToFileURL(entry).href);
  for (const key of ['createSuperMatAdapter', 'createWebGpuInferenceSession', 'requestBrowserWebGpuDevice']) {
    assert.equal(typeof api[key], 'function', `installed package exports ${key}`);
  }
  const reference = path.join(scratch, 'reference');
  await buildSuperMatModule(reference);
  for (const file of ['supermat-inference.js', 'supermat-cpu-worker.js']) {
    assert.deepEqual(await fs.readFile(path.join(path.dirname(entry), file)), await fs.readFile(path.join(reference, file)),
      'packaging must not alter the independently exercised runtime or worker');
  }
  const replies = [];
  globalThis.self = { postMessage: reply => replies.push(reply) };
  await import(pathToFileURL(worker).href);
  const image = { width: 2, height: 1, data: new Uint8Array([255, 64, 0, 255, 0, 128, 255, 80]) };
  self.onmessage({ data: { executionId: 'installed-app', operationId: 'supermat.preprocess',
    moduleId: 'supermat.cpu-phases.v0', payload: { width: 2, height: 1, size: 64, data: image.data.buffer } } });
  assert.equal(replies[0].status, 'completed');
  assert.deepEqual(new Float32Array(replies[0].output.planes), preprocessForSuperMat(image, 64));
  let requestedWorker;
  globalThis.Worker = class {
    constructor(url) { requestedWorker = url; throw new Error('installed worker URL observed'); }
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ schema: 'supermat.browser-weight-package.v0',
    status: 'succeeded', constants: { vScale: 1 }, resources: [] }));
  const adapter = await api.createSuperMatAdapter({
    route: { runtime: { device: { features: new Set() } }, loadModelResourcesFromSource() { assert.fail('no resources'); } },
    weightsUrl: 'https://example.invalid/weights/',
  });
  try {
    await assert.rejects(adapter.run({ image, size: 64 }), /installed worker URL observed/);
    assert.equal(await fs.realpath(requestedWorker), await fs.realpath(worker));
  } finally { adapter.release(); }
  console.log('SuperMat installed package, complete worker and unchanged runtime: PASS');
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  await fs.rm(scratch, { recursive: true, force: true });
}
