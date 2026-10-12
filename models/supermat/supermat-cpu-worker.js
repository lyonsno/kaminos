// One-shot CPU phases for SuperMat, run through the kit worker-phase protocol so
// Pillow-exact preprocessing and 8-bit map packing stay off the render thread.
import { WEBGPU_WORKER_PHASE_RESULT_SCHEMA } from '../../webgpu-inference-kit/src/worker-phase.js';
import { preprocessForSuperMat, resizeRgbaBilinear } from './supermat-preprocess.js';
import { mapsFromPlanes } from './supermat-maps.js';

export const SUPERMAT_CPU_WORKER_MODULE = 'supermat.cpu-phases.v0';

self.onmessage = event => {
  const { executionId, operationId, moduleId, payload } = event.data ?? {};
  const identity = { executionId, operationId, moduleId };
  try {
    let output, transfer;
    if (operationId === 'supermat.preprocess') {
      const image = { width: payload.width, height: payload.height, data: new Uint8Array(payload.data) };
      const planes = preprocessForSuperMat(image, payload.size);
      const resized = resizeRgbaBilinear(image, payload.size, payload.size);
      const alpha = new Uint8ClampedArray(payload.size * payload.size);
      for (let i = 0; i < alpha.length; i++) alpha[i] = resized.data[i * 4 + 3];
      output = { planes: planes.buffer, alpha: alpha.buffer };
      transfer = [planes.buffer, alpha.buffer];
    } else if (operationId === 'supermat.maps') {
      const maps = mapsFromPlanes(new Float32Array(payload.albedo), new Float32Array(payload.orm), payload.size);
      output = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, map.data.buffer]));
      transfer = Object.values(output);
    } else {
      throw new Error(`unknown SuperMat CPU operation ${operationId}`);
    }
    self.postMessage({ schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA, ...identity, status: 'completed', output }, transfer);
  } catch (error) {
    self.postMessage({ schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA, ...identity, status: 'failed',
      error: { name: error?.name || 'Error', message: error?.message || String(error) } });
  }
};
