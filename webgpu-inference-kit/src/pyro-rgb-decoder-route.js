import { defineWebGpuRoute } from './route-boundary.js';
import {
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
} from './kernel-profile.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import {
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
} from './scheduler-backpressure.js';
import {
  WEBGPU_SHADER_STAGE,
} from './runtime-primitives.js';

export const PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID = 'pyro.rgb-intermediate-decoder.webgpu-local.v0';
export const PYRO_RGB_INTERMEDIATE_DECODER_MODEL_ID = 'kaminos/pyro-rgb-intermediate-decoder';
export const PYRO_RGB_INTERMEDIATE_DECODER_KERNEL_PROFILE = 'tiny-3x3-carrier-decoder-wgsl-v0';
export const PYRO_RGB_INTERMEDIATE_DECODER_REQUIRED_STAGES = [
  'decode-intermediate-fields',
  'readback-intermediate-fields',
];
export const PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES = [
  'hot-core',
  'fire-body',
  'smoke-body',
  'edge-breakup',
  'radiance-gain',
  'confidence-alpha',
];

const INPUT_ROLES = [
  { role: 'carrier-planes', required: true, artifactRequired: true, hashRequired: true },
  { role: 'decoder-weights', required: true, artifactRequired: true, hashRequired: true },
];
const OUTPUT_ROLES = [
  { key: 'hotcore', role: 'hot-core', required: true },
  { key: 'firebody', role: 'fire-body', required: true },
  { key: 'smokebody', role: 'smoke-body', required: true },
  { key: 'edgebreakup', role: 'edge-breakup', required: true },
  { key: 'radiancegain', role: 'radiance-gain', required: true },
  { key: 'confidencealpha', role: 'confidence-alpha', required: true },
];

const DECODER_KERNEL_CODE = /* wgsl */ `
struct DecoderParams {
  width: u32,
  height: u32,
  inputChannels: u32,
  outputChannels: u32,
};

@group(0) @binding(0) var<storage, read> carrierPlanes: array<f32>;
@group(0) @binding(1) var<storage, read> decoderWeights: array<f32>;
@group(0) @binding(2) var<storage, read> decoderBias: array<f32>;
@group(0) @binding(3) var<uniform> decoderParams: DecoderParams;
@group(0) @binding(4) var<storage, read_write> intermediateFields: array<f32>;

fn clampCoord(value: i32, upper: u32) -> u32 {
  if (value < 0) {
    return 0u;
  }
  let maxValue = i32(upper) - 1;
  if (value > maxValue) {
    return u32(maxValue);
  }
  return u32(value);
}

fn logistic(value: f32) -> f32 {
  return 1.0 / (1.0 + exp(-value));
}

// 3x3 carrier decoder: a first tiny local neural pass over carrier/control planes.
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let outputChannel = gid.z;
  if (x >= decoderParams.width || y >= decoderParams.height || outputChannel >= decoderParams.outputChannels) {
    return;
  }

  var acc = decoderBias[outputChannel];
  for (var inputChannel = 0u; inputChannel < decoderParams.inputChannels; inputChannel = inputChannel + 1u) {
    for (var ky = 0u; ky < 3u; ky = ky + 1u) {
      for (var kx = 0u; kx < 3u; kx = kx + 1u) {
        let sampleX = clampCoord(i32(x) + i32(kx) - 1, decoderParams.width);
        let sampleY = clampCoord(i32(y) + i32(ky) - 1, decoderParams.height);
        let carrierIndex = (inputChannel * decoderParams.height + sampleY) * decoderParams.width + sampleX;
        let weightIndex = ((outputChannel * decoderParams.inputChannels + inputChannel) * 9u) + ky * 3u + kx;
        acc = acc + carrierPlanes[carrierIndex] * decoderWeights[weightIndex];
      }
    }
  }

  let outputIndex = (outputChannel * decoderParams.height + y) * decoderParams.width + x;
  intermediateFields[outputIndex] = logistic(acc);
}
`;

function createDefaultPyroScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'decode-intermediate-fields': 1,
        'readback-intermediate-fields': 1,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 2,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'decode-intermediate-fields': 1,
        'readback-intermediate-fields': 1,
      },
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: [
        {
          name: 'decode-intermediate-fields-submit',
          stage: 'decode-intermediate-fields',
          kind: 'gpu-submit-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
        },
        {
          name: 'readback-intermediate-fields',
          stage: 'readback-intermediate-fields',
          kind: 'readback-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
        },
      ],
      checkpoints: [
        {
          name: 'after-decode-intermediate-fields',
          kind: 'stage-boundary',
          afterStage: 'decode-intermediate-fields',
          yieldable: true,
          waitsForSubmittedWorkDone: true,
        },
        {
          name: 'after-readback-intermediate-fields',
          kind: 'readback',
          afterStage: 'readback-intermediate-fields',
          yieldable: true,
          waitsForSubmittedWorkDone: true,
        },
      ],
      notes: 'Pyro decoder can cooperate between the tiny decoder submit and optional readback, not inside a submitted GPU pass.',
    },
  });
}

function createDefaultPyroBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'interactive',
    effectiveBudget: 'interactive',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

export function createPyroRgbIntermediateDecoderRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: PYRO_RGB_INTERMEDIATE_DECODER_KERNEL_PROFILE,
    requiredStages: PYRO_RGB_INTERMEDIATE_DECODER_REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });

  return defineWebGpuRoute({
    routeId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: PYRO_RGB_INTERMEDIATE_DECODER_MODEL_ID,
      revision: input.model?.revision || 'local-tiny-3x3',
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp32',
    },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES,
    outputs: PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES.map(role => ({
      role,
      required: true,
      artifactRequired: true,
      hashRequired: true,
    })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultPyroScheduler(),
    backpressure: input.backpressure || createDefaultPyroBackpressure(),
    worker: input.worker || {
      exportName: 'runPyroRgbIntermediateDecoderRoute',
    },
  });
}

export function createPyroRgbIntermediateDecoderRouteReceipt(input = {}) {
  if (!input.inputs?.carrierPlanes?.artifactId || !input.inputs?.carrierPlanes?.sha256) {
    throw new Error('carrierPlanes input artifactId and sha256 are required');
  }
  if (!input.inputs?.decoderWeights?.artifactId || !input.inputs?.decoderWeights?.sha256) {
    throw new Error('decoderWeights input artifactId and sha256 are required');
  }

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: PYRO_RGB_INTERMEDIATE_DECODER_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp32',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('carrier-planes', input.inputs.carrierPlanes),
      createRouteReceiptInputArtifact('decoder-weights', input.inputs.decoderWeights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createPyroRgbIntermediateDecoderPhaseProgram(input = {}) {
  const {
    runtime,
    carrierPlanes,
    decoderWeights,
    decoderBias,
    decoderParams,
    intermediateFields,
    width,
    height,
    outputChannels,
  } = input;
  if (!runtime || typeof runtime.defineProgram !== 'function') {
    throw new Error('runtime with defineProgram is required');
  }
  for (const [name, resource] of Object.entries({
    carrierPlanes,
    decoderWeights,
    decoderBias,
    decoderParams,
    intermediateFields,
  })) {
    if (!resource?.buffer) throw new Error(`${name} resource must expose buffer`);
  }
  if (!Number.isInteger(width) || width < 1) throw new Error('width must be a positive integer');
  if (!Number.isInteger(height) || height < 1) throw new Error('height must be a positive integer');
  if (!Number.isInteger(outputChannels) || outputChannels < 1) {
    throw new Error('outputChannels must be a positive integer');
  }

  return runtime.defineProgram({
    name: 'pyro.rgb-intermediate-decoder.tiny-3x3',
    tensors: {
      carrierPlanes,
      decoderWeights,
      decoderBias,
      intermediateFields,
    },
    uniforms: {
      decoderParams,
    },
    kernels: {
      decodeIntermediateFields: {
        code: DECODER_KERNEL_CODE,
        entryPoint: 'main',
        metadata: {
          profile: PYRO_RGB_INTERMEDIATE_DECODER_KERNEL_PROFILE,
          outputRoles: PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES,
        },
        bindings: [
          { name: 'carrierPlanes', resource: 'tensor:carrierPlanes', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'decoderWeights', resource: 'tensor:decoderWeights', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'decoderBias', resource: 'tensor:decoderBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' },
          { name: 'decoderParams', resource: 'uniform:decoderParams', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' },
          { name: 'intermediateFields', resource: 'tensor:intermediateFields', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' },
        ],
      },
    },
    phases: [
      {
        name: 'decode-intermediate-fields',
        kernel: 'decodeIntermediateFields',
        dispatch: [Math.ceil(width / 8), Math.ceil(height / 8), outputChannels],
        yieldAfter: true,
        metadata: {
          routeId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
          kernelProfile: PYRO_RGB_INTERMEDIATE_DECODER_KERNEL_PROFILE,
          outputRoles: PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES,
        },
      },
      {
        name: 'readback-intermediate-fields',
        readbacks: [{ name: 'intermediateFields', tensor: 'intermediateFields' }],
        metadata: {
          routeId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
          outputRoles: PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES,
        },
      },
    ],
    yieldPolicy: {
      afterEachKernel: true,
    },
    metadata: {
      routeId: PYRO_RGB_INTERMEDIATE_DECODER_ROUTE_ID,
      kernelProfile: PYRO_RGB_INTERMEDIATE_DECODER_KERNEL_PROFILE,
      outputRoles: PYRO_RGB_INTERMEDIATE_DECODER_OUTPUT_ROLES,
    },
  });
}
