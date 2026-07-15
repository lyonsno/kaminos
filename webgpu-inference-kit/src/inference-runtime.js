import {
  createWebGpuBackendIdentity,
  requestBrowserWebGpuDevice,
} from './gpu-environment.js';
import {
  WEBGPU_INFERENCE_KIT_VERSION,
} from './kernel-profile.js';
import {
  WEBGPU_HOST_PHASE,
  createWebGpuHostPhaseRecorder,
} from './host-phase-recorder.js';
import {
  createWebGpuCommandDutyRecorder,
} from './command-duty-descriptor.js';
import {
  createWebGpuRuntimeProfile,
} from './runtime-profile.js';
import {
  addStagedSubmitStage,
  createStagedSubmitProfile,
  finishStagedSubmitProfile,
} from './staged-profile.js';
import {
  defineWebGpuPhaseProgram,
  runWebGpuPhaseProgram,
} from './phase-program.js';
import {
  WEBGPU_BUFFER_USAGE,
  assertTensorDataByteLength,
  createGpuTensor,
  createUniformBuffer as createRuntimeUniformBuffer,
  defineComputeKernel as defineRuntimeComputeKernel,
} from './runtime-primitives.js';

export const WEBGPU_INFERENCE_RUNTIME_SCHEMA = 'kaminos.webgpu-inference-runtime.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const GPU_OBJECT_IDENTITY_KEYS = new Set(['module', 'layout']);

function createObjectIdentityTracker() {
  const objectIds = new WeakMap();
  let nextObjectId = 1;

  return function getObjectId(value) {
    if (!objectIds.has(value)) {
      objectIds.set(value, nextObjectId);
      nextObjectId += 1;
    }
    return objectIds.get(value);
  };
}

function pipelineDescriptorKey(descriptor, getObjectId) {
  const seen = new WeakSet();
  return JSON.stringify(descriptor, (key, inner) => {
    if (typeof inner === 'function') return `[Function:${inner.name || 'anonymous'}]`;
    if (!inner || typeof inner !== 'object') return inner;
    if (GPU_OBJECT_IDENTITY_KEYS.has(key)) {
      return { __gpuObjectId: getObjectId(inner) };
    }
    if (seen.has(inner)) return '[Circular]';
    seen.add(inner);
    if (Array.isArray(inner)) return inner;
    const keys = Object.keys(inner);
    if (keys.length === 0) return { __objectId: getObjectId(inner) };
    const out = {};
    for (const objectKey of keys.sort()) out[objectKey] = inner[objectKey];
    return out;
  });
}

function normalizeKernel(input = {}) {
  return {
    kitVersion: input.kitVersion || WEBGPU_INFERENCE_KIT_VERSION,
    profile: input.profile,
    commit: input.commit || null,
  };
}

function normalizeBackendIdentity(input, context) {
  if (input.backendIdentity?.kind === 'webgpu-local') return clone(input.backendIdentity);
  if (context?.backendIdentity?.kind === 'webgpu-local') return clone(context.backendIdentity);

  const adapterName = input.adapterName || input.adapter?.info?.description || input.adapter?.info?.device;
  if (!isNonEmptyString(adapterName)) {
    throw new Error('adapter identity required when wrapping an existing device; provide backendIdentity, adapterName, or adapter.info');
  }

  return createWebGpuBackendIdentity({
    adapterName,
    browser: input.browser || globalThis.navigator?.userAgent || null,
    requestedFeatures: input.requestedFeatures || context?.deviceRequest?.requiredFeatures || [],
    effectiveFeatures: input.effectiveFeatures || input.device?.features || context?.device?.features || input.adapter?.features || [],
    limits: input.limits || input.device?.limits || context?.device?.limits || input.adapter?.limits || {},
    timestampQuery: input.timestampQuery || context?.deviceRequest?.timestampQuery || 'unavailable',
  });
}

export function createCooperativeYield(input = {}) {
  const yieldMs = input.yieldMs ?? 0;
  const sleep = input.sleep || defaultSleep;
  const queue = input.queue || null;
  const waitForSubmittedWorkDone = Boolean(input.waitForSubmittedWorkDone);
  const now = input.now || defaultNow;

  if (!Number.isFinite(yieldMs) || yieldMs < 0) {
    throw new Error('yieldMs must be a finite non-negative number');
  }

  return async function yieldToBrowser(metadata = {}) {
    const startMs = now();
    if (waitForSubmittedWorkDone && queue && typeof queue.onSubmittedWorkDone === 'function') {
      await queue.onSubmittedWorkDone();
    }
    await sleep(yieldMs);
    const endMs = now();
    return {
      reason: metadata.reason || 'cooperative-yield',
      waitForSubmittedWorkDone,
      requestedYieldMs: yieldMs,
      elapsedMs: Math.max(0, Math.round((endMs - startMs) * 10) / 10),
      metadata: clone(metadata.metadata || {}),
    };
  };
}

export function createWebGpuResourceCaches(device) {
  if (!device || typeof device !== 'object') throw new Error('device must be an object');

  const shaderModules = new Map();
  const computePipelines = new Map();
  const getObjectId = createObjectIdentityTracker();

  return {
    getShaderModule(label, code, descriptor = {}) {
      if (!isNonEmptyString(label)) throw new Error('shader module label must be a non-empty string');
      if (!isNonEmptyString(code)) throw new Error('shader module code must be a non-empty string');
      if (typeof device.createShaderModule !== 'function') throw new Error('device.createShaderModule must be available');

      const key = `${label}\u0000${code}`;
      if (!shaderModules.has(key)) {
        shaderModules.set(key, device.createShaderModule({
          ...descriptor,
          label,
          code,
        }));
      }
      return shaderModules.get(key);
    },

    getComputePipeline(label, descriptor) {
      if (!isNonEmptyString(label)) throw new Error('compute pipeline label must be a non-empty string');
      if (!descriptor || typeof descriptor !== 'object') throw new Error('compute pipeline descriptor must be an object');
      if (typeof device.createComputePipeline !== 'function') throw new Error('device.createComputePipeline must be available');

      const key = `${label}\u0000${pipelineDescriptorKey(descriptor, getObjectId)}`;
      if (!computePipelines.has(key)) {
        computePipelines.set(key, device.createComputePipeline({
          ...descriptor,
          label,
        }));
      }
      return computePipelines.get(key);
    },

    clear() {
      shaderModules.clear();
      computePipelines.clear();
    },

    sizes() {
      return {
        shaderModules: shaderModules.size,
        computePipelines: computePipelines.size,
      };
    },
  };
}

function createBuffer(device, descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new Error('buffer descriptor must be an object');
  if (!isNonEmptyString(descriptor.label)) throw new Error('buffer label must be a non-empty string');
  if (!Number.isInteger(descriptor.size) || descriptor.size < 0) throw new Error('buffer size must be a non-negative integer');
  if (!Number.isInteger(descriptor.usage) || descriptor.usage < 0) throw new Error('buffer usage must be a non-negative integer');
  if (typeof device.createBuffer !== 'function') throw new Error('device.createBuffer must be available');
  return device.createBuffer({ ...descriptor });
}

function byteLengthOf(data) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return null;
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function alignDown(value, alignment) {
  return Math.floor(value / alignment) * alignment;
}

function dataBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('data must be an ArrayBuffer or typed array view');
}

function tensorUploadData(tensor, data) {
  const logicalByteLength = assertTensorDataByteLength(tensor, data);
  const allocationByteLength = tensor.allocationByteLength ?? alignTo(logicalByteLength, 4);
  if (allocationByteLength === logicalByteLength && logicalByteLength % 4 === 0) return data;
  if (tensor.ownsBuffer !== true && tensor.paddingReserved !== true) {
    throw new Error('caller-owned tensor upload padding must be reserved before sub-4-byte padded writes');
  }
  const padded = new Uint8Array(allocationByteLength);
  padded.set(dataBytes(data));
  return padded;
}

function queueWriteBuffer(queue, buffer, data, offset = 0, dataOffset = 0, size = undefined) {
  if (!queue || typeof queue.writeBuffer !== 'function') throw new Error('queue.writeBuffer must be available');
  const byteLength = byteLengthOf(data);
  if (byteLength == null) throw new Error('writeBuffer data must be an ArrayBuffer or typed array view');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('writeBuffer offset must be a non-negative integer');
  queue.writeBuffer(buffer, offset, data, dataOffset, size);
}

async function readMappedBuffer(buffer, options = {}) {
  if (!buffer || typeof buffer.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
    throw new Error('buffer must support mapAsync and getMappedRange');
  }
  const mode = options.mapMode ?? globalThis.GPUMapMode?.READ ?? 1;
  await buffer.mapAsync(mode, options.offset || 0, options.size);
  const mapped = buffer.getMappedRange(options.offset || 0, options.size);
  const copy = mapped.slice(0);
  if (typeof buffer.unmap === 'function') buffer.unmap();
  return copy;
}

async function readMappedBufferSlice(buffer, options = {}) {
  const sourceOffset = options.sourceOffset ?? options.offset ?? 0;
  const logicalSize = options.size;
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0) {
    throw new Error('readBuffer sourceOffset must be a non-negative integer');
  }
  if (!Number.isInteger(logicalSize) || logicalSize < 0) {
    throw new Error('readBuffer size must be a non-negative integer');
  }
  const mapOffset = alignDown(sourceOffset, 8);
  const sliceOffset = sourceOffset - mapOffset;
  const mappedSize = alignTo(sliceOffset + logicalSize, 4);
  const mapped = await readMappedBuffer(buffer, {
    mapMode: options.mapMode,
    offset: mapOffset,
    size: mappedSize,
  });
  return mapped.slice(sliceOffset, sliceOffset + logicalSize);
}

async function readBufferViaStaging(runtime, tensor, options = {}) {
  const size = options.size ?? tensor.byteLength;
  const alignedSize = options.alignedSize ?? alignTo(size, 4);
  const sourceOffset = options.sourceOffset ?? options.offset ?? tensor.bufferOffset ?? 0;
  if (!Number.isInteger(size) || size < 0) throw new Error('readTensor size must be a non-negative integer');
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0) {
    throw new Error('readTensor sourceOffset must be a non-negative integer');
  }
  if (sourceOffset % 4 !== 0) throw new Error('readTensor sourceOffset must be a multiple of 4');
  if (Number.isInteger(tensor.usage) && (tensor.usage & WEBGPU_BUFFER_USAGE.copySrc) === 0) {
    throw new Error('readTensor requires tensor usage to include copySrc unless the tensor buffer is mapRead');
  }
  if (typeof runtime.device.createCommandEncoder !== 'function') {
    throw new Error('device.createCommandEncoder must be available for tensor readback');
  }
  if (typeof runtime.queue.submit !== 'function') {
    throw new Error('queue.submit must be available for tensor readback');
  }

  const staging = runtime.createBuffer({
    label: options.stagingLabel || `${tensor.name || 'tensor'}.readback`,
    size: alignedSize,
    usage: WEBGPU_BUFFER_USAGE.mapRead | WEBGPU_BUFFER_USAGE.copyDst,
  });
  const commandBuffer = await runOptionalHostPhase(
    runtime,
    WEBGPU_HOST_PHASE.commandEncoding,
    () => {
      const encoder = runtime.device.createCommandEncoder({
        label: options.encoderLabel || `${tensor.name || 'tensor'}.readback.encoder`,
      });
      if (typeof encoder.copyBufferToBuffer !== 'function') {
        throw new Error('command encoder must support copyBufferToBuffer for tensor readback');
      }
      encoder.copyBufferToBuffer(tensor.buffer, sourceOffset, staging, 0, alignedSize);
      return encoder.finish();
    },
    { detail: { operation: 'tensor-readback-copy', tensor: tensor.name || null } },
  );
  await runOptionalHostPhase(
    runtime,
    WEBGPU_HOST_PHASE.queueSubmission,
    () => runOptionalCommandDuty(runtime, {
      ...(options.commandDuty || {}),
      phase: options.commandDuty?.phase || `${tensor.name || 'tensor'}.readback`,
      kind: 'copy',
      metadata: {
        ...(options.commandDuty?.metadata || {}),
        operation: 'tensor-readback-copy',
        tensorName: tensor.name || null,
      },
    }, () => runtime.queue.submit([commandBuffer])),
    { detail: { operation: 'tensor-readback-copy', tensor: tensor.name || null } },
  );
  const mapped = await runOptionalHostPhase(
    runtime,
    WEBGPU_HOST_PHASE.readback,
    async () => {
      if (options.waitForSubmittedWorkDone === true && typeof runtime.queue.onSubmittedWorkDone === 'function') {
        await runtime.queue.onSubmittedWorkDone();
      }
      return readMappedBuffer(staging, {
        mapMode: options.mapMode,
        offset: 0,
        size: alignedSize,
      });
    },
    { detail: { operation: 'tensor-readback-map', tensor: tensor.name || null } },
  );
  return mapped.slice(0, size);
}

function runOptionalHostPhase(runtime, phase, fn, options = {}) {
  return runtime.hostPhases ? runtime.runHostPhase(phase, fn, options) : fn();
}

function runOptionalCommandDuty(runtime, descriptor, submit) {
  return runtime.commandDuties
    ? runtime.commandDuties.measureSubmission(descriptor, submit)
    : submit();
}

function createStageFacade(runtime, stageState, stageName, stageMetadata) {
  return {
    getShaderModule: runtime.getShaderModule,
    getComputePipeline: runtime.getComputePipeline,
    createBuffer: runtime.createBuffer,
    writeBuffer: runtime.writeBuffer,
    readBuffer: runtime.readBuffer,
    createTensor: runtime.createTensor,
    uploadTensor: runtime.uploadTensor,
    readTensor(tensor, options = {}) {
      return runtime.readTensor(tensor, {
        ...options,
        commandDuty: {
          ...(options.commandDuty || {}),
          phase: options.commandDuty?.phase || stageName,
          metadata: {
            ...(options.commandDuty?.metadata || {}),
            ...clone(stageMetadata),
          },
        },
      });
    },
    createUniformBuffer: runtime.createUniformBuffer,
    defineComputeKernel: runtime.defineComputeKernel,
    defineProgram: runtime.defineProgram,
    runProgram: runtime.runProgram,
    hostPhases: runtime.hostPhases,
    runHostPhase: runtime.runHostPhase,
    async yieldToBrowser(metadata = {}) {
      const event = await runtime.yieldToBrowser(metadata);
      stageState.yields.push(event);
      return event;
    },
  };
}

export async function createWebGpuInferenceRuntime(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('runtime input must be an object');
  if (!isNonEmptyString(input.routeId)) throw new Error('routeId must be a non-empty string');

  let context = null;
  if (input.device) {
    context = {
      adapter: input.adapter || null,
      device: input.device,
      deviceRequest: input.deviceRequest || null,
      backendIdentity: input.backendIdentity || null,
    };
  } else if (input.gpu) {
    context = await requestBrowserWebGpuDevice(input.gpu, input.deviceOptions || input);
  } else {
    throw new Error('createWebGpuInferenceRuntime requires either an existing device or a gpu request surface');
  }

  const device = context.device;
  const queue = input.queue || device?.queue;
  if (!device || typeof device !== 'object') throw new Error('device must be an object');
  if (!queue || typeof queue !== 'object') throw new Error('queue must be available on input or device.queue');

  const backendIdentity = normalizeBackendIdentity(input, context);
  const resourceCaches = input.resourceCaches || createWebGpuResourceCaches(device);
  const stagedProfile = createStagedSubmitProfile({
    route: input.routeId,
    timingSource: input.timingSource || 'host-stage-timer',
    requiredStages: input.requiredStages || [],
    timestampQueryValidatedAgainstStaged: Boolean(input.timestampQueryValidatedAgainstStaged),
  });
  const now = input.now || defaultNow;
  const yieldToBrowser = input.yield || createCooperativeYield({
    queue,
    yieldMs: input.yieldMs ?? 0,
    waitForSubmittedWorkDone: input.waitForSubmittedWorkDone,
    now,
  });
  const kernel = normalizeKernel(input.kernel);
  if (input.hostPhases != null && (!input.hostPhases || typeof input.hostPhases !== 'object')) {
    throw new TypeError('hostPhases must be an object when provided');
  }
  const hostPhases = input.hostPhases == null
    ? null
    : createWebGpuHostPhaseRecorder({
        ...input.hostPhases,
        routeId: input.routeId,
        now: input.hostPhases.now || now,
      });
  if (input.commandDuties != null && (!input.commandDuties || typeof input.commandDuties !== 'object')) {
    throw new TypeError('commandDuties must be an object when provided');
  }
  const commandDuties = input.commandDuties == null
    ? null
    : createWebGpuCommandDutyRecorder({
        ...input.commandDuties,
        routeId: input.routeId,
        now: input.commandDuties.now || now,
      });

  const runtime = {
    schema: WEBGPU_INFERENCE_RUNTIME_SCHEMA,
    routeId: input.routeId,
    runtimeLabel: input.runtimeLabel || 'browser-webgpu-runtime',
    adapter: context.adapter,
    device,
    queue,
    backendIdentity,
    kernel,
    profile: stagedProfile,
    caches: resourceCaches,
    hostPhases,
    commandDuties,

    getShaderModule(label, code, descriptor) {
      return resourceCaches.getShaderModule(label, code, descriptor);
    },

    getComputePipeline(label, descriptor) {
      return resourceCaches.getComputePipeline(label, descriptor);
    },

    createBuffer(descriptor) {
      return createBuffer(device, descriptor);
    },

    writeBuffer(buffer, data, offset = 0, dataOffset = 0, size = undefined) {
      return queueWriteBuffer(queue, buffer, data, offset, dataOffset, size);
    },

    readBuffer(buffer, options = {}) {
      return runOptionalHostPhase(
        runtime,
        WEBGPU_HOST_PHASE.readback,
        () => readMappedBuffer(buffer, options),
        { detail: { operation: 'buffer-direct-map', buffer: buffer?.label || buffer?.descriptor?.label || null } },
      );
    },

    createTensor(tensorInput = {}) {
      return createGpuTensor(tensorInput, {
        createBuffer: descriptor => runtime.createBuffer(descriptor),
      });
    },

    uploadTensor(tensor, data, offset = undefined) {
      if (!tensor || typeof tensor !== 'object') throw new Error('tensor must be an object');
      if (!tensor.buffer) throw new Error('tensor must expose buffer');
      runtime.writeBuffer(tensor.buffer, tensorUploadData(tensor, data), offset ?? tensor.bufferOffset ?? 0);
      return tensor;
    },

    async readTensor(tensor, options = {}) {
      if (!tensor || typeof tensor !== 'object') throw new Error('tensor must be an object');
      if (!tensor.buffer) throw new Error('tensor must expose buffer');
      if (Number.isInteger(tensor.usage) && (tensor.usage & WEBGPU_BUFFER_USAGE.mapRead) !== 0) {
        return runOptionalHostPhase(
          runtime,
          WEBGPU_HOST_PHASE.readback,
          () => readMappedBufferSlice(tensor.buffer, {
            ...options,
            sourceOffset: options.sourceOffset ?? options.offset ?? tensor.bufferOffset ?? 0,
            size: options.size ?? tensor.byteLength,
          }),
          { detail: { operation: 'tensor-direct-map', tensor: tensor.name || null } },
        );
      }
      return readBufferViaStaging(runtime, tensor, options);
    },

    createUniformBuffer(uniformInput = {}) {
      return createRuntimeUniformBuffer(uniformInput, {
        createBuffer: descriptor => runtime.createBuffer(descriptor),
        writeBuffer: (buffer, data) => runtime.writeBuffer(buffer, data),
      });
    },

    defineComputeKernel(kernelInput = {}) {
      return defineRuntimeComputeKernel(kernelInput, {
        device,
        getShaderModule: runtime.getShaderModule,
        getComputePipeline: runtime.getComputePipeline,
      });
    },

    defineProgram(programInput = {}) {
      return defineWebGpuPhaseProgram(programInput, { runtime });
    },

    runProgram(program, options = {}) {
      return runWebGpuPhaseProgram(program, { runtime, ...options });
    },

    runHostPhase(phase, fn, options = {}) {
      if (!hostPhases) {
        throw new Error('host phase recording is not configured for this runtime');
      }
      return hostPhases.measure(phase, fn, options);
    },

    finishHostPhases() {
      if (!hostPhases) {
        throw new Error('host phase recording is not configured for this runtime');
      }
      return hostPhases.finish();
    },

    finishCommandDuties() {
      if (!commandDuties) {
        throw new Error('command duty recording is not configured for this runtime');
      }
      return commandDuties.finish();
    },

    async runKernel(kernelDefinition, options = {}) {
      if (!kernelDefinition || typeof kernelDefinition !== 'object') {
        throw new Error('kernelDefinition must be an object');
      }
      if (!Array.isArray(options.dispatch) || options.dispatch.length < 1 || options.dispatch.length > 3) {
        throw new Error('dispatch must be an array with 1 to 3 dimensions');
      }
      const dispatch = [
        options.dispatch[0],
        options.dispatch[1] ?? 1,
        options.dispatch[2] ?? 1,
      ];
      for (const dim of dispatch) {
        if (!Number.isInteger(dim) || dim < 1) throw new Error('dispatch dimensions must be positive integers');
      }
      if (typeof device.createCommandEncoder !== 'function') {
        throw new Error('device.createCommandEncoder must be available');
      }
      if (options.submit !== false && typeof queue.submit !== 'function') {
        throw new Error('queue.submit must be available');
      }

      const stageName = options.stage || kernelDefinition.name;
      const metadata = {
        ...(options.metadata || {}),
        kernelName: kernelDefinition.name,
        dispatch,
        bindings: Array.isArray(kernelDefinition.bindings)
          ? kernelDefinition.bindings.map(binding => binding.name)
          : [],
      };

      return runtime.runStage(stageName, async stage => {
        const commandBuffer = await runOptionalHostPhase(
          runtime,
          WEBGPU_HOST_PHASE.commandEncoding,
          () => {
            const encoder = device.createCommandEncoder({
              label: options.encoderLabel || `${kernelDefinition.name}.encoder`,
            });
            const pass = encoder.beginComputePass({
              label: options.passLabel || `${kernelDefinition.name}.compute-pass`,
            });
            pass.setPipeline(kernelDefinition.pipeline);
            pass.setBindGroup(0, kernelDefinition.bindGroup);
            pass.dispatchWorkgroups(...dispatch);
            pass.end();
            return encoder.finish();
          },
          { detail: { operation: 'kernel-dispatch', kernelName: kernelDefinition.name, dispatch } },
        );
        if (options.submit !== false) {
          await runOptionalHostPhase(
            runtime,
            WEBGPU_HOST_PHASE.queueSubmission,
            () => runOptionalCommandDuty(runtime, {
              ...(options.commandDuty || {}),
              phase: options.commandDuty?.phase || stageName,
              kind: 'compute',
              metadata: {
                ...(options.commandDuty?.metadata || {}),
                ...metadata,
                operation: 'kernel-dispatch',
              },
            }, () => queue.submit([commandBuffer])),
            { detail: { operation: 'kernel-dispatch', kernelName: kernelDefinition.name } },
          );
        }
        if (options.yieldAfter === true) {
          await stage.yieldToBrowser({
            reason: options.yieldReason || `${kernelDefinition.name}.post-submit`,
          });
        }
        return commandBuffer;
      }, metadata);
    },

    yieldToBrowser(metadata = {}) {
      return yieldToBrowser(metadata);
    },

    async runStage(name, fn, metadata = {}) {
      if (!isNonEmptyString(name)) throw new Error('stage name must be a non-empty string');
      if (typeof fn !== 'function') throw new Error('stage function must be a function');

      const stageState = { yields: [] };
      const startMs = now();
      const result = await fn(createStageFacade(runtime, stageState, name, metadata));
      const endMs = now();
      addStagedSubmitStage(stagedProfile, {
        name,
        ms: Math.max(0, endMs - startMs),
        metadata: {
          ...clone(metadata),
          yields: stageState.yields,
        },
      });
      return result;
    },

    finishProfile(options = {}) {
      return createWebGpuRuntimeProfile({
        routeId: input.routeId,
        runtimeLabel: runtime.runtimeLabel,
        backend: backendIdentity,
        kernel,
        profile: finishStagedSubmitProfile(stagedProfile),
        requiredStages: options.requiredStages || input.requiredStages || stagedProfile.requiredStages,
        timingSource: options.timingSource || stagedProfile.timingSource,
        evidence: options.evidence || input.evidence || { mode: 'live', source: 'browser-webgpu-runtime' },
        createdAt: options.createdAt,
      });
    },
  };

  return runtime;
}
