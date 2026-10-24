// kaminos-test: node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
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
  assert.deepEqual(entries, ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'package.json', 'supermat-cpu-worker.js', 'supermat-inference.js', 'examples/external-app/app.js', 'examples/external-app/index.html']
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
  const readme = await fs.readFile(path.join(path.dirname(entry), 'README.md'), 'utf8');
  assert.equal(readme, await fs.readFile(new URL('../models/supermat/GETTING_STARTED.md', import.meta.url), 'utf8'));
  const snippets = [...readme.matchAll(/^```js\n([\s\S]*?)^```/gm)].map(match => match[1]);
  assert.ok(snippets.length > 0, 'the installed README must contain an application example');
  for (const contents of snippets) {
    await build({ stdin: { contents, resolveDir: app, sourcefile: 'installed-readme.js' },
      bundle: true, format: 'esm', platform: 'browser', target: 'esnext', write: false });
  }
  const lifecycle = snippets.find(contents => contents.includes('export async function inferMaterials'));
  assert.ok(lifecycle, 'the installed README must supply its reusable inference example');
  const bundledEntry = path.join(app, 'src', 'main.js');
  await fs.mkdir(path.dirname(bundledEntry), { recursive: true });
  await fs.writeFile(bundledEntry, `${lifecycle}\nexport { createSuperMatAdapter } from '@kaminos/supermat';\n`);
  const bundledOutput = path.join(app, 'dist', 'main.js');
  const buildRecipes = [...readme.matchAll(/^```mjs\n([\s\S]*?)^```/gm)].map(match => match[1]);
  assert.equal(buildRecipes.length, 1, 'the installed README must supply one complete Node build recipe');
  const buildScript = path.join(app, 'build.mjs');
  await fs.writeFile(buildScript, buildRecipes[0]);
  const buildRequire = createRequire(import.meta.url);
  await fs.symlink(path.dirname(buildRequire.resolve('esbuild/package.json')),
    path.join(app, 'node_modules', 'esbuild'), 'dir');
  execFileSync(process.execPath, [buildScript], { cwd: app, stdio: 'pipe' });
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
  for (const key of ['createSuperMatAdapter', 'createSuperMatApp', 'decodeImageRgba', 'createWebGpuInferenceSession', 'requestBrowserWebGpuDevice']) {
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
  globalThis.fetch = async () => new Response(JSON.stringify({ schema: 'supermat.browser-weight-package.v0',
    status: 'succeeded', constants: { vScale: 1 }, resources: [] }));
  async function observeWorker(moduleApi) {
    let requestedWorker;
    globalThis.Worker = class {
      constructor(url) { requestedWorker = url; throw new Error('installed worker URL observed'); }
    };
    const adapter = await moduleApi.createSuperMatAdapter({
      route: { runtime: { device: { features: new Set() } }, loadModelResourcesFromSource() { assert.fail('no resources'); } },
      weightsUrl: 'https://example.invalid/weights/',
    });
    try {
      await assert.rejects(adapter.run({ image, size: 64 }), /installed worker URL observed/);
      assert.ok(requestedWorker, 'the adapter must actually request its worker');
      return requestedWorker;
    } finally { adapter.release(); }
  }
  assert.equal(await fs.realpath(await observeWorker(api)), await fs.realpath(worker));
  const bundledApi = await import(pathToFileURL(bundledOutput).href);
  async function assertDeliveredWorker() {
    const requested = await observeWorker(bundledApi);
    assert.deepEqual(await fs.readFile(requested), await fs.readFile(worker),
      'the emitted application must deliver its referenced package worker');
    return requested;
  }
  const bundledWorker = await assertDeliveredWorker();
  const heldWorker = new URL('./worker-held-for-negative.js', bundledWorker);
  await fs.rename(bundledWorker, heldWorker);
  try {
    await assert.rejects(assertDeliveredWorker(), { code: 'ENOENT' },
      'a successful app build with a missing worker must fail delivery conformance');
  } finally { await fs.rename(heldWorker, bundledWorker); }
  console.log('SuperMat installed package, complete worker and unchanged runtime: PASS');
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  await fs.rm(scratch, { recursive: true, force: true });
}
