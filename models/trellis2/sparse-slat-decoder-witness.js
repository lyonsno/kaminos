import { createWebGpuInferenceSession, WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSLatDecoderAdapter, SLAT_DECODER_ROUTE } from './slat-decoder.js';
import { validateSLatDecoderFixture, compareSLatDecoderObservation } from './slat-decoder-witness-checks.js';
import { validateNativePrefixBackend, prefixAdapterName } from './sparse-prefix-witness-checks.js';
import { preserveSamplerWitnessFailure, recordSamplerCompletion } from './sparse-sampler-witness-checks.js';
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
export async function runSLatDecoderWitness(expectedSha) {
  const report = { status: 'failed', phase: 'fixture', requestedRoute: SLAT_DECODER_ROUTE }, errors = [], owned = [];
  let device, session, decoder, scope = false;
  try {
    const response = await fetch('/fixture/manifest.json', { cache: 'no-store' });if (!response.ok) throw Error('learned decoder fixture unavailable');
    const bytes = await response.arrayBuffer();if (await hash(bytes) !== expectedSha) throw Error('changed learned decoder manifest');
    const m = JSON.parse(new TextDecoder().decode(bytes)), plan = validateSLatDecoderFixture(m), tensors = {};
    report.reference = { source: m.source, producer: m.producer, route: m.referenceRoute, effectiveBackend: m.effectiveBackend,
      fixtureKind: m.fixtureKind, checkpoint: m.checkpoint, input: m.input, inputHandoff: m.inputHandoff, manifestSha256: expectedSha };
    report.config = m.config;report.fixtureVerifiedTensorCount = 0;
    for (const [name, row] of Object.entries(m.tensors)) {
      if (!/^[\w.-]+$/.test(row.file)) throw Error('unsafe learned decoder tensor path');
      const r = await fetch('/fixture/' + row.file, { cache: 'no-store' });if (!r.ok) throw Error('missing learned decoder tensor ' + name);
      const raw = await r.arrayBuffer();if (raw.byteLength !== row.byteLength || await hash(raw) !== row.sha256) throw Error('partial/changed learned decoder tensor ' + name);
      tensors[name] = row.dtype === 'int32' ? new Int32Array(raw) : new Float32Array(raw);
      if (name !== 'silu' && name !== 'halfInputs' && !tensors[name].every(Number.isFinite)) throw Error('nonfinite learned decoder input/reference ' + name);
      report.fixtureVerifiedTensorCount++;
    }
    report.phase = 'native-device';const adapter = await navigator.gpu?.requestAdapter();if (!adapter) throw Error('WebGPU unavailable');
    report.backend = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description,
      device: adapter.info.device, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter };validateNativePrefixBackend(report.backend);
    // Admit the effective adapter's full binding capacity; each generated count
    // still specializes exact allocations. Do not hide a smaller source cap.
    report.requiredLimits = { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize };
    device = await adapter.requestDevice({ requiredLimits: report.requiredLimits });report.deviceLimits = { ...report.requiredLimits,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension };
    device.pushErrorScope('validation');scope = true;device.addEventListener('uncapturederror', e => errors.push(e.error.message));
    session = await createWebGpuInferenceSession({ sessionId: 'learned-decoder-' + crypto.randomUUID(), adapter, device, adapterName: prefixAdapterName(adapter.info) });
    const requiredStages = ['decoder-half-roundtrip', ...plan.stages.filter(s => s !== 'decoder-child-scan-add')];
    const route = await session.registerRoute({ routeId: SLAT_DECODER_ROUTE, runtimeOptions: { requiredStages,
      kernel: { profile: 'trellis2-sparse-FP16-semantics-F32-storage-v0' } } });
    report.effectiveRoute = route.routeId;if (report.effectiveRoute !== report.requestedRoute) throw Error('effective learned decoder route mismatch');
    const runtime = route.runtime, upload = (name, shape, data, dtype = 'f32') => {
      const t = runtime.createTensor({ name: 'learned-witness.' + name, shape, dtype, usage: U.storage | U.copySrc | U.copyDst });owned.push(t);runtime.uploadTensor(t, data);return t;
    };
    const sample = upload('source-codes', [plan.tokenRows, plan.latentChannels], tensors.sample),
      coordinates = upload('source-coordinates', [plan.tokenRows, 3], tensors.coordinates, 'i32'),
      halfInputs = upload('all-half-inputs', [65536], tensors.halfInputs), halfRoundTrip = runtime.createTensor({ name: 'learned-witness.half-roundtrip',
        shape: [65536], dtype: 'f32', usage: U.storage | U.copySrc });owned.push(halfRoundTrip);
    const kernel = runtime.defineComputeKernel({ name: 'decoder-half-roundtrip', code: `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<65536u){output[id.x]=unpack2x16float(pack2x16float(vec2<f32>(input[id.x],0.0))).x;}}`,
      bindings: [{ name: 'input', resource: halfInputs, access: 'read-only-storage' }, { name: 'output', resource: halfRoundTrip, access: 'storage' }] });
    report.phase = 'half-roundtrip';
    const halfJob = route.enqueue({ jobId: 'source-half-bit-conformance', execute: invocation => runtime.runKernel(kernel,
      { stage: 'decoder-half-roundtrip', dispatch: [256, 1, 1], schedulerInvocation: invocation, yieldAfter: true }) });
    const halfCompleted = await halfJob.completion;recordSamplerCompletion(report, halfCompleted);
    if (halfCompleted.status !== 'succeeded') { preserveSamplerWitnessFailure(report);return report; }
    const guide = plan.mode === 'texture' ? Array.from({ length: plan.subdivisionLevels }, (_, i) => upload('shape-guide' + i, m.subdivisionRows[i], tensors['guide' + i])) : undefined;
    report.phase = 'learned-decoder-construction';
    decoder = createTrellisSLatDecoderAdapter({ route, config: m.config,
      weights: Object.fromEntries(Object.entries(tensors).filter(([n]) => n.startsWith('weight.')).map(([n, v]) => [n.slice(7), v])),
      siluTable: tensors.silu, sampleTensor: sample, coordinateTensor: coordinates, guideSubdivisions: guide });
    if (decoder.inputs.sample !== sample || decoder.inputs.coordinates !== coordinates) throw Error('exact resident input borrowing required');
    report.phase = 'learned-decoder-execution';const started = performance.now();
    const job = route.enqueue({ jobId: 'actual-learned-' + plan.mode + '-decoder', execute: invocation => decoder.run(invocation) });
    const completed = await job.completion;recordSamplerCompletion(report, completed);
    if (completed.status !== 'succeeded') { preserveSamplerWitnessFailure(report);return report; }
    const result = completed.output;report.hostSubmitMs = performance.now() - started;
    report.composition = { exactBorrowedInputIdentity: true, sameSession: true, sessionId: session.snapshot().sessionId,
      convolutionsExecuted: result.convolutionsExecuted, convNeXtBlocksExecuted: result.convNeXtBlocksExecuted,
      levels: result.levels, outputRows: result.features.shape[0], outputResolution: result.resolution,
      metadataReadbackBytes: result.metadataReadbackBytes, featureBytesToCPUDuringServing: result.featureBytesToCPUDuringServing,
      coordinateBytesToCPUDuringServing: result.coordinateBytesToCPUDuringServing, arithmetic: result.arithmetic,
      storage: plan.storage, inputHandoff: 'offline exact-source codes/coordinates; actual GPU decoder borrowing, not live sampler composition' };
    report.phase = 'observation-readback';report.outputs = {};
    const observed = { features: result.features, coordinates: result.coordinates, halfRoundTrip,
      ...Object.fromEntries(result.subdivisions.map((t, i) => ['subdivision' + i, t])) };
    for (const [name, t] of Object.entries(observed)) {
      const raw = await runtime.readTensor(t), data = name === 'coordinates' ? new Int32Array(raw) : new Float32Array(raw),
        saved = await fetch('/output/' + name, { method: 'POST', headers: { 'X-Tensor-Dtype': t.dtype }, body: data });
      if (!saved.ok) throw Error('raw learned decoder observation not saved ' + name);
      const expected = tensors[name === 'halfRoundTrip' ? 'halfInputs' : 'expected.' + name],
        comparison = compareSLatDecoderObservation(name, data, expected);
      report.outputs[name] = { shape: t.shape, dtype: t.dtype, sha256: await hash(data), comparison };
    }
    report.numericalStatus = Object.values(report.outputs).every(r => r.comparison.passed) ? 'passed' : 'failed';
    const validation = await device.popErrorScope();scope = false;if (validation) errors.push(validation.message);
    report.profileStatus = 'failed';report.profile = runtime.finishProfile({ evidence: { mode: 'live', source: 'source-matched-learned-sparse-decoder' } });report.profileStatus = 'passed';
    if (errors.length) throw Error(errors.join('\n'));if (report.numericalStatus !== 'passed') throw Error('complete learned decoder numerical/sign/coordinate/half comparison failed');
    report.status = 'succeeded';report.phase = null;
  } catch (error) { preserveSamplerWitnessFailure(report, error); }
  finally {
    if (scope) { try { const e = await device.popErrorScope();if (e) errors.push(e.message); } catch (e) { errors.push(e.message); } }
    report.errors = errors;
    for (const [name, cleanup] of [['decoder', () => decoder?.dispose()], ['witness-inputs', () => owned.forEach(t => t.buffer?.destroy?.())],
      ['session', async () => { if (session) { await session.drain();session.close(); } }], ['device', () => device?.destroy()]]) {
      try { await cleanup(); } catch (error) { report.cleanupErrors ??= [];report.cleanupErrors.push({ name, message: error.message });report.status = 'failed'; }
    }
  }
  return report;
}
