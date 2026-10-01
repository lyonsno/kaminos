import { createWebGpuInferenceSession, WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparsePrefixAdapter } from './sparse-prefix.js';
import { createTrellisSparseBlockAdapter, createTrellisSparseBlockWorkspace, SPARSE_BLOCK_ROUTE } from './sparse-block.js';
import { validatePrefixFixture, validateNativePrefixBackend, prefixAdapterName, comparePrefixTensor } from './sparse-prefix-witness-checks.js';
import { validateBlockFixture, validateBlockChainFixture, compareBlockTensor, BLOCK_OBSERVATIONS } from './sparse-block-witness-checks.js';

const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');

// Offline-only snapshot: queue-ordered GPU copy before the shared workspace is
// overwritten. The next block still consumes the original resident tensor.
export function createSparseBlockInputCapture(runtime, source) {
  if (source?.dtype !== 'f32' || !source.buffer || !(source.usage & U.copySrc) ||
      source.byteLength !== source.shape?.reduce((a, b) => a * b, 4)) throw new TypeError('complete copyable f32 block input required');
  const tensor = runtime.createTensor({ name: 'trellis.witness.block1.input', shape: [...source.shape],
    dtype: 'f32', usage: U.copySrc | U.copyDst });
  let captured = false, disposed = false;
  return { tensor, capture() {
    if (disposed) throw new Error('block input capture disposed');
    if (captured) throw new Error('block input already captured');
    const encoder = runtime.device.createCommandEncoder();
    encoder.copyBufferToBuffer(source.buffer, source.bufferOffset || 0, tensor.buffer, tensor.bufferOffset || 0, source.byteLength);
    runtime.queue.submit([encoder.finish()]); captured = true;
  }, dispose() { if (!disposed) { disposed = true; tensor.buffer.destroy(); } } };
}
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
export async function runSparseBlockWitness(blockSha, prefixSha, nextBlockSha) {
  const report = { status: 'failed', phase: 'fixture', requestedRoute: SPARSE_BLOCK_ROUTE,
    blockFixtureSha256: blockSha, prefixFixtureSha256: prefixSha, nextBlockFixtureSha256: nextBlockSha };
  const errors = [];
  let device, session, prefixAdapter, blockAdapter, nextAdapter, workspace, inputCapture, errorScope = false;
  try {
    const prefixManifest = await loadManifest('/prefix-fixture/manifest.json', prefixSha);
    const blockManifest = await loadManifest('/fixture/manifest.json', blockSha);
    const prefixPlan = validatePrefixFixture(prefixManifest);
    const blockPlan = validateBlockFixture(blockManifest, prefixManifest, prefixSha);
    const nextManifest = nextBlockSha ? await loadManifest('/next-block-fixture/manifest.json', nextBlockSha) : null;
    if (nextManifest) validateBlockChainFixture(nextManifest, blockManifest, prefixManifest, prefixSha, blockSha);
    const prefixTensors = await loadTensors('/prefix-fixture', prefixManifest);
    const blockTensors = await loadTensors('/fixture', blockManifest);
    const nextTensors = nextManifest ? await loadTensors('/next-block-fixture', nextManifest) : null;
    const observedManifest = nextManifest || blockManifest, observedTensors = nextTensors || blockTensors;
    report.reference = { route: observedManifest.referenceRoute, effectiveBackend: observedManifest.effectiveBackend,
      source: observedManifest.source, checkpoint: observedManifest.checkpoint, conditioning: observedManifest.conditioning,
      fullModelExecutions: observedManifest.fullModelExecutions, blockExecutions: observedManifest.blockExecutions,
      blockIndex: observedManifest.blockIndex ?? 0, inputBlock: observedManifest.inputBlock,
      comparisonClass: nextManifest ? 'canonical-chain; native incoming hidden differs from saved canonical hidden' : 'prefix-to-block0' };
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
    workspace = createTrellisSparseBlockWorkspace({ route, config: blockManifest.config,
      conditioning: blockTensors.conditioning, phases: blockTensors.phases });
    blockAdapter = createTrellisSparseBlockAdapter({ route, config: blockManifest.config, weights: blockTensors,
      inputs: prefixAdapter.outputs, workspace });
    if (nextManifest) nextAdapter = createTrellisSparseBlockAdapter({ route, config: nextManifest.config, weights: nextTensors,
      inputs: { projected: blockAdapter.outputs.hidden, modulation: prefixAdapter.outputs.modulation }, workspace });
    if (nextAdapter) inputCapture = createSparseBlockInputCapture(route.runtime, blockAdapter.outputs.hidden);
    report.phase = 'prefix-block-composition';
    const started = performance.now();
    const job = route.enqueue({ jobId: nextManifest ? 'prefix-block0-block1' : 'prefix-block0', execute: async invocation => {
      const producer = await prefixAdapter.run({ sample: prefixTensors.sample, timestep: prefixTensors.timestep[0] }, invocation);
      if (producer.projected !== prefixAdapter.outputs.projected || producer.modulation !== prefixAdapter.outputs.modulation) throw new Error('prefix tensor identity changed');
      let output = await blockAdapter.run(invocation);
      if (nextAdapter) {
        if (output.hidden !== blockAdapter.outputs.hidden) throw new Error('resident block0 hidden identity changed');
        inputCapture.capture();
        output = await nextAdapter.run(invocation);
        if (output.hidden !== blockAdapter.outputs.hidden) throw new Error('shared block-chain exit storage changed');
      }
      return { ...output, producer };
    } });
    const completion = await job.completion;
    if (completion.status !== 'succeeded') throw new Error(`block job ${completion.status}: ${completion.error?.message || ''}`);
    report.hostSubmitMs = performance.now() - started;
    report.sessionId = session.snapshot().sessionId;
    report.composition = { sameSession: true, sameJob: true, readbackBetweenPrefixAndBlock: false, reusedResidentPrefixBuffers: true,
      activationStorage: 'shared-serialized-block-workspace', executedBlocks: nextManifest ? 2 : 1,
      observedBlockIndex: nextManifest ? 1 : 0, readbackBetweenBlocks: false,
      block0FixtureSha256: blockSha, block1FixtureSha256: nextBlockSha,
      reusedResidentBlockHidden: Boolean(nextAdapter),
      incomingHiddenSnapshot: nextAdapter ? 'queue-ordered-GPU-copy-before-block1; observer-readback-after-chain' : null };
    report.phase = 'observation-readback';
    report.outputs = {};
    const observedAt = performance.now();
    if (inputCapture) {
      const data = await route.runtime.readTensor(inputCapture.tensor);
      const response = await fetch('/output/block1.input', { method: 'POST', body: data });
      if (!response.ok) throw new Error('could not preserve incoming block1 hidden');
      report.inputs = { 'block1.input': { shape: inputCapture.tensor.shape, dtype: inputCapture.tensor.dtype,
        sha256: await hash(data), origin: 'actual resident block0 exit consumed by block1' } };
    }
    const observed = { projected: completion.output.producer.projected, modulation: completion.output.producer.modulation,
      ...Object.fromEntries(BLOCK_OBSERVATIONS.map(key => {
        const tensor = (nextAdapter || blockAdapter).diagnostics[key];
        if (!tensor) throw new Error(`missing block diagnostic ${key}`);
        return [key, tensor];
      })) };
    for (const [name, tensor] of Object.entries(observed)) {
      const bytes = await route.runtime.readTensor(tensor), data = bytes instanceof Float32Array ? bytes : new Float32Array(bytes);
      const response = await fetch(`/output/${name}`, { method: 'POST', body: data });
      if (!response.ok) throw new Error(`could not preserve complete raw ${name}`);
      const isPrefix = name === 'projected' || name === 'modulation';
      report.outputs[name] = { shape: tensor.shape, dtype: tensor.dtype, sha256: await hash(data),
        comparison: isPrefix ? comparePrefixTensor(data, prefixTensors[`expected.${name}`]) : compareBlockTensor(data, observedTensors[`expected.${name}`]) };
    }
    report.completedWithReadbackMs = performance.now() - started;
    report.observerReadbackAndSaveMs = performance.now() - observedAt;
    const validation = await device.popErrorScope(); errorScope = false;
    if (validation) errors.push(validation.message);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!Object.values(report.outputs).every(row => row.comparison.passed)) throw new Error('whole-block numerical comparison failed');
    report.profile = route.runtime.finishProfile({ evidence: { mode: 'live', source: nextManifest ? 'sparse-prefix-block0-block1-exact-fixture' : 'sparse-prefix-block0-exact-fixture' } });
    report.status = 'succeeded'; report.phase = null;
  } catch (error) { report.error = { message: error.message, stack: error.stack }; }
  finally {
    if (errorScope) { const validation = await device.popErrorScope(); if (validation) errors.push(validation.message); }
    report.errors = errors; inputCapture?.dispose(); nextAdapter?.dispose(); blockAdapter?.dispose(); workspace?.dispose(); prefixAdapter?.dispose();
    if (session) { await session.drain(); session.close(); }
    device?.destroy();
  }
  return report;
}
