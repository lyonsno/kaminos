import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparsePrefixAdapter } from './sparse-prefix.js';
import { createTrellisSparseBlockAdapter, SPARSE_BLOCK_ROUTE } from './sparse-block.js';
import { validatePrefixFixture, validateNativePrefixBackend, prefixAdapterName, comparePrefixTensor } from './sparse-prefix-witness-checks.js';
import { validateBlockFixture, compareBlockTensor } from './sparse-block-witness-checks.js';

const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
async function loadManifest(path, expectedSha) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`missing manifest ${path}`);
  const bytes = await response.arrayBuffer();
  if (await hash(bytes) !== expectedSha) throw new Error(`manifest changed ${path}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadTensors(base, manifest) {
  const tensors = {};
  for (const [name, descriptor] of Object.entries(manifest.tensors)) {
    if (!/^[\w.-]+$/.test(descriptor.file)) throw new Error(`unsafe tensor path ${name}`);
    const response = await fetch(`${base}/${descriptor.file}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`missing tensor ${name}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== descriptor.byteLength || descriptor.dtype !== 'float32' ||
        descriptor.byteLength !== descriptor.shape.reduce((a, b) => a * b, 4) || await hash(bytes) !== descriptor.sha256) throw new Error(`partial or changed ${name}`);
    tensors[name] = new Float32Array(bytes);
  }
  return tensors;
}

// Offline observer. The serving composition below never downloads expected
// outputs and never reads between prefix and block; only this observer does.
export async function runSparseBlockWitness(blockSha, prefixSha) {
  const report = { status: 'failed', phase: 'fixture', requestedRoute: SPARSE_BLOCK_ROUTE,
    blockFixtureSha256: blockSha, prefixFixtureSha256: prefixSha };
  const errors = [];
  let device, session, prefixAdapter, blockAdapter, errorScope = false;
  try {
    const prefixManifest = await loadManifest('/prefix-fixture/manifest.json', prefixSha);
    const blockManifest = await loadManifest('/fixture/manifest.json', blockSha);
    const prefixPlan = validatePrefixFixture(prefixManifest);
    const blockPlan = validateBlockFixture(blockManifest, prefixManifest, prefixSha);
    const prefixTensors = await loadTensors('/prefix-fixture', prefixManifest);
    const blockTensors = await loadTensors('/fixture', blockManifest);
    report.reference = { route: blockManifest.referenceRoute, effectiveBackend: blockManifest.effectiveBackend,
      source: blockManifest.source, checkpoint: blockManifest.checkpoint, conditioning: blockManifest.conditioning,
      fullModelExecutions: blockManifest.fullModelExecutions, blockExecutions: blockManifest.blockExecutions };
    report.phase = 'native-device';
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    report.backend = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      description: adapter.info.description, device: adapter.info.device, isFallbackAdapter: adapter.isFallbackAdapter };
    validateNativePrefixBackend(report.backend);
    device = await adapter.requestDevice();
    device.pushErrorScope('validation'); errorScope = true;
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    session = await createWebGpuInferenceSession({ sessionId: `sparse-block-${crypto.randomUUID()}`, adapter, device,
      adapterName: prefixAdapterName(adapter.info) });
    const route = await session.registerRoute({ routeId: SPARSE_BLOCK_ROUTE, runtimeOptions: {
      requiredStages: [...prefixPlan.stages, ...blockPlan.stages], kernel: { profile: 'trellis2-sparse-prefix-block-bf16-values-v0' } } });
    report.effectiveRoute = route.routeId;
    if (report.effectiveRoute !== report.requestedRoute) throw new Error('effective block route mismatch');
    prefixAdapter = createTrellisSparsePrefixAdapter({ route, config: prefixManifest.config, weights: prefixTensors });
    blockAdapter = createTrellisSparseBlockAdapter({ route, config: blockManifest.config, weights: blockTensors,
      inputs: prefixAdapter.outputs, conditioning: blockTensors.conditioning, phases: blockTensors.phases });
    report.phase = 'prefix-block-composition';
    const started = performance.now();
    const job = route.enqueue({ jobId: 'prefix-block0', execute: async invocation => {
      const producer = await prefixAdapter.run({ sample: prefixTensors.sample, timestep: prefixTensors.timestep[0] }, invocation);
      if (producer.projected !== prefixAdapter.outputs.projected || producer.modulation !== prefixAdapter.outputs.modulation) throw new Error('prefix tensor identity changed');
      const output = await blockAdapter.run(invocation);
      return { ...output, producer };
    } });
    const completion = await job.completion;
    if (completion.status !== 'succeeded') throw new Error(`block job ${completion.status}: ${completion.error?.message || ''}`);
    report.hostSubmitMs = performance.now() - started;
    report.sessionId = session.snapshot().sessionId;
    report.composition = { sameSession: true, sameJob: true, readbackBetweenPrefixAndBlock: false, reusedResidentPrefixBuffers: true };
    report.phase = 'observation-readback';
    report.outputs = {};
    const observed = { projected: completion.output.producer.projected, modulation: completion.output.producer.modulation,
      ...Object.fromEntries(Object.keys(blockTensors).filter(name => name.startsWith('expected.')).map(name => {
        const key = name.slice(9), tensor = blockAdapter.diagnostics[key];
        if (!tensor) throw new Error(`missing block diagnostic ${key}`);
        return [key, tensor];
      })) };
    const observedAt = performance.now();
    for (const [name, tensor] of Object.entries(observed)) {
      const bytes = await route.runtime.readTensor(tensor), data = bytes instanceof Float32Array ? bytes : new Float32Array(bytes);
      const response = await fetch(`/output/${name}`, { method: 'POST', body: data });
      if (!response.ok) throw new Error(`could not preserve complete raw ${name}`);
      const isPrefix = name === 'projected' || name === 'modulation';
      report.outputs[name] = { shape: tensor.shape, dtype: tensor.dtype, sha256: await hash(data),
        comparison: isPrefix ? comparePrefixTensor(data, prefixTensors[`expected.${name}`]) : compareBlockTensor(data, blockTensors[`expected.${name}`]) };
    }
    report.completedWithReadbackMs = performance.now() - started;
    report.observerReadbackAndSaveMs = performance.now() - observedAt;
    const validation = await device.popErrorScope(); errorScope = false;
    if (validation) errors.push(validation.message);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!Object.values(report.outputs).every(row => row.comparison.passed)) throw new Error('whole-block numerical comparison failed');
    report.profile = route.runtime.finishProfile({ evidence: { mode: 'live', source: 'sparse-prefix-block0-exact-fixture' } });
    report.status = 'succeeded'; report.phase = null;
  } catch (error) { report.error = { message: error.message, stack: error.stack }; }
  finally {
    if (errorScope) { const validation = await device.popErrorScope(); if (validation) errors.push(validation.message); }
    report.errors = errors; blockAdapter?.dispose(); prefixAdapter?.dispose();
    if (session) { await session.drain(); session.close(); }
    device?.destroy();
  }
  return report;
}
