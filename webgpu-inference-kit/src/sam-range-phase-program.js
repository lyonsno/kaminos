import { defineWebGpuPhaseProgram } from './phase-program.js';
import { WEBGPU_SHADER_STAGE } from './runtime-primitives.js';

function bufferType(binding) {
  if (binding.type === 'uniform') return 'uniform';
  return binding.access === 'read-only-storage' ? 'read-only-storage' : 'storage';
}

function bufferResource(binding) {
  const resource = binding.resource;
  if (!resource?.buffer) throw new Error(`binding ${binding.name} resource must expose buffer`);
  const entry = { buffer: resource.buffer };
  if (Number.isInteger(resource.bufferOffset) && resource.bufferOffset > 0) entry.offset = resource.bufferOffset;
  if (Number.isInteger(resource.byteLength) && resource.byteLength > 0) entry.size = resource.byteLength;
  return entry;
}

export function createSamRangePhaseRuntime(runtime, rangeCodes) {
  const allowed = new Set(rangeCodes);
  return {
    defineProgram(input) {
      // Only this construction owns these pipelines; bindings are already
      // resolved by the existing phase program, never by this SAM facade.
      const cache = new Map();
      return defineWebGpuPhaseProgram(input, { runtime: {
        ...runtime,
        defineComputeKernel(descriptor) {
          if (!allowed.has(descriptor.code) || Object.hasOwn(descriptor, 'shaderModuleDescriptor')) {
            return runtime.defineComputeKernel(descriptor);
          }
          if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) throw new Error('kernel name must be a non-empty string');
          if (!Array.isArray(descriptor.bindings) || descriptor.bindings.length === 0) throw new Error('kernel bindings must be a non-empty array');
          for (const binding of descriptor.bindings) {
            if (typeof binding.name !== 'string' || !binding.name.trim()) throw new Error('binding name must be a non-empty string');
          }
          const key = JSON.stringify([descriptor.entryPoint || 'main',
            descriptor.bindings.map(binding => [binding.visibility ?? WEBGPU_SHADER_STAGE.compute, bufferType(binding)])]);
          let codeCache = cache.get(descriptor.code);
          if (!codeCache) {
            codeCache = new Map();
            cache.set(descriptor.code, codeCache);
          }
          const previous = codeCache.get(key);
          if (!previous) {
            const kernel = runtime.defineComputeKernel(descriptor);
            codeCache.set(key, kernel);
            return kernel;
          }
          const bindGroup = runtime.device.createBindGroup({
            label: `${descriptor.name}.bind-group`,
            layout: previous.bindGroupLayout,
            entries: descriptor.bindings.map((binding, index) => ({ binding: index, resource: bufferResource(binding) })),
          });
          return {
            ...previous,
            name: descriptor.name,
            bindGroup,
            bindings: descriptor.bindings.map((binding, index) => ({ name: binding.name, binding: index, type: bufferType(binding) })),
            metadata: JSON.parse(JSON.stringify(descriptor.metadata || {})),
          };
        },
      } });
    },
  };
}
