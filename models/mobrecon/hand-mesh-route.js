// Browser hand mesh route: one camera frame through the WiLoR hand detector,
// a square crop around the highest-confidence hand (or a caller's manual box),
// and MobRecon, all on one WebGPU device through a kit session. Results follow
// the native live route's prediction format (hand-state-runtime
// mobrecon_diagnostic.prediction): native vertices and crop landmarks, plus
// vertices in meters (0.2 m per model unit) and crop landmarks reflected for a
// left hand. Diagnostic output: no interaction authority.
import { loadMobRecon, MOBRECON_ROUTE_ID } from './mobrecon-route.js';
import { createMobReconCrop } from './mobrecon-crop.js';
import { HAND_DETECTOR_ROUTE_ID, loadHandDetector } from '../wilor-hand-detector/detector-route.js';
import { squareCrop } from '../wilor-hand-detector/detections.js';

export const HAND_MESH_ROUTE_ID = 'kaminos.browser-hand-mesh.webgpu-local.v0';
const METERS_PER_UNIT = 0.2;

function prediction(vertices, uv, handedness) {
  const meters = new Float32Array(vertices.length), cropUV = new Float32Array(uv);
  for (let i = 0; i < vertices.length; i++) meters[i] = vertices[i] * METERS_PER_UNIT * (handedness === 'left' && i % 3 === 0 ? -1 : 1);
  if (handedness === 'left') for (let i = 0; i < cropUV.length; i += 2) cropUV[i] = 1 - cropUV[i];
  return { nativeVertices: vertices, nativeUV: uv, verticesMeters: meters, cropUV };
}

async function read(device, buffer, offset, bytes, Type = Float32Array) {
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, offset, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    mapped = true;
    return new Type(staging.getMappedRange().slice(0));
  } finally {
    try { if (mapped) staging.unmap(); } finally { staging.destroy(); }
  }
}

// session: a kit inference session (for example the page's app GPU host session).
export async function createBrowserHandMeshRoute({ session, routeId, mobreconPackageUrl, detectorPackageUrl, mobreconPackageSource, detectorPackageSource, signal, onProgress } = {}) {
  const registered = [];
  let mobrecon, detector, crop;
  // Leases first, then the routes, so the shared session can host this route again.
  const teardown = () => {
    crop?.dispose();
    detector?.release();
    mobrecon?.release();
    for (const routeId of registered.reverse()) session.unregisterRoute(routeId);
  };
  let device;
  try {
    const mobreconRoute = await session.registerRoute({ routeId: routeId ? `${routeId}:mobrecon` : MOBRECON_ROUTE_ID });
    registered.push(routeId ? `${routeId}:mobrecon` : MOBRECON_ROUTE_ID);
    const detectorRoute = await session.registerRoute({ routeId: routeId ? `${routeId}:detector` : HAND_DETECTOR_ROUTE_ID });
    registered.push(routeId ? `${routeId}:detector` : HAND_DETECTOR_ROUTE_ID);
    device = mobreconRoute.runtime.device;
    if (detectorRoute.runtime.device !== device) throw new Error('detector and MobRecon routes must share one device');
    mobrecon = await loadMobRecon({ route: mobreconRoute, packageUrl: mobreconPackageUrl, packageSource: mobreconPackageSource, signal,
      onProgress: event => onProgress?.({ model: 'mobrecon', ...event }) });
    detector = await loadHandDetector({ route: detectorRoute, packageUrl: detectorPackageUrl, packageSource: detectorPackageSource, signal,
      onProgress: event => onProgress?.({ model: 'hand-detector', ...event }) });
    crop = createMobReconCrop({ device, input: mobrecon.network.input });
  } catch (error) {
    teardown();
    throw error;
  }
  let frame = null, busy = false, released = false;
  const identity = Object.freeze({ routeId: HAND_MESH_ROUTE_ID, backend: 'webgpu-local', device: 'browser-gpu',
    mobrecon: mobrecon.identity, detector: detector.identity, interactionAuthority: false });

  // Copies a camera/video/image source into an RGBA8 texture of its size.
  function upload(source, width, height) {
    if (!frame || frame.width !== width || frame.height !== height) {
      frame?.destroy();
      frame = device.createTexture({ label: 'hand-mesh:frame', size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    }
    device.queue.copyExternalImageToTexture({ source }, { texture: frame }, [width, height]);
    return frame;
  }

  return Object.freeze({
    identity, faces: mobrecon.faces,
    // source: anything copyExternalImageToTexture accepts (video element,
    // VideoFrame, ImageBitmap, canvas), unmirrored camera pixels.
    // acquisition: { mode: 'detector' | 'manual', padding, threshold, manualBox }.
    // In detector mode a frame without a detection falls back to manualBox,
    // reported as such. handedness chooses the MobRecon input flip; the
    // detector's class is reported, not applied.
    // capture: opt-in named network views; offsets are float32 element offsets.
    async infer({ source, width, height, handedness, acquisition, schedule = null, capture = [] }) {
      if (released) throw new Error('browser hand mesh route released');
      if (busy) throw new Error('browser hand mesh route already has an inference in flight');
      if (!Array.isArray(capture) || capture.some(name => typeof name !== 'string')) throw new TypeError('capture must be an array of tensor name strings');
      if (new Set(capture).size !== capture.length) throw new Error('capture must not contain duplicate tensor names');
      const captureViews = capture.map(name => {
        const view = mobrecon.network.view(name);
        if (!view) throw new Error(`no MobRecon tensor named ${name}`);
        return { name, buffer: view.buffer, offset: view.offset, shape: [...view.shape] };
      });
      if (!['left', 'right'].includes(handedness)) throw new Error('handedness must be left or right');
      const { mode, padding = 1.4, threshold = 0.18, manualBox, onMiss = 'manual' } = acquisition ?? {};
      if (!['detector', 'manual'].includes(mode)) throw new Error('acquisition mode must be detector or manual');
      if (!['skip', 'manual'].includes(onMiss)) throw new Error('detector miss policy must be skip or manual');
      busy = true;
      try {
        const t0 = performance.now();
        let texture;
        // Two actual model boundaries. Whole-network passes remain indivisible;
        // pause/cancellation and foreground work occur before either phase.
        const runPhase = (phase, work) => {
          if (!schedule) return work();
          return schedule.control.runDuty(async () => {
            const duty = await schedule.runtime.prepareCommandDutyAtBoundary({ phase, kind: 'compute' }, schedule.invocation);
            try {
              const result = await work();
              schedule.runtime.settleCommandDuty(duty, { status: 'encoded' });
              return result;
            } catch (error) {
              schedule.runtime.settleCommandDuty(duty, { status: 'failed', error });
              throw error;
            }
          });
        };
        const result = { identity, handedness, interactionAuthority: false, authority: 'browser_webgpu_diagnostic_not_interaction',
          acquisition: { mode, padding, threshold, detections: [], selectedDetection: null, fallback: false, source: 'operator_selected_crop_no_detector' } };
        if (captureViews.length) result.captures = {};
        let box = manualBox;
        if (mode === 'detector') {
          const detections = await runPhase('hand-detector', () => {
            texture = upload(source, width, height);
            return detector.detect({ texture, threshold });
          });
          result.acquisition.detections = detections;
          result.timings = { detectorMs: performance.now() - t0 };
          if (detections.length) {
            result.acquisition.selectedDetection = 0;  // highest confidence first
            result.acquisition.source = 'wilor_yolo_detector_bbox_only';
            box = squareCrop(detections[0].bbox, padding);
          } else {
            if (onMiss === 'skip') {
              result.acquisition.source = 'no_detection';
              result.hasHand = false;
              result.timings = { ...result.timings, mobreconMs: 0, totalMs: performance.now() - t0 };
              return result;
            }
            result.acquisition.fallback = true;
            result.acquisition.source = 'manual_crop_fallback_no_detection';
          }
        }
        if (!box) throw new Error('no crop box: manual box required');
        result.cropBox = box;
        const t1 = performance.now();
        const [vertices, landmarks] = await runPhase('mobrecon', async () => {
          texture ??= upload(source, width, height);
          const encoder = device.createCommandEncoder({ label: 'hand-mesh:mobrecon' });
          crop.encode(encoder, { texture, box, handedness });
          mobrecon.network.encode(encoder);
          device.queue.submit([encoder.finish()]);
          const { mesh, uv } = mobrecon.network.outputs;
          // Settle every map before releasing the busy guard, even on a failure.
          const outputs = await Promise.allSettled([read(device, mesh.buffer, mesh.offset * 4, 778 * 12), read(device, uv.buffer, uv.offset * 4, 21 * 8)]);
          const failed = outputs.find(output => output.status === 'rejected');
          if (failed) throw failed.reason;
          for (const { name, buffer, offset, shape } of captureViews) {
            const data = await read(device, buffer, offset * 4, shape.reduce((a, b) => a * b, 1) * 4);
            if (!data.every(Number.isFinite)) throw new Error(`non-finite MobRecon capture ${name}`);
            Object.defineProperty(result.captures, name, { value: { shape, data }, enumerable: true, configurable: true, writable: true });
          }
          return outputs.map(output => output.value);
        });
        if (!vertices.every(Number.isFinite) || !landmarks.every(Number.isFinite)) throw new Error('non-finite MobRecon output');
        Object.assign(result, prediction(vertices, landmarks, handedness));
        result.hasHand = true;
        result.timings = { ...result.timings, mobreconMs: performance.now() - t1, totalMs: performance.now() - t0 };
        return result;
      } finally {
        busy = false;
      }
    },
    // RGBA8 bytes of the last 128x128 network crop (after any left-hand flip).
    readCropBytes: () => read(device, crop.crop, 0, 128 * 128 * 4, Uint8Array),
    release() {
      if (released) return;
      released = true;
      frame?.destroy();
      teardown();
    },
  });
}
