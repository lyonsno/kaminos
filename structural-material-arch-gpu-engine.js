import { PhysicsEngine } from './vendor/webphysics/src/physics/PhysicsEngine.ts';

export const ENGINE_REVISION = '96b043c88dc2a4af5367820caf1e1e9f458d5560';
export const ENGINE_PATCH = 'kaminos-fixed-joint-rest-relative-v1';

// This adapter deliberately binds to the recorded upstream revision's buffer ABI.
export class ArchGpuEngine extends PhysicsEngine {
  constructor(device, config) {
    if (config.enableBvhBuild === true) throw new Error('Arch GPU ownership supports the all-pairs route, not asynchronous BVH construction');
    const buffers = new Set();
    const lifetime = { disposed: false };
    const ownedDevice = new Proxy(device, { get(target, key) {
      if (key === 'createBuffer') return descriptor => {
        if (lifetime.disposed) throw new Error('GPU engine is disposed');
        const buffer = target.createBuffer(descriptor); buffers.add(buffer); return buffer;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    super(ownedDevice, { ...config, enableBvhBuild: false });
    this.archOwnedBuffers = buffers;
    this.archLifetime = lifetime;
  }

  step(...args) {
    if (this.archLifetime.disposed) throw new Error('GPU engine is disposed');
    return super.step(...args);
  }

  dispose(renderer) {
    if (this.archLifetime.disposed) return;
    this.archLifetime.disposed = true;
    const errors = [];
    // The pinned stages share attributes; raw acquisition is tracked even if a stage constructor rejects.
    const owners = [this, this.integration, this.derivedInertia, this.contactGeneration, this.broadPhase, this.avbdState, this.playerControl];
    const attributes = new Set(owners.flatMap(owner => Object.values(owner ?? {}).filter(value => value?.isStorageBufferAttribute)));
    for (const buffer of this.archOwnedBuffers) try { buffer.destroy(); } catch (error) { errors.push(error); }
    for (const attribute of attributes) try {
      if (renderer.backend.get(attribute)?.buffer) renderer.backend.destroyAttribute(attribute);
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'GPU engine resource cleanup failed');
  }

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
