import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import {
  PIXAL3D_CROP_SCALE,
  PIXAL3D_DEFAULT_FOV_RAD,
  computePixal3dDistanceFromFov,
  buildPixal3dProjGridPlan,
  projectPixal3dGridCpu,
  createPixal3dProjGridAdapter,
} from '../proj-grid.js';

// 1. Camera distance from FOV matches generate_pixal3d.py / upstream inference.py.
assert.equal(PIXAL3D_CROP_SCALE, 1.1);
const dDefault = computePixal3dDistanceFromFov({
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  meshScale: 1.0,
  imageResolution: 512,
});
assert.ok(Math.abs(dDefault - 1.0937500142266299) <= 1e-12, `unexpected default distance: ${dDefault}`);

const dCrop = computePixal3dDistanceFromFov({
  cameraAngleX: 0.5023482854328188,
  meshScale: 1.0 / PIXAL3D_CROP_SCALE,
  imageResolution: 512,
});
assert.ok(Math.abs(dCrop - 2.143472404833187) <= 1e-12, `unexpected crop distance: ${dCrop}`);

for (const bad of [
  { cameraAngleX: 0 },
  { cameraAngleX: Math.PI },
  { cameraAngleX: -0.5 },
  { cameraAngleX: NaN },
  { meshScale: 0 },
  { meshScale: -1 },
  { imageResolution: 0 },
  { extendPixel: Infinity },
]) {
  assert.throws(() => computePixal3dDistanceFromFov(bad));
}

// 2. Plan validation for dense 16^3 SS and sparse LR/HR SLat projection.
const ssPlan = buildPixal3dProjGridPlan({
  gridResolution: 16,
  imageResolution: 512,
  featureHeight: 32,
  featureWidth: 32,
  channels: 1024,
  prefixTokens: 5,
});
assert.equal(ssPlan.rows, 4096);
assert.equal(ssPlan.outChannels, 1024);
assert.deepEqual(ssPlan.globalShape, [5, 1024]);
assert.deepEqual(ssPlan.projectedShape, [4096, 1024]);
assert.deepEqual(ssPlan.stages, ['pixal3d-global-conditioning', 'pixal3d-proj-grid-sample']);

const slatPlan = buildPixal3dProjGridPlan({
  gridResolution: 64,
  imageResolution: 1024,
  featureHeight: 32,
  featureWidth: 32,
  channels: 1024,
  highResFeatureHeight: 512,
  highResFeatureWidth: 512,
  highResChannels: 1024,
  tokenRows: 7,
  prefixTokens: 5,
});
assert.equal(slatPlan.rows, 7);
assert.equal(slatPlan.outChannels, 2048);
assert.deepEqual(slatPlan.projectedShape, [7, 2048]);

for (const bad of [
  { gridResolution: 1 },
  { imageResolution: 0 },
  { featureHeight: 0 },
  { channels: 0 },
  { tokenRows: 0 },
  { prefixTokens: -1 },
]) {
  assert.throws(() => buildPixal3dProjGridPlan(bad));
}

// 3. Deterministic 2^3 projection + bilinear sample matches pinned MLX ProjGrid output.
const fmap2 = Float32Array.from({ length: 4 * 4 * 3 }, (_, i) => i / 48.0);
const expected2 = [
  [0.7273240089416504, 0.7481570243835449, 0.7689899802207947],
  [0.75, 0.7708330154418945, 0.7916669845581055],
  [0.04104899987578392, 0.06188200041651726, 0.08271600306034088],
  [0.0, 0.020833000540733337, 0.04166699945926666],
  [0.8988919854164124, 0.9197260141372681, 0.9405590295791626],
  [0.9375, 0.9583330154418945, 0.9791669845581055],
  [0.21261799335479736, 0.2334509938955307, 0.25428399443626404],
  [0.1875, 0.20833300054073334, 0.22916699945926666],
].flat();

const cpuOut = projectPixal3dGridCpu({
  features: fmap2,
  gridResolution: 2,
  imageResolution: 512,
  featureHeight: 4,
  featureWidth: 4,
  channels: 3,
  prefixTokens: 0,
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  distance: dDefault,
  meshScale: 1.0,
});
assert.equal(cpuOut.projected.length, 24);
for (let i = 0; i < expected2.length; i++) {
  assert.ok(
    Math.abs(cpuOut.projected[i] - expected2[i]) <= 1e-6,
    `mismatch at ${i}: got ${cpuOut.projected[i]} vs ${expected2[i]}`,
  );
}

// 4. Direct sparse-coordinate projection equals full-grid projection indexed by coords.
const coords = new Int32Array([0, 0, 1, 1, 0, 0, 1, 1, 1]);
const sparseOut = projectPixal3dGridCpu({
  features: fmap2,
  gridResolution: 2,
  imageResolution: 512,
  featureHeight: 4,
  featureWidth: 4,
  channels: 3,
  prefixTokens: 0,
  coordinates: coords,
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  distance: dDefault,
  meshScale: 1.0,
});
const expectedIndices = [1, 4, 7];
for (let row = 0; row < 3; row++) {
  const fullRow = cpuOut.projected.subarray(expectedIndices[row] * 3, (expectedIndices[row] + 1) * 3);
  const sparseRow = sparseOut.projected.subarray(row * 3, (row + 1) * 3);
  assert.deepEqual([...sparseRow], [...fullRow]);
}

// 5. Resident WebGPU adapter custody, dispatch, and numerical parity with LR + HR features.
const prefixTokens = 2;
const condData = Float32Array.from({ length: (prefixTokens + 4 * 4) * 3 }, (_, i) =>
  i < prefixTokens * 3 ? -(i + 1) : (i - prefixTokens * 3) / 48.0,
);
const hrBchw = Float32Array.from({ length: 2 * 4 * 4 }, (_, i) => (i + 1) / 32.0);
const allocated = [], uploads = [], dispatches = [];
const runtime = {
  device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) {
    const count = spec.shape.reduce((a, b) => a * b, 1);
    const t = {
      ...spec,
      byteLength: count * 4,
      data: spec.dtype === 'i32' ? new Int32Array(count) : new Float32Array(count),
      buffer: { destroy() { t.destroyed = true; } },
    };
    allocated.push(t);
    return t;
  },
  uploadTensor(tensor, values) {
    uploads.push({ tensor, values: values.slice() });
    tensor.data.set(values);
  },
  defineComputeKernel(spec) {
    const shaderBindings = [...spec.code.matchAll(/@binding\((\d+)\)/g)].map(m => Number(m[1]));
    assert.deepEqual(
      shaderBindings,
      spec.bindings.map((_, i) => i),
      `shader @binding indices must match host bindings for ${spec.name}`,
    );
    return spec;
  },
  async runKernel(kernel, options) {
    dispatches.push({ kernel, options });
  },
  readTensor() {
    assert.fail('Serving projection adapter must not read back GPU tensors.');
  },
};

const conditioningTensor = runtime.createTensor({
  name: 'dino.conditioning',
  shape: [1, prefixTokens + 16, 3],
  dtype: 'f32',
  usage: U.storage,
});
conditioningTensor.data.set(condData);
const highResTensor = runtime.createTensor({
  name: 'naf.highres',
  shape: [1, 2, 4, 4],
  dtype: 'f32',
  usage: U.storage,
});
highResTensor.data.set(hrBchw);
const coordinateTensor = runtime.createTensor({
  name: 'occupancy.coords',
  shape: [3, 3],
  dtype: 'i32',
  usage: U.storage,
});
coordinateTensor.data.set(coords);
const producerSet = new Set([conditioningTensor, highResTensor, coordinateTensor]);

// 5a. Dense ProjGrid adapter (no tokenRows, no highRes) must generate 3 bindings without coords.
{
  const denseAdapter = createPixal3dProjGridAdapter({
    route: { runtime, routeId: 'pixal3d-dense-test' },
    config: {
      gridResolution: 2,
      imageResolution: 512,
      featureHeight: 4,
      featureWidth: 4,
      channels: 3,
      prefixTokens,
    },
    conditioningTensor,
  });
  assert.equal(denseAdapter.plan.tokenRows, null);
  await denseAdapter.run({ cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD, distance: dDefault, meshScale: 1.0 });
  const sampleKernel = dispatches.find(d => d.options.stage === 'pixal3d-proj-grid-sample').kernel;
  assert.equal(sampleKernel.bindings.length, 3);
  assert.doesNotMatch(sampleKernel.code, /\bcoords\b/);
  denseAdapter.dispose();
  dispatches.length = 0;
}

const adapter = createPixal3dProjGridAdapter({
  route: { runtime, routeId: 'pixal3d-test' },
  config: {
    gridResolution: 2,
    imageResolution: 512,
    featureHeight: 4,
    featureWidth: 4,
    channels: 3,
    highResFeatureHeight: 4,
    highResFeatureWidth: 4,
    highResChannels: 2,
    tokenRows: 3,
    prefixTokens,
  },
  conditioningTensor,
  highResTensor,
  coordinateTensor,
});

const invocation = { jobId: 'proj-grid-job' };
const outputs = await adapter.run(
  { cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD, distance: dDefault, meshScale: 1.0 },
  invocation,
);
assert.equal(outputs.globalConditioning, adapter.outputs.globalConditioning);
assert.equal(outputs.projectedConditioning, adapter.outputs.projectedConditioning);
assert.deepEqual(outputs.globalConditioning.shape, [2, 3]);
assert.deepEqual(outputs.projectedConditioning.shape, [3, 5]);
assert.deepEqual(dispatches.map(d => d.options.stage), adapter.plan.stages);
assert.ok(dispatches.every(d => d.options.schedulerInvocation === invocation));

adapter.dispose();
assert.ok(allocated.filter(t => !producerSet.has(t)).every(t => t.destroyed));
assert.ok([...producerSet].every(t => !t.destroyed));
await assert.rejects(() => adapter.run({ cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD }), /disposed/);

// 6. Optional live WebGPU execution check (--chrome <executable>)
const chromeIdx = process.argv.indexOf('--chrome');
if (chromeIdx >= 0 && process.argv[chromeIdx + 1]) {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const http = await import('node:http');
  const os = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const chromePath = process.argv[chromeIdx + 1];
  const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/run.html') {
      res.writeHead(200, { 'content-type': mime['.html'] });
      res.end('<!doctype html><title>proj-grid-webgpu</title>');
      return;
    }
    const fp = path.join(rootDir, u.pathname);
    try {
      const data = await fs.readFile(fp);
      res.writeHead(200, { 'content-type': mime[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pixal3d-proj-gpu-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--use-mock-keychain',
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', d => {
      stderr += d.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve(m[1]);
    });
    child.once('exit', code => reject(new Error(`Chrome exited ${code}: ${stderr}`)));
  });
  const targets = await (await fetch(`http://${new URL(wsUrl).host}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://')) || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    const handler = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/run.html` });
  const evalRes = await cdp('Runtime.evaluate', {
    expression: `(async () => {
      const { createWebGpuInferenceRuntime, WEBGPU_BUFFER_USAGE: U } =
        await import('http://127.0.0.1:${port}/webgpu-inference-kit/src/core.js');
      const {
        PIXAL3D_DEFAULT_FOV_RAD,
        computePixal3dDistanceFromFov,
        projectPixal3dGridCpu,
        createPixal3dProjGridAdapter,
      } = await import('http://127.0.0.1:${port}/models/pixal3d/proj-grid.js');
      const runtime = await createWebGpuInferenceRuntime({
        routeId: 'webgpu-proj-test',
        gpu: navigator.gpu,
      });
      const device = runtime.device;
      const prefixTokens = 2;
      const condData = new Float32Array((prefixTokens + 16) * 3);
      for (let i = 0; i < condData.length; i++) condData[i] = (i + 1) * 0.125;
      const hrBchw = new Float32Array(2 * 4 * 4);
      for (let i = 0; i < hrBchw.length; i++) hrBchw[i] = (i + 1) * 0.25;
      const coords = new Int32Array([0, 0, 0, 1, 1, 1, 0, 1, 1]);
      const condTensor = runtime.createTensor({
        name: 'dino.cond',
        shape: [1, prefixTokens + 16, 3],
        dtype: 'f32',
        usage: U.storage | U.copyDst | U.copySrc,
      });
      runtime.uploadTensor(condTensor, condData);
      const hrTensor = runtime.createTensor({
        name: 'naf.hr',
        shape: [1, 2, 4, 4],
        dtype: 'f32',
        usage: U.storage | U.copyDst | U.copySrc,
      });
      runtime.uploadTensor(hrTensor, hrBchw);
      const coordTensor = runtime.createTensor({
        name: 'occ.coords',
        shape: [3, 3],
        dtype: 'i32',
        usage: U.storage | U.copyDst | U.copySrc,
      });
      runtime.uploadTensor(coordTensor, coords);
      const dDefault = computePixal3dDistanceFromFov({ cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD, meshScale: 1.0, imageResolution: 512 });

      device.pushErrorScope('validation');
      const denseAdapter = createPixal3dProjGridAdapter({
        route: { runtime, routeId: 'webgpu-dense-proj' },
        config: {
          gridResolution: 2,
          imageResolution: 512,
          featureHeight: 4,
          featureWidth: 4,
          channels: 3,
          prefixTokens,
        },
        conditioningTensor: condTensor,
      });
      const denseOut = await denseAdapter.run({
        cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
        distance: dDefault,
        meshScale: 1.0,
      });
      const sparseAdapter = createPixal3dProjGridAdapter({
        route: { runtime, routeId: 'webgpu-sparse-proj' },
        config: {
          gridResolution: 2,
          imageResolution: 512,
          featureHeight: 4,
          featureWidth: 4,
          channels: 3,
          highResFeatureHeight: 4,
          highResFeatureWidth: 4,
          highResChannels: 2,
          tokenRows: 3,
          prefixTokens,
        },
        conditioningTensor: condTensor,
        highResTensor: hrTensor,
        coordinateTensor: coordTensor,
      });
      const sparseOut = await sparseAdapter.run({
        cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
        distance: dDefault,
        meshScale: 1.0,
      });
      const validationError = await device.popErrorScope();
      const denseGlobal = Array.from(new Float32Array(await runtime.readTensor(denseOut.globalConditioning)));
      const denseProjected = Array.from(new Float32Array(await runtime.readTensor(denseOut.projectedConditioning)));
      const sparseProjected = Array.from(new Float32Array(await runtime.readTensor(sparseOut.projectedConditioning)));
      denseAdapter.dispose();
      sparseAdapter.dispose();
      condTensor.buffer.destroy();
      hrTensor.buffer.destroy();
      coordTensor.buffer.destroy();
      return {
        validationError: validationError ? validationError.message : null,
        denseGlobal,
        denseProjected,
        sparseProjected,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise(r => child.once('exit', r));
  ws.close();
  child.kill('SIGTERM');
  await exited;
  server.closeAllConnections?.();
  server.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (evalRes.exceptionDetails) {
    throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text);
  }
  const gpuRes = evalRes.result.value;
  assert.equal(gpuRes.validationError, null, `WebGPU validation error: ${gpuRes.validationError}`);
  const gpuCondData = Float32Array.from({ length: (prefixTokens + 16) * 3 }, (_, i) => (i + 1) * 0.125);
  const gpuHrBchw = Float32Array.from({ length: 2 * 4 * 4 }, (_, i) => (i + 1) * 0.25);
  const gpuCoords = new Int32Array([0, 0, 0, 1, 1, 1, 0, 1, 1]);
  const cpuDense = projectPixal3dGridCpu({
    features: gpuCondData,
    gridResolution: 2,
    imageResolution: 512,
    featureHeight: 4,
    featureWidth: 4,
    channels: 3,
    prefixTokens,
    cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
    distance: dDefault,
    meshScale: 1.0,
  }).projected;
  const cpuSparse = projectPixal3dGridCpu({
    features: gpuCondData,
    highResFeatures: gpuHrBchw,
    gridResolution: 2,
    imageResolution: 512,
    featureHeight: 4,
    featureWidth: 4,
    channels: 3,
    highResFeatureHeight: 4,
    highResFeatureWidth: 4,
    highResChannels: 2,
    prefixTokens,
    coordinates: gpuCoords,
    cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
    distance: dDefault,
    meshScale: 1.0,
  }).projected;
  assert.deepEqual(gpuRes.denseGlobal, Array.from(gpuCondData.subarray(0, prefixTokens * 3)));
  assert.equal(gpuRes.denseProjected.length, cpuDense.length);
  for (let i = 0; i < cpuDense.length; i++) {
    assert.ok(Math.abs(gpuRes.denseProjected[i] - cpuDense[i]) <= 1e-6, `dense mismatch at ${i}`);
  }
  assert.equal(gpuRes.sparseProjected.length, cpuSparse.length);
  for (let i = 0; i < cpuSparse.length; i++) {
    assert.ok(Math.abs(gpuRes.sparseProjected[i] - cpuSparse[i]) <= 1e-6, `sparse mismatch at ${i}`);
  }
  console.log('Pixal3D ProjGrid real WebGPU dense & sparse execution pass.');
}

console.log('Pixal3D ProjGrid camera distance, dense/sparse 3D-to-2D bilinear projection, and GPU custody pass.');
