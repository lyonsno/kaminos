import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparsePrefixAdapter, SPARSE_PREFIX_ROUTE } from './sparse-prefix.js';
import { comparePrefixTensor, validateNativePrefixBackend, validatePrefixFixture,
  validatePrefixRoute, prefixAdapterName } from './sparse-prefix-witness-checks.js';

const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  x => x.toString(16).padStart(2, '0')).join('');

// Offline observer only. The serving adapter neither loads references nor
// reads outputs back; these two browser-owned GPU tensors can feed block 0.
export async function runSparsePrefixWitness(expectedManifestSha) {
  const report = { status: 'failed', phase: 'fixture', requestedRoute: SPARSE_PREFIX_ROUTE };
  let session, implementation, device, errorScope = false;
  const errors = [];
  try {
    const response = await fetch('/fixture/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('reference manifest unavailable');
    const bytes = await response.arrayBuffer();
    report.fixtureSha256 = await hash(bytes);
    if (report.fixtureSha256 !== expectedManifestSha) throw new Error('reference manifest digest mismatch');
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const plan = validatePrefixFixture(manifest);
    report.reference = { route: manifest.referenceRoute, source: manifest.source,
      checkpoint: manifest.checkpoint, sample: manifest.sample, fullModelExecutions: manifest.fullModelExecutions };
    const tensors = {};
    for (const [name, descriptor] of Object.entries(manifest.tensors)) {
      if (!/^[\w.-]+$/.test(descriptor.file)) throw new Error(`unsafe tensor path: ${name}`);
      const tensorResponse = await fetch(`/fixture/${descriptor.file}`, { cache: 'no-store' });
      if (!tensorResponse.ok) throw new Error(`missing tensor ${name}`);
      const data = await tensorResponse.arrayBuffer();
      if (data.byteLength !== descriptor.byteLength || await hash(data) !== descriptor.sha256) {
        throw new Error(`truncated or changed tensor: ${name}`);
      }
      tensors[name] = new Float32Array(data);
    }
    report.phase = 'native-device';
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    report.backend = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description, isFallbackAdapter: adapter.isFallbackAdapter };
    validateNativePrefixBackend(report.backend);
    device = await adapter.requestDevice();
    device.pushErrorScope('validation'); errorScope = true;
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    session = await createWebGpuInferenceSession({ sessionId: `sparse-prefix-${crypto.randomUUID()}`,
      adapter, device, adapterName: prefixAdapterName(adapter.info) });
    const route = await session.registerRoute({ routeId: SPARSE_PREFIX_ROUTE,
      runtimeOptions: { requiredStages: plan.stages, kernel: { profile: 'trellis2-sparse-prefix-bf16-values-v0' } } });
    report.effectiveRoute = route.routeId;
    validatePrefixRoute(report.requestedRoute, report.effectiveRoute);
    report.phase = 'prefix-execution';
    implementation = createTrellisSparsePrefixAdapter({ route, weights: tensors, config: manifest.config });
    const start = performance.now();
    const job = route.enqueue({ jobId: 'sparse-prefix', execute: invocation =>
      implementation.run({ sample: tensors.sample, timestep: tensors.timestep[0] }, invocation) });
    const completion = await job.completion;
    if (completion.status !== 'succeeded') throw new Error(`prefix job ${completion.status}: ${completion.error?.message || ''}`);
    report.executionMs = performance.now() - start;
    report.sessionId = session.snapshot().sessionId;
    report.phase = 'observation-readback';
    report.outputs = {};
    for (const name of ['projected', 'modulation']) {
      const gpuTensor = completion.output[name];
      const actual = await route.runtime.readTensor(gpuTensor);
      const data = actual instanceof Float32Array ? actual : new Float32Array(actual);
      const posted = await fetch(`/output/${name}`, { method: 'POST', body: data });
      if (!posted.ok) throw new Error(`raw ${name} evidence could not be saved`);
      report.outputs[name] = { shape: gpuTensor.shape, dtype: gpuTensor.dtype, arithmetic: completion.output.arithmetic,
        gpuBufferRetained: !!gpuTensor.buffer, sha256: await hash(data),
        comparison: comparePrefixTensor(data, tensors[`expected.${name}`]) };
    }
    const validation = await device.popErrorScope(); errorScope = false;
    if (validation) errors.push(validation.message);
    report.errors = errors;
    if (errors.length) throw new Error(errors.join('\n'));
    if (!Object.values(report.outputs).every(row => row.comparison.passed)) throw new Error('prefix numerical comparison failed');
    report.profile = route.runtime.finishProfile({ evidence: { mode: 'live', source: 'sparse-prefix-exact-fixture' } });
    report.status = 'succeeded'; report.phase = null;
  } catch (error) { report.error = { message: error.message, stack: error.stack }; }
  finally {
    if (errorScope) { const validation = await device.popErrorScope(); if (validation) errors.push(validation.message); }
    report.errors = errors;
    implementation?.dispose();
    if (session) { await session.drain(); session.close(); }
    device?.destroy();
  }
  return report;
}
