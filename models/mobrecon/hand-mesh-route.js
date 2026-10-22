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
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, offset, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Type(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return out;
}

// session: a kit inference session (for example the page's app GPU host session).
export async function createBrowserHandMeshRoute({ session, mobreconPackageUrl, detectorPackageUrl, signal, onProgress } = {}) {
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
    const mobreconRoute = await session.registerRoute({ routeId: MOBRECON_ROUTE_ID });
    registered.push(MOBRECON_ROUTE_ID);
    const detectorRoute = await session.registerRoute({ routeId: HAND_DETECTOR_ROUTE_ID });
    registered.push(HAND_DETECTOR_ROUTE_ID);
    device = mobreconRoute.runtime.device;
    if (detectorRoute.runtime.device !== device) throw new Error('detector and MobRecon routes must share one device');
    mobrecon = await loadMobRecon({ route: mobreconRoute, packageUrl: mobreconPackageUrl, signal,
      onProgress: event => onProgress?.({ model: 'mobrecon', ...event }) });
    detector = await loadHandDetector({ route: detectorRoute, packageUrl: detectorPackageUrl, signal,
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
    async infer({ source, width, height, handedness, acquisition }) {
      if (released) throw new Error('browser hand mesh route released');
      if (busy) throw new Error('browser hand mesh route already has an inference in flight');
      if (!['left', 'right'].includes(handedness)) throw new Error('handedness must be left or right');
      const { mode, padding = 1.4, threshold = 0.18, manualBox } = acquisition ?? {};
      if (!['detector', 'manual'].includes(mode)) throw new Error('acquisition mode must be detector or manual');
      busy = true;
      try {
        const t0 = performance.now();
        const texture = upload(source, width, height);
        const result = { identity, handedness, interactionAuthority: false, authority: 'browser_webgpu_diagnostic_not_interaction',
          acquisition: { mode, padding, threshold, detections: [], selectedDetection: null, fallback: false, source: 'operator_selected_crop_no_detector' } };
        let box = manualBox;
        if (mode === 'detector') {
          const detections = await detector.detect({ texture, threshold });
          result.acquisition.detections = detections;
          result.timings = { detectorMs: performance.now() - t0 };
          if (detections.length) {
            result.acquisition.selectedDetection = 0;  // highest confidence first
            result.acquisition.source = 'wilor_yolo_detector_bbox_only';
            box = squareCrop(detections[0].bbox, padding);
          } else {
            result.acquisition.fallback = true;
            result.acquisition.source = 'manual_crop_fallback_no_detection';
          }
        }
        if (!box) throw new Error('no crop box: manual box required');
        result.cropBox = box;
        const t1 = performance.now();
        const encoder = device.createCommandEncoder({ label: 'hand-mesh:mobrecon' });
        crop.encode(encoder, { texture, box, handedness });
        mobrecon.network.encode(encoder);
        device.queue.submit([encoder.finish()]);
        const { mesh, uv } = mobrecon.network.outputs;
        const [vertices, landmarks] = await Promise.all([read(device, mesh.buffer, mesh.offset * 4, 778 * 12), read(device, uv.buffer, uv.offset * 4, 21 * 8)]);
        if (!vertices.every(Number.isFinite) || !landmarks.every(Number.isFinite)) throw new Error('non-finite MobRecon output');
        Object.assign(result, prediction(vertices, landmarks, handedness));
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
