// Route-level witness: browser-decoded image through the resident adapter,
// cold then warm, against the pinned CPU reference outputs. No proof captures
// run inside the route, so its phase timings are the route's own.
import { compareWebGpuParityArrays, createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, mapsFromPlanes, superMatDeviceOptions } from './supermat-route.js';
import { decodeImageRgba } from './supermat-image.js';

// Predeclared: the full-route output tolerance, and warm == cold exactly.
// F16 weight storage gets its own bar (declared before its first run).
export const ROUTE_TOLERANCE = Object.freeze({ relativeL2: 1e-3, cosine: 0.9999, maxAbs: 2e-3 });
export const ROUTE_TOLERANCE_F16_WEIGHTS = Object.freeze({ relativeL2: 1e-2, cosine: 0.9999, maxAbs: 0.03 });
// F16 GEMM arithmetic (declared before its first run): looser, characterization bar.
export const ROUTE_TOLERANCE_F16_COMPUTE = Object.freeze({ relativeL2: 3e-2, cosine: 0.999, maxAbs: 0.1 });

async function fetchFloat(manifest, name) {
  const row = manifest.tensors[name];
  const response = await fetch(`/fixture/${encodeURIComponent(row.file)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`reference ${name}: HTTP ${response.status}`);
  return new Float32Array(await response.arrayBuffer());
}

async function savePng(name, map) {
  const canvas = new OffscreenCanvas(map.width, map.height);
  canvas.getContext('2d').putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const saved = await fetch(`/output/${name}.png`, { method: 'POST', body: blob });
  if (!saved.ok) throw new Error(`output ${name} was not persisted: HTTP ${saved.status}`);
}

function byteDifference(a, b) {
  let count = 0, max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) { count++; if (d > max) max = d; }
  }
  return { differing: count, maxDifference: max, total: a.length };
}

// runOptions.fencedDuties: { targetDutyMs } runs the cooperative duty split and
// fences with a stub runtime and no foreground work, to separate splitting
// cost from frame pacing.
export async function runSuperMatRouteWitness({ fixtureSha256, weightsSha256, runs = 2, adapterOptions = {}, runOptions = {} }) {
  const result = { schema: 'supermat.route-witness.browser.v0', status: 'failed', phase: 'admission',
    fixtureSha256, weightsSha256, tolerance: ROUTE_TOLERANCE, runs: [], adapterOptions, runOptions };
  let session, route, adapter;
  try {
    const reference = await (await fetch('/fixture/manifest.json', { cache: 'no-store' })).json();
    if (reference.status !== 'succeeded') throw new Error('reference manifest is not a succeeded export');
    result.phase = 'device';
    session = await createWebGpuInferenceSession({ sessionId: 'supermat-route-witness', gpu: navigator.gpu,
      deviceOptions: await superMatDeviceOptions(navigator.gpu, { adapterName: 'supermat-route-witness' }) });
    route = await session.registerRoute({ routeId: 'supermat.image-to-pbr.webgpu-local.v0' });
    const device = route.runtime.device;
    result.adapter = route.runtime.backendIdentity ?? null;

    result.phase = 'weights';
    adapter = await createSuperMatAdapter({ route, weightsUrl: '/weights/', ...adapterOptions });
    result.identity = adapter.identity;
    const tolerance = adapter.identity.gemmPrecision !== 'f32' || adapter.identity.activations === 'f16' ? ROUTE_TOLERANCE_F16_COMPUTE
      : adapter.identity.weightDtype === 'f16' ? ROUTE_TOLERANCE_F16_WEIGHTS : ROUTE_TOLERANCE;
    result.tolerance = tolerance;
    result.weightLoadMs = adapter.weightLoadMs;

    result.phase = 'decode';
    const blob = await (await fetch('/image', { cache: 'no-store' })).blob();
    let t = performance.now();
    const image = await decodeImageRgba(blob, device);
    result.decode = { width: image.width, height: image.height, ms: performance.now() - t, type: blob.type };
    const decodedReference = await fetch('/decoded-reference', { cache: 'no-store' });
    if (decodedReference.ok) {
      const expected = new Uint8Array(await decodedReference.arrayBuffer());
      result.decode.versusPil = expected.length === image.data.length ? byteDifference(image.data, expected)
        : { error: `PIL decode has ${expected.length} bytes, browser ${image.data.length}` };
    }

    result.phase = 'runs';
    const outputs = [];
    const unknownRunOptions = Object.keys(runOptions).filter(key => !['runs', 'fencedDuties'].includes(key));
    if (unknownRunOptions.length) throw new Error(`unknown route witness run option: ${unknownRunOptions.join(', ')}`);
    const fenced = runOptions.fencedDuties;
    const schedule = () => fenced ? { runtime: { prepareCommandDutyAtBoundary: async () => ({}), settleCommandDuty() {} },
      invocation: { invocationId: 'route-witness-fenced-duties' }, control: null, targetDutyMs: fenced.targetDutyMs } : null;
    for (let index = 0; index < (runOptions.runs ?? runs); index++) {
      t = performance.now();
      const out = await adapter.run({ image, size: reference.imageSize ?? 512, schedule: schedule() });
      outputs.push(out);
      result.runs.push({ run: out.run, size: out.size, wallMs: performance.now() - t, timings: out.timings,
        peakLiveBytes: out.opStats.peakLiveBytes, dispatches: out.opStats.dispatches, cooperative: out.cooperative,
        dutyCount: out.dutyCount, ownMsSum: out.duties?.reduce((sum, row) => sum + (row.ownMs ?? 0), 0) ?? null,
        targetDutyMs: out.schedule?.targetDutyMs ?? null, profile: out.profile });
    }

    result.phase = 'comparison';
    const [cold, warm] = outputs;
    const refAlbedo = await fetchFloat(reference, 'output.albedo');
    const refOrm = await fetchFloat(reference, 'output.orm');
    result.comparisons = {};
    let pass = true;
    for (const [name, actual, expected] of [['albedo', cold.planes.albedo, refAlbedo], ['orm', cold.planes.orm, refOrm]]) {
      const m = compareWebGpuParityArrays(actual, expected, { stageId: `route.${name}` }).metrics;
      const row = { relativeL2Error: m.relativeL2Error, cosineSimilarity: m.cosineSimilarity, maxAbsoluteError: m.maxAbsoluteError };
      row.pass = m.relativeL2Error <= tolerance.relativeL2 && m.cosineSimilarity >= tolerance.cosine
        && m.maxAbsoluteError <= tolerance.maxAbs;
      pass &&= row.pass;
      result.comparisons[name] = row;
    }
    const referenceMaps = mapsFromPlanes(refAlbedo, refOrm, reference.imageSize ?? 512);
    result.eightBit = Object.fromEntries(['albedo', 'roughness', 'metallic'].map(name =>
      [name, byteDifference(cold.maps[name].data, referenceMaps[name].data)]));
    if (warm) {
      result.warmEqualsCold = ['albedo', 'orm'].every(name =>
        warm.planes[name].every((value, i) => Object.is(value, cold.planes[name][i])));
      pass &&= result.warmEqualsCold;
    }
    for (const name of ['albedo', 'roughness', 'metallic']) await savePng(name, cold.maps[name]);
    result.phase = 'complete';
    result.status = pass ? 'passed' : 'failed-tolerance';
  } catch (error) {
    result.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  } finally {
    adapter?.release();
    if (route) { await route.drain?.(); session?.unregisterRoute(route.routeId); }
    await session?.close?.();
  }
  return result;
}
