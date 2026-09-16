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

export const KIMODO_TEXT_TO_MOTION_ROUTE_ID = 'kimodo.text-to-motion.webgpu-local.v0';
const KIMODO_MODEL_ID = 'NVIDIA/Kimodo-SOMA-RP-v1.1';
// The shipped kernel graph of the browser port (lyonsno/kimodo-webgpu):
// server-side text embedding, client-side DDIM (100 steps by default, CFG =
// two forward passes per step), JS FK decode over the 30-joint SOMA skeleton.
const DEFAULT_KERNEL_PROFILE = 'kimodo-text-to-motion';
const REQUIRED_STAGES = ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'];
// Contract repair (2026-09-15): v0 originally declared 'soma77-joints' with a
// fixed [90, 77, 3] shape. No tracked Kaminos consumer ever exercised that
// declaration (external emitters were not surveyed) — the shipped port
// FK-decodes 30 joints at a duration-dependent frame count (duration x
// 30fps), and its motion clip is the [frames, 369] feature rows. The route id
// stays v0: repairing a declaration no tracked consumer exercised breaks no
// consumer-exercised contract.
const OUTPUT_ROLES = [
  { key: 'somaJoints', role: 'soma-joints', required: true },
  { key: 'motionClip', role: 'motion-clip', required: true },
  { key: 'filmstrip', role: 'filmstrip', required: false },
];

function createDefaultKimodoScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'text-embedding': 1,
        'ddim-sampling': 1,
        'fk-decode': 1,
        'output-capture': 1,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        'text-embedding': 1,
        'ddim-sampling': 1,
        'fk-decode': 1,
        'output-capture': 1,
      },
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: [
        {
          name: 'text-embedding',
          stage: 'text-embedding',
          kind: 'external-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
        },
        {
          name: 'ddim-sampling-loop',
          stage: 'ddim-sampling',
          kind: 'gpu-submit-loop',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'Each diffusion step submit is non-preemptible; cooperative yielding occurs between steps.',
          metadata: { checkpointCadence: 'per-diffusion-step' },
        },
        {
          name: 'fk-decode',
          stage: 'fk-decode',
          kind: 'cpu-bound',
          interruptible: true,
          canYieldBefore: true,
          canYieldAfter: true,
        },
        {
          name: 'output-capture',
          stage: 'output-capture',
          kind: 'readback-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
        },
      ],
      checkpoints: [
        {
          name: 'between-diffusion-steps',
          kind: 'diffusion-step',
          afterStage: 'ddim-sampling',
          yieldable: true,
          waitsForSubmittedWorkDone: true,
          metadata: { cadence: 'per-step' },
        },
        {
          name: 'after-output-capture',
          kind: 'readback',
          afterStage: 'output-capture',
          yieldable: true,
          waitsForSubmittedWorkDone: true,
        },
      ],
      notes: 'Kimodo can expose useful cooperative pressure between diffusion steps; each submitted step remains non-preemptible.',
    },
  });
}

function createDefaultKimodoBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

/**
 * The Kimodo shape law, enforced where receipts are MINTED: the factory
 * below throws through it, so no factory-built receipt can carry the old
 * fictional shapes. Consumers who receive receipts from outside the factory
 * and want independent verification call this directly on receipt.outputs.
 *
 * Deliberately NOT wired into the generic route/receipt authority machinery:
 * the kit's consumers are cooperative in-process code, and JavaScript has no
 * in-process security boundary — a caller who could forge a route object
 * could equally monkey-patch any enforcement layer. Enforcement lives at
 * minting; verification is one exported function call. Accepts the factory's
 * keyed form ({somaJoints, motionClip}) or an artifact array with role
 * fields (the shape receipts carry).
 */
export function validateKimodoOutputArtifacts(outputs) {
  const errors = [];
  let joints;
  let clip;
  if (Array.isArray(outputs)) {
    // Duplicate required roles are ambiguous evidence, not first-match-wins:
    // an emitter that accidentally doubles a role must fail loud.
    const jointsAll = outputs.filter((o) => o?.role === 'soma-joints');
    const clipAll = outputs.filter((o) => o?.role === 'motion-clip');
    if (jointsAll.length > 1) errors.push(`exactly one soma-joints artifact required, found ${jointsAll.length}`);
    if (clipAll.length > 1) errors.push(`exactly one motion-clip artifact required, found ${clipAll.length}`);
    joints = jointsAll[0];
    clip = clipAll[0];
  } else {
    joints = outputs?.somaJoints;
    clip = outputs?.motionClip;
  }
  const js = joints?.shape;
  if (!Array.isArray(js) || js.length !== 3 || !Number.isInteger(js[0]) || js[0] < 1
      || js[1] !== 30 || js[2] !== 3) {
    errors.push(`somaJoints shape must be [frames, 30, 3] with positive integer frames, got ${JSON.stringify(js)}`);
  }
  const cs = clip?.shape;
  if (!Array.isArray(cs) || cs.length !== 2 || !Number.isInteger(cs[0]) || cs[0] < 1
      || cs[1] !== 369) {
    errors.push(`motionClip shape must be [frames, 369] with positive integer frames, got ${JSON.stringify(cs)}`);
  }
  if (errors.length === 0 && js[0] !== cs[0]) {
    errors.push(`somaJoints and motionClip must share the same frame count (same positive frames), got ${js[0]} vs ${cs[0]}`);
  }
  return { ok: errors.length === 0, errors };
}

function assertKimodoOutputShapes(outputs) {
  const verdict = validateKimodoOutputArtifacts(outputs);
  if (!verdict.ok) throw new Error(verdict.errors[0]);
}

export function createKimodoTextToMotionRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('text prompt artifactId and sha256 are required');
  }
  if (!input.outputs?.somaJoints) throw new Error('somaJoints output is required');
  if (!input.outputs?.motionClip) throw new Error('motionClip output is required');
  assertKimodoOutputShapes(input.outputs);

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: KIMODO_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('text-prompt', input.input),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createKimodoTextToMotionRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'adapter-phase-wall-clock',
  });

  return defineWebGpuRoute({
    routeId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: {
      id: KIMODO_MODEL_ID,
      revision: input.model?.revision || 'SOMA-RP-v1.1',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: routeMetadata.kernel,
    inputs: [
      { role: 'text-prompt', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      // Frame count is duration-dependent (duration x 30fps): no fixed shape.
      // Joints are [frames, 30, 3]; the motion clip is [frames, 369] feature
      // rows (last four values per row are the foot-contact channels).
      { role: 'soma-joints', required: true, artifactRequired: true, hashRequired: true },
      { role: 'motion-clip', required: true, artifactRequired: true, hashRequired: true },
      { role: 'filmstrip', required: false, artifactRequired: true, hashRequired: true },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultKimodoScheduler(),
    backpressure: input.backpressure || createDefaultKimodoBackpressure(),
    worker: input.worker || {
      exportName: 'runKimodoTextToMotionRoute',
      textEmbedding: 'external-llama3-8b',
      motionFormat: 'kimodo-soma30-explicit-joints',
    },
  });
}
