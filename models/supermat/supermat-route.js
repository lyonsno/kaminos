// SuperMat image-to-PBR model port for the Kaminos WebGPU inference kit.
// One adapter keeps the F32 weights, pipelines and activation pool resident on
// a registered route; each run maps one RGBA image to albedo, roughness and
// metallic maps at 512x512, following the pinned source pipeline.
import { defineWebGpuModelResourceManifest, runWebGpuWorkerPhase } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatOps } from './supermat-ops.js';
import { createWeightAccessor, decodeLatent, encodeImage, runUnet, timeEmbedding } from './supermat-model.js';
import { preprocessForSuperMat, resizeRgbaBilinear } from './supermat-preprocess.js';
import { mapsFromPlanes } from './supermat-maps.js';

export { mapsFromPlanes };

export const SUPERMAT_ROUTE_ID = 'supermat.image-to-pbr.webgpu-local.v0';
export const SUPERMAT_IMAGE_SIZE = 512;
// Cooperative duties start at this much encoded work and adapt toward the
// target completed-queue time; large GEMMs split into column ranges to fit.
export const DEFAULT_DUTY_FLOPS = 4e9;
export const DEFAULT_TARGET_DUTY_MS = 12;
const PACKAGE_SCHEMA = 'supermat.browser-weight-package.v0';

const CPU_WORKER_MODULE = 'supermat.cpu-phases.v0';

// CPU phases run in a module Worker when available (`cpuWorker: false` keeps
// them inline). Both paths call the same preprocessing and quantization code.
async function runCpuPhase(useWorker, operationId, payload, transfer, signal) {
  if (!useWorker) {
    if (operationId === 'supermat.preprocess') {
      const image = { width: payload.width, height: payload.height, data: new Uint8Array(payload.data) };
      const planes = preprocessForSuperMat(image, payload.size);
      const resized = resizeRgbaBilinear(image, payload.size, payload.size);
      const alpha = new Uint8ClampedArray(payload.size * payload.size);
      for (let i = 0; i < alpha.length; i++) alpha[i] = resized.data[i * 4 + 3];
      return { planes: planes.buffer, alpha: alpha.buffer };
    }
    const maps = mapsFromPlanes(new Float32Array(payload.albedo), new Float32Array(payload.orm), payload.size);
    return Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, map.data.buffer]));
  }
  const { output } = await runWebGpuWorkerPhase({
    executionId: crypto.randomUUID(), operationId, moduleId: CPU_WORKER_MODULE,
    createWorker: () => ({
      worker: new Worker(new URL('./supermat-cpu-worker.js', import.meta.url), { type: 'module', name: 'supermat-cpu' }),
      identity: { moduleId: CPU_WORKER_MODULE, workerType: 'module', source: 'supermat-cpu-worker.js' },
    }),
    payload, transfer, signal,
    validateOutput(value) {
      const required = operationId === 'supermat.preprocess' ? ['planes', 'alpha'] : ['albedo', 'roughness', 'metallic', 'orm'];
      for (const name of required) if (!(value?.[name] instanceof ArrayBuffer)) throw new Error(`${operationId} output lacks ${name}`);
      return value;
    },
  });
  return output;
}

export async function createSuperMatAdapter({ route, weightsUrl, signal, onProgress, cpuWorker = typeof Worker !== 'undefined',
  attention = 'streaming' } = {}) {
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
  const ops = createSuperMatOps(device, { label: 'supermat', attention });
  const identity = Object.freeze({
    routeId: SUPERMAT_ROUTE_ID, backend: 'webgpu-local', modelId: 'supermat.single-image',
    revision: weightPackage.revision, weightDtype: 'f32', defaultImageSize: SUPERMAT_IMAGE_SIZE, attention,
    provenance: weightPackage.provenance,
  });
  let runs = 0, released = false, busy = false;

  // image: { width, height, data: RGBA bytes }. Returns 512x512 RGBA8 maps,
  // the float planes and per-phase timings. `schedule` makes the run
  // cooperative: { runtime, invocation } from a per-run route job, plus an
  // optional kit inference control (pause/resume), AbortSignal and dutyFlops.
  // size: square model resolution, a multiple of 64 (SuperMat recommends 512).
  async function run({ image, schedule = null, size = SUPERMAT_IMAGE_SIZE } = {}) {
    if (!Number.isSafeInteger(size) || size < 64 || size % 64) throw new Error('SuperMat size must be a positive multiple of 64');
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
    const source = new Uint8Array(image.data);
    const prepared = await runCpuPhase(cpuWorker, 'supermat.preprocess', { width: image.width, height: image.height,
      data: source.buffer, size: size }, [source.buffer], schedule?.signal);
    const input = new Float32Array(prepared.planes);
    timings.preprocessMs = performance.now() - t;
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    let error = null;
    try {
      ops.setSchedule(schedule ? { dutyFlops: DEFAULT_DUTY_FLOPS, targetDutyMs: DEFAULT_TARGET_DUTY_MS, ...schedule } : null);
      t = performance.now();
      const pixels = ops.upload([3, size, size], input, 'input');
      const latent = await encodeImage(ops, w, pixels);
      ops.release(pixels);
      await mark('encodeMs', t);
      t = performance.now();
      const tembSilu = await timeEmbedding(ops, w);
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
      t = performance.now();
      const packed = await runCpuPhase(cpuWorker, 'supermat.maps', { albedo: planes[0].slice().buffer,
        orm: planes[1].slice().buffer, size: size }, [], schedule?.signal);
      const maps = Object.fromEntries(Object.entries(packed).map(([name, buffer]) => [name,
        { width: size, height: size, data: new Uint8ClampedArray(buffer) }]));
      timings.packMapsMs = performance.now() - t;
      const alpha = new Uint8ClampedArray(prepared.alpha);
      runs++;
      const duties = ops.stats.dutyHistory.slice(historyStart).map(row => ({ ...row }));
      return { width: size, height: size, maps, planes: { albedo: planes[0], orm: planes[1] },
        alpha, timings, run: runs, identity, size, cooperative: Boolean(schedule), cpuWorker,
        dutyCount: ops.stats.duties - dutiesBefore, duties, schedule: schedule ? ops.scheduleState() : null, opStats: { ...ops.stats, dutyHistory: undefined } };
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
