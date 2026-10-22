// WiLoR hand detector model port for the Kaminos WebGPU inference kit. A kit
// route loads and verifies the packed weights; the network stays resident and
// each detection letterboxes a source texture, runs the detector, reads back
// the decoded head and returns hand boxes in source pixels.
import { defineWebGpuModelResourceManifest } from '../../webgpu-inference-kit/src/core.js';
import { createHandDetectorNetwork } from './detector-network.js';
import { createDetectorLetterbox } from './detector-letterbox.js';
import { decodeDetections } from './detections.js';

export const HAND_DETECTOR_ROUTE_ID = 'wilor.hand-detector.webgpu-local.v0';
export const HAND_DETECTOR_PACKAGE_SCHEMA = 'wilor-hand-detector.browser-weight-package.v0';

export async function loadHandDetector({ route, packageUrl, signal, onProgress } = {}) {
  if (!route?.runtime?.device || typeof route.loadModelResourcesFromSource !== 'function') {
    throw new Error('hand detector requires a registered kit session route');
  }
  const base = new URL(packageUrl.endsWith('/') ? packageUrl : `${packageUrl}/`, globalThis.location?.href);
  const response = await fetch(new URL('package.json', base), { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`hand detector package: HTTP ${response.status}`);
  const weightPackage = await response.json();
  if (weightPackage.schema !== HAND_DETECTOR_PACKAGE_SCHEMA || weightPackage.status !== 'succeeded') {
    throw new Error(`hand detector package must be a succeeded ${HAND_DETECTOR_PACKAGE_SCHEMA}`);
  }
  const [row] = weightPackage.resources;
  const started = performance.now();
  const lease = await route.loadModelResourcesFromSource({
    manifest: defineWebGpuModelResourceManifest(row.manifest), source: new URL(row.file, base), signal,
    onProgress: event => onProgress?.({ phase: 'weights', loadedBytes: event.loadedBytes, totalBytes: event.totalBytes }),
  });
  try {
    const device = route.runtime.device;
    const network = createHandDetectorNetwork({ device, tensors: lease.tensors });
    const letterbox = createDetectorLetterbox({ device, input: network.input });
    const identity = Object.freeze({
      routeId: HAND_DETECTOR_ROUTE_ID, backend: 'webgpu-local', modelId: row.manifest.modelId,
      revision: weightPackage.revision, dtype: weightPackage.dtype, bundleSha256: row.manifest.bundle.sha256,
      provenance: weightPackage.provenance, dispatchCount: network.dispatchCount, loadMs: performance.now() - started,
    });
    let released = false;
    return Object.freeze({
      identity, network, letterbox, tensors: lease.tensors,
      // Letterbox + detector in the caller's encoder (no readback).
      encode(encoder, { texture }) {
        letterbox.encode(encoder, { texture });
        network.encode(encoder);
      },
      // texture: RGBA8 source. Returns detections in source pixels.
      async detect({ texture, threshold = 0.3, iouThreshold = 0.5 }) {
        const encoder = device.createCommandEncoder({ label: 'hand-detector:detect' });
        this.encode(encoder, { texture });
        const bytes = network.output.shape[0] * network.output.shape[1] * 4;
        const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        encoder.copyBufferToBuffer(network.output.buffer, 0, staging, 0, bytes);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const output = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        staging.destroy();
        return decodeDetections(output, { width: texture.width, height: texture.height, threshold, iouThreshold });
      },
      release() {
        if (released) return;
        released = true;
        letterbox.dispose();
        network.dispose();
        lease.release();
      },
    });
  } catch (error) {
    lease.release();
    throw error;
  }
}
