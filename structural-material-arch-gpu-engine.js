import { PhysicsEngine } from './vendor/webphysics/src/physics/PhysicsEngine.ts';

export const ENGINE_REVISION = '96b043c88dc2a4af5367820caf1e1e9f458d5560';
export const ENGINE_PATCH = 'kaminos-fixed-joint-rest-relative-v1';

// This adapter deliberately binds to the recorded upstream revision's buffer ABI.
export class ArchGpuEngine extends PhysicsEngine {
  getStats() { return { ...this.stats }; }

  getResidentAttributes() {
    if (!this.initialized) throw new Error('GPU engine has not been initialized');
    return { positions: this.positionsAttr, quaternions: this.quaternionsAttr,
      velocities: this.velocitiesAttr, angularVelocities: this.angularVelAttr,
      joints: this.jointRecordsAttr, springs: this.springRecordsAttr };
  }

  setInitialJointActive(index, active) {
    if (this.initialized) throw new Error('Initial joint edits cannot overwrite resident state');
    if (!Number.isInteger(index) || index < 0 || index >= this.jointCount) throw new Error('Invalid joint index');
    new Uint32Array(this.jointRecordsData.buffer)[index * 44 + 3] = active ? 1 : 0;
  }

  setGravity(gravity) {
    if (!Array.isArray(gravity) || gravity.length !== 3 || gravity.some(value => !Number.isFinite(value))) throw new Error('Gravity requires three finite components');
    if (this.initialized) {
      const uniform = this.integration?.kernel?.computeNode?.parameters?.gravity;
      if (!uniform?.value?.isVector3) throw new Error('Pinned integration gravity uniform is unavailable');
      uniform.value.set(...gravity);
    }
    this.config.gravity = [...gravity];
  }

  getGravity() {
    if (!this.initialized) return [...this.config.gravity];
    const uniform = this.integration?.kernel?.computeNode?.parameters?.gravity;
    if (!uniform?.value?.isVector3) throw new Error('Pinned integration gravity uniform is unavailable');
    return uniform.value.toArray();
  }
}

export async function createNativeGpuRenderer(canvas) {
  const { WebGPURenderer } = await import('three/webgpu');
  if (!navigator.gpu) throw new Error('WebGPU is unavailable; no CPU fallback is permitted');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || (adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) !== false) throw new Error('A verified native WebGPU adapter is required');
  const info = adapter.info;
  const identity = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'backend', 'type', 'isFallbackAdapter'].map(key => [key, info?.[key] ?? null]));
  if (/swiftshader|llvmpipe|software/i.test(JSON.stringify(identity))) throw new Error('Software adapter rejected');
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage } });
  const renderer = new WebGPURenderer({ canvas, device, antialias: true });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('WebGL fallback rejected');
  return { renderer, device, identity: { ...identity, engineRevision: ENGINE_REVISION, enginePatch: ENGINE_PATCH, backend: 'webgpu', adapterFallback: false } };
}
