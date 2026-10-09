// SuperMat image-to-PBR model port for the Kaminos WebGPU inference kit.
// One adapter keeps the F32 weights, pipelines and activation pool resident on
// a registered route; each run maps one RGBA image to albedo, roughness and
// metallic maps at 512x512, following the pinned source pipeline.
import { defineWebGpuModelResourceManifest } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatOps } from './supermat-ops.js';
import { createWeightAccessor, decodeLatent, encodeImage, runUnet, timeEmbedding } from './supermat-model.js';
import { preprocessForSuperMat, resizeRgbaBilinear } from './supermat-preprocess.js';

export const SUPERMAT_ROUTE_ID = 'supermat.image-to-pbr.webgpu-local.v0';
export const SUPERMAT_IMAGE_SIZE = 512;
// Encoded work per cooperative duty. About 8 ms of GPU time at the ~2 TFLOP/s
// this F32 route sustains on an M4 Max; single ops larger than this (the
// full-resolution decoder convs) still submit whole.
export const DEFAULT_DUTY_FLOPS = 16e9;
const PACKAGE_SCHEMA = 'supermat.browser-weight-package.v0';

// numpy (x * 255.0).round() on float32: half-to-even after an F32 product.
function quantize(value) {
  const scaled = Math.fround(Math.fround(Math.min(1, Math.max(0, value))) * 255);
  const floor = Math.floor(scaled), fraction = scaled - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function mapsFromPlanes(albedo, orm, size = SUPERMAT_IMAGE_SIZE) {
  const plane = size * size;
  const make = () => new Uint8ClampedArray(plane * 4);
  const maps = { albedo: make(), roughness: make(), metallic: make(), orm: make() };
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      maps.albedo[o + c] = quantize(albedo[c * plane + i]);
      maps.orm[o + c] = quantize(orm[c * plane + i]);
    }
    const roughness = quantize(orm[plane + i]), metallic = quantize(orm[2 * plane + i]);
    maps.roughness[o] = maps.roughness[o + 1] = maps.roughness[o + 2] = roughness;
    maps.metallic[o] = maps.metallic[o + 1] = maps.metallic[o + 2] = metallic;
    maps.albedo[o + 3] = maps.roughness[o + 3] = maps.metallic[o + 3] = maps.orm[o + 3] = 255;
  }
  return Object.fromEntries(Object.entries(maps).map(([name, data]) => [name, { width: size, height: size, data }]));
}

export async function createSuperMatAdapter({ route, weightsUrl, signal, onProgress } = {}) {
  if (!route?.runtime?.device || typeof route.loadModelResourcesFromSource !== 'function') {
    throw new Error('SuperMat adapter requires a registered kit session route');
  }
  const base = new URL(weightsUrl, globalThis.location?.href);
  const response = await fetch(new URL('package.json', base), { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`SuperMat weight package: HTTP ${response.status}`);
  const weightPackage = await response.json();
  if (weightPackage.schema !== PACKAGE_SCHEMA || weightPackage.status !== 'succeeded') {
    throw new Error('SuperMat weight package must be a succeeded browser-weight-package.v0');
  }
  const vScale = weightPackage.constants?.vScale;
  if (!Number.isFinite(vScale)) throw new Error('SuperMat weight package lacks the source scheduler vScale');

  const leases = [], tensors = {};
  const loadStart = performance.now();
  try {
    for (const [index, row] of weightPackage.resources.entries()) {
      const lease = await route.loadModelResourcesFromSource({
        manifest: defineWebGpuModelResourceManifest(row.manifest),
        source: new URL(row.file, base),
        signal,
        onProgress: event => onProgress?.({ phase: 'weights', resourceId: row.resourceId, resourceIndex: index,
          resourceCount: weightPackage.resources.length, loadedBytes: event.loadedBytes, totalBytes: event.totalBytes }),
      });
      leases.push(lease);
      Object.assign(tensors, lease.tensors);
    }
  } catch (error) {
    for (const lease of leases) lease.release();
    throw error;
  }
  const weightLoadMs = performance.now() - loadStart;
  const w = createWeightAccessor(tensors);
  const device = route.runtime.device;
  const ops = createSuperMatOps(device, { label: 'supermat' });
  const identity = Object.freeze({
    routeId: SUPERMAT_ROUTE_ID, backend: 'webgpu-local', modelId: 'supermat.single-image',
    revision: weightPackage.revision, weightDtype: 'f32', imageSize: SUPERMAT_IMAGE_SIZE,
    provenance: weightPackage.provenance,
  });
  let runs = 0, released = false, busy = false;

  // image: { width, height, data: RGBA bytes }. Returns 512x512 RGBA8 maps,
  // the float planes and per-phase timings. `schedule` makes the run
  // cooperative: { runtime, invocation } from a per-run route job, plus an
  // optional kit inference control (pause/resume), AbortSignal and dutyFlops.
  async function run({ image, schedule = null } = {}) {
    if (released) throw new Error('SuperMat adapter is released');
    if (busy) throw new Error('SuperMat adapter already has an active run');
    busy = true;
    const timings = {};
    const dutiesBefore = ops.stats.duties, historyStart = ops.stats.dutyHistory.length;
    const mark = async (name, start) => {
      await ops.flush();
      timings[name] = performance.now() - start;
      onProgress?.({ phase: name });
    };
    let t = performance.now();
    const input = preprocessForSuperMat(image, SUPERMAT_IMAGE_SIZE);
    const mask = resizeRgbaBilinear(image, SUPERMAT_IMAGE_SIZE, SUPERMAT_IMAGE_SIZE);
    timings.preprocessMs = performance.now() - t;
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    let error = null;
    try {
      ops.setSchedule(schedule ? { dutyFlops: DEFAULT_DUTY_FLOPS, ...schedule } : null);
      t = performance.now();
      const pixels = ops.upload([3, SUPERMAT_IMAGE_SIZE, SUPERMAT_IMAGE_SIZE], input, 'input');
      const latent = await encodeImage(ops, w, pixels);
      ops.release(pixels);
      await mark('encodeMs', t);
      t = performance.now();
      const tembSilu = timeEmbedding(ops, w);
      const heads = await runUnet(ops, w, latent, { tensor: w('conditioning.empty_prompt'), rows: 77 }, tembSilu);
      ops.release(latent);
      ops.release(tembSilu);
      await mark('unetMs', t);
      const planes = [];
      for (const [index, v] of heads.entries()) {
        t = performance.now();
        const x0 = ops.affine({ x: v, shape: v.shape, scale: vScale, name: `x0.${index}` });
        ops.release(v);
        const decoded = await decodeLatent(ops, w, x0, { call: index });
        ops.release(x0);
        await mark(index === 0 ? 'decodeAlbedoMs' : 'decodeOrmMs', t);
        t = performance.now();
        planes.push(await ops.read(decoded));
        ops.release(decoded);
        timings[index === 0 ? 'readAlbedoMs' : 'readOrmMs'] = performance.now() - t;
      }
      const maps = mapsFromPlanes(planes[0], planes[1]);
      const alpha = new Uint8ClampedArray(SUPERMAT_IMAGE_SIZE * SUPERMAT_IMAGE_SIZE);
      for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[i * 4 + 3];
      runs++;
      const duties = ops.stats.dutyHistory.slice(historyStart).map(row => ({ ...row }));
      return { width: SUPERMAT_IMAGE_SIZE, height: SUPERMAT_IMAGE_SIZE, maps, planes: { albedo: planes[0], orm: planes[1] },
        alpha, timings, run: runs, identity, cooperative: Boolean(schedule),
        dutyCount: ops.stats.duties - dutiesBefore, duties, opStats: { ...ops.stats, dutyHistory: undefined } };
    } catch (caught) {
      error = caught;
      await ops.discard();
      throw caught;
    } finally {
      ops.setSchedule(null);
      busy = false;
      const oom = await device.popErrorScope();
      const validation = await device.popErrorScope();
      const gpuError = oom ?? validation;
      if (gpuError && !error) throw new Error(`SuperMat WebGPU ${oom ? 'out-of-memory' : 'validation'} error: ${gpuError.message}`);
    }
  }

  function release() {
    if (released) return;
    released = true;
    ops.destroy();
    for (const lease of leases) lease.release();
  }

  return { identity, weightLoadMs, run, release };
}
