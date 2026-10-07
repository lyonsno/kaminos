import { createWebGpuInferenceSession, WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisOccupancyCoordinatesAdapter, OCCUPANCY_COORDINATES_ROUTE } from './occupancy-coordinates.js';
import { validateOccupancyCoordinateFixture, compareOccupancyCoordinates } from './occupancy-coordinate-witness-checks.js';
import { validateNativePrefixBackend, prefixAdapterName } from './sparse-prefix-witness-checks.js';
import { recordSamplerCompletion, preserveSamplerWitnessFailure } from './sparse-sampler-witness-checks.js';
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');

export async function runSparseCoordinatesWitness(expectedSha) {
  const report = { status: 'failed', phase: 'fixture', requestedRoute: OCCUPANCY_COORDINATES_ROUTE }, errors = [];
  let device, session, coordinates, logits, errorScope = false;
  try {
    const response = await fetch('/fixture/manifest.json', { cache: 'no-store' }); if (!response.ok) throw Error('coordinate reference unavailable');
    const bytes = await response.arrayBuffer(); if (await hash(bytes) !== expectedSha) throw Error('changed coordinate manifest');
    const m = JSON.parse(new TextDecoder().decode(bytes)), plan = validateOccupancyCoordinateFixture(m), values = {};
    report.reference = { source: m.source, producer: m.producer, input: m.input, route: m.referenceRoute, manifestSha256: expectedSha };
    report.config = m.config;
    for (const [name, row] of Object.entries(m.tensors)) {
      const item = await fetch('/fixture/' + row.file, { cache: 'no-store' }); if (!item.ok) throw Error('missing coordinate tensor ' + name);
      const raw = await item.arrayBuffer(); if (raw.byteLength !== row.byteLength || await hash(raw) !== row.sha256) throw Error('partial/changed coordinate bytes ' + name);
      values[name] = row.dtype === 'float32' ? new Float32Array(raw) : row.dtype === 'int32' ? new Int32Array(raw) : new Uint32Array(raw);
    }
    if (!values.logits.every(Number.isFinite)) throw Error('nonfinite source logits');
    report.phase = 'native-device'; const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) throw Error('WebGPU unavailable');
    report.backend = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description,
      device: adapter.info.device, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter };
    validateNativePrefixBackend(report.backend); if (report.backend.isFallbackAdapter !== false) throw Error('observed nonfallback adapter required');
    device = await adapter.requestDevice(); device.pushErrorScope('validation'); errorScope = true;
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    report.deviceLimits = { maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize, maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension };
    report.adapterLimits = { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize };
    session = await createWebGpuInferenceSession({ sessionId: 'occupancy-coordinates-' + crypto.randomUUID(), adapter, device, adapterName: prefixAdapterName(adapter.info) });
    const route = await session.registerRoute({ routeId: OCCUPANCY_COORDINATES_ROUTE,
      runtimeOptions: { requiredStages: plan.stages, kernel: { profile: 'trellis2-source-occupancy-coordinates-v0' } } });
    report.effectiveRoute = route.routeId; if (route.routeId !== report.requestedRoute) throw Error('wrong coordinate route');
    logits = route.runtime.createTensor({ name: 'coordinate-stage-source-logits', shape: plan.inputShape, dtype: 'f32', usage: U.storage | U.copyDst });
    route.runtime.uploadTensor(logits, values.logits);
    coordinates = createTrellisOccupancyCoordinatesAdapter({ route, resolution: m.config.resolution, logitsTensor: logits });
    report.phase = 'coordinate-execution'; const job = route.enqueue({ jobId: 'complete-source-coordinate-policy', execute: inv => coordinates.run(inv) });
    const completion = await job.completion; recordSamplerCompletion(report, completion);
    if (completion.status !== 'succeeded') { preserveSamplerWitnessFailure(report); return report; }
    const tensor = await coordinates.coordinates(); report.sessionId = session.snapshot().sessionId;
    report.composition = { sameSession: true, sameJob: true, rows: tensor.shape[0], candidateRows: plan.candidateRows,
      logitsHandoff: 'offline source-logit upload; live decoder API not exercised by this witness',
      metadataBytesToCPU: 4, coordinateBytesToCPUDuringServing: 0, coordinateOrder: plan.coordinateOrder };
    report.phase = 'observer-readback'; report.outputs = {};
    const raw = await route.runtime.readTensor(tensor), data = raw instanceof Int32Array ? raw : new Int32Array(raw);
    const saved = await fetch('/output/coordinates', { method: 'POST', headers: { 'X-Tensor-Dtype': 'i32' }, body: data }); if (!saved.ok) throw Error('coordinate output not saved');
    report.outputs.coordinates = { shape: tensor.shape, dtype: 'i32', sha256: await hash(data), comparison: compareOccupancyCoordinates(data, values['expected.coordinates']) };
    const validation = await device.popErrorScope(); errorScope = false; if (validation) errors.push(validation.message); if (errors.length) throw Error(errors.join('\n'));
    report.numericalStatus = report.outputs.coordinates.comparison.passed ? 'passed' : 'failed';
    report.profileStatus = 'failed'; report.profile = route.runtime.finishProfile({ evidence: { mode: 'live', source: 'exact-source-native-occupancy-coordinates' } }); report.profileStatus = 'passed';
    if (report.numericalStatus !== 'passed' || tensor.shape[0] !== m.rows) throw Error('source coordinate value/row identity failed');
    report.status = 'succeeded'; report.phase = null;
  } catch (error) { preserveSamplerWitnessFailure(report, error); }
  finally {
    if (errorScope) try { const e = await device.popErrorScope(); if (e) errors.push(e.message); } catch (error) { errors.push(error.message); }
    report.errors = errors;
    for (const [name, cleanup] of [['coordinates', () => coordinates?.dispose()], ['logits', () => logits?.buffer.destroy()],
      ['session', async () => { if (session) { await session.drain(); session.close(); } }], ['device', () => device?.destroy()]]) {
      try { await cleanup(); } catch (error) { report.cleanupErrors ??= []; report.cleanupErrors.push({ name, message: error.message }); report.status = 'failed'; }
    }
  }
  return report;
}
