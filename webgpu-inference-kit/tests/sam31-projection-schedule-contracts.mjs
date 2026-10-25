// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import { createWebGpuInferenceControl } from '../src/inference-control.js';
if (!vm.SourceTextModule) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout); console.log(r.stdout.trim());
} else {
  let stages = 0, disposed = 0;
  const device = { queue: { async onSubmittedWorkDone() {} } };
  const context = vm.createContext({ console, Float32Array, Uint8Array, TextEncoder, crypto, performance });
  const projectionUrl = new URL('../src/sam31-decoder-high-resolution-projection-phase-program.js', import.meta.url);
  const projection = new vm.SourceTextModule(await readFile(projectionUrl, 'utf8'), { context, identifier: projectionUrl.href });
  async function synthetic(specifier, parent) {
    const url = new URL(specifier, parent.identifier), ns = { ...await import(url.href) };
    if (url.pathname.endsWith('/inference-runtime.js')) ns.createWebGpuInferenceRuntime = async input => ({
      ...input, runKernel: async () => {}, readTensor: async () => {},
      async runStage() { stages++; throw new Error('projection encoded without its schedule'); },
      dispose() { disposed++; return { disposed: true }; },
    });
    return new vm.SyntheticModule(Object.keys(ns), function () { for (const [k, v] of Object.entries(ns)) this.setExport(k, v); }, { context });
  }
  await projection.link(synthetic);
  const url = new URL('../src/sam31-two-image-backbone.js', import.meta.url);
  const backbone = new vm.SourceTextModule(await readFile(url, 'utf8') + '\nexport { runHighResolution };', { context, identifier: url.href });
  await backbone.link((specifier, parent) => specifier.endsWith('/sam31-decoder-high-resolution-projection-phase-program.js') ? projection : synthetic(specifier, parent));
  await backbone.evaluate();
  const roles = ['decoder-high-resolution-s0-weight', 'decoder-high-resolution-s0-bias', 'decoder-high-resolution-s1-weight', 'decoder-high-resolution-s1-bias'];
  const input = { branch: 'propagation', frameIndex: 1, invocationTag: 'frame:1', requestIds: [],
    manifest: { reference: { model: { revision: 'fixture' } }, sourceImages: { 1: { rgbaSha256: `sha256:${'a'.repeat(64)}` } },
      shape: { imageHeight: 14, imageWidth: 14, patchHeight: 1, patchWidth: 1, fpnLevels: [{ height: 4, width: 4 }, { height: 2, width: 2 }] } },
    weightsByRole: new Map(roles.map(role => [role, { sha256: `sha256:${'b'.repeat(64)}` }])),
    weights: { s0: { weight: new Float32Array(32 * 256), bias: new Float32Array(32) }, s1: { weight: new Float32Array(64 * 256), bias: new Float32Array(64) } },
    neck: { features: [new Float32Array(4 * 4 * 256), new Float32Array(2 * 2 * 256)], result: { receipt: { outputs: [0, 1].map(level => ({
      role: `sam31-propagation-feature-${level}`, artifactId: `feature:${level}`, sha256: `sha256:${'c'.repeat(64)}` })) } } },
    adapter: { info: {} }, device, update() {}, verificationAttached: false };
  const abort = new AbortController(); abort.abort('stopped');
  const control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal });
  const schedule = { control, runtime: { device, queue: device.queue, routeId: 'parent',
    prepareCommandDutyAtBoundary() {}, settleCommandDuty() {} }, invocation: { routeId: 'parent', invocationId: 'frame:1' } };
  await assert.rejects(backbone.namespace.runHighResolution({ ...input, schedule }), { name: 'AbortError' });
  assert.equal(stages, 0); assert.equal(disposed, 1);
  await control.close();
  await assert.rejects(backbone.namespace.runHighResolution(input), /projection encoded without its schedule/);
  assert.equal(stages, 1, 'unscheduled callers retain their original phase path');
  assert.equal(disposed, 2);
  console.log('Real high-resolution helper preserves stopped schedule into the actual projection phase (mock runtime)');
}
