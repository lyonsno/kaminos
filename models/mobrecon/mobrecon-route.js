// MobRecon model port for the Kaminos WebGPU inference kit. A registered kit
// route loads and verifies the packed weights and decoder topology once; the
// network's buffers, pipelines and bind groups then stay resident, and each
// inference maps one normalized 128x128 hand crop to 778 mesh vertices and 21
// crop-space landmarks.
import { defineWebGpuModelResourceManifest } from '../../webgpu-inference-kit/src/core.js';
import { createMobReconNetwork, MOBRECON_LANDMARKS, MOBRECON_VERTICES } from './mobrecon-network.js';

export const MOBRECON_ROUTE_ID = 'mobrecon.crop-to-hand-mesh.webgpu-local.v0';
export const MOBRECON_PACKAGE_SCHEMA = 'mobrecon.browser-weight-package.v0';

async function readU32(device, tensor) {
  const staging = device.createBuffer({ size: tensor.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(tensor.buffer, tensor.bufferOffset, staging, 0, tensor.byteLength);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const values = new Uint32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return values;
}

// route: a kit session route (session.registerRoute). packageUrl: directory
// holding package.json and the bundle written by pack-weights.py.
export async function loadMobRecon({ route, packageUrl, signal, onProgress } = {}) {
  if (!route?.runtime?.device || typeof route.loadModelResourcesFromSource !== 'function') {
    throw new Error('MobRecon requires a registered kit session route');
  }
  const base = new URL(packageUrl.endsWith('/') ? packageUrl : `${packageUrl}/`, globalThis.location?.href);
  const response = await fetch(new URL('package.json', base), { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`MobRecon package: HTTP ${response.status}`);
  const weightPackage = await response.json();
  if (weightPackage.schema !== MOBRECON_PACKAGE_SCHEMA || weightPackage.status !== 'succeeded') {
    throw new Error(`MobRecon package must be a succeeded ${MOBRECON_PACKAGE_SCHEMA}`);
  }
  if (weightPackage.resources?.length !== 1) throw new Error('MobRecon package must hold exactly one resource bundle');
  const [row] = weightPackage.resources;
  const started = performance.now();
  const lease = await route.loadModelResourcesFromSource({
    manifest: defineWebGpuModelResourceManifest(row.manifest), source: new URL(row.file, base), signal,
    onProgress: event => onProgress?.({ phase: 'weights', loadedBytes: event.loadedBytes, totalBytes: event.totalBytes }),
  });
  try {
    const device = route.runtime.device;
    const network = createMobReconNetwork({ device, tensors: lease.tensors });
    const faces = await readU32(device, lease.tensors['topology.faces']);
    if (faces.length !== 1538 * 3 || faces.some(v => v >= MOBRECON_VERTICES) || new Set(faces).size !== MOBRECON_VERTICES) {
      throw new Error('MobRecon faces must index all 778 vertices in 1538 triangles');
    }
    const identity = Object.freeze({
      routeId: MOBRECON_ROUTE_ID, backend: 'webgpu-local', modelId: row.manifest.modelId,
      revision: weightPackage.revision, dtype: weightPackage.dtype, bundleSha256: row.manifest.bundle.sha256,
      provenance: weightPackage.provenance, dispatchCount: network.dispatchCount,
      loadMs: performance.now() - started,
    });
    let released = false;
    return Object.freeze({
      identity, network, faces,
      vertexCount: MOBRECON_VERTICES, landmarkCount: MOBRECON_LANDMARKS,
      release() {
        if (released) return;
        released = true;
        network.dispose();
        lease.release();
      },
    });
  } catch (error) {
    lease.release();
    throw error;
  }
}
