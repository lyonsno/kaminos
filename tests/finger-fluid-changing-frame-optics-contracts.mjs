import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
  createKaminosFluidRuntime,
} from '@kaminos/fluid-webgpu';

const root = new URL('..', import.meta.url).pathname;
const webgpuCore = await import(`${root}/finger-fluid-webgpu-core.js`);

assert.equal(
  typeof webgpuCore.validateFingerFluidOpticalRepresentationTransition,
  'function',
  'the optical renderer must expose a changing-frame representation consumer',
);

function makeTerrain({
  priorEpoch,
  currentEpoch,
  motionClass,
  bedHeight,
  supportSpeed = 0,
  motionSubstepEnvelope = null,
}) {
  const width = 2;
  const height = 2;
  const sampleCount = width * height;
  const tangentU = new Float64Array(sampleCount * 3);
  const tangentV = new Float64Array(sampleCount * 3);
  const normal = new Float64Array(sampleCount * 3);
  const supportVelocity = new Float64Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    tangentU[index * 3] = 1;
    tangentV[index * 3 + 2] = 1;
    normal[index * 3 + 1] = 1;
    supportVelocity[index * 3 + 1] = supportSpeed;
  }
  return {
    schema: 'kaminos.fluid.terrain-fluid-frame.v1',
    route: {
      requested: 'lerms/hill-of-hills/terrain-fluid-frame',
      effective: 'lerms/hill-of-hills/terrain-fluid-frame',
    },
    producer: {
      id: 'hill-of-hills',
      revision: `hill-of-hills-${currentEpoch}`,
    },
    source: {
      requested: 'lerms/hill-of-hills/live-topology',
      effective: 'lerms/hill-of-hills/live-topology',
    },
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId: 'hill-of-hills',
    supportClass: 'heightfield',
    transformId: 'hill-of-hills-chart-v1',
    priorEpoch,
    currentEpoch,
    motionClass,
    shockId: null,
    grid: {
      width,
      height,
      spacing: [0.5, 0.5],
      origin: [0, 0, 0],
    },
    fields: {
      bedHeight: new Float64Array(sampleCount).fill(bedHeight),
      jacobian: new Float64Array(sampleCount).fill(1),
      gradient: new Float64Array(sampleCount * 2),
      tangentU,
      tangentV,
      normal,
      supportVelocity,
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    minimumFilteredSupportScale: null,
    motionSubstepEnvelope,
    complete: true,
    expectedSampleCount: sampleCount,
    actualSampleCount: sampleCount,
  };
}

const initialTerrain = makeTerrain({
  priorEpoch: 0,
  currentEpoch: 1,
  motionClass: 'stable',
  bedHeight: 0,
});
const runtime = createKaminosFluidRuntime({
  terrainFrame: initialTerrain,
  depth: new Float64Array(4),
  producerRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
});
const depositReceipt = runtime.depositLocal({
  transactionId: 'hill-water-deposit-1',
  lineageId: 'finger-water-lineage-1',
  fluidEpoch: 1,
  allocationGeneration: 1,
  supportId: initialTerrain.terrainId,
  transformId: initialTerrain.transformId,
  deposits: [{ x: 0, y: 0, volume: 0.04, momentum: [0.02, 0, 0.01] }],
  debitedMaterials: { sediment: 0.002 },
});
const previousFrame = runtime.representation();
const nextTerrain = makeTerrain({
  priorEpoch: 1,
  currentEpoch: 2,
  motionClass: 'phase_morph',
  bedHeight: 0.01,
  supportSpeed: 0.6,
  motionSubstepEnvelope: 1 / 60,
});
const remapReceipt = runtime.updateTerrain({
  terrainFrame: nextTerrain,
  deltaSeconds: 1 / 60,
  maximumBedDisplacement: 0.02,
  maximumSupportSpeed: 1,
});
runtime.step({ terrainFrame: nextTerrain, deltaSeconds: 1 / 240 });
const currentFrame = runtime.representation();

const previousIdentity = {
  packageDescriptor: KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
  artifactRevision: '@kaminos/fluid-webgpu@0.4.0',
  producerRevision: KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision,
  fluidEpoch: previousFrame.fluidEpoch,
  terrainEpoch: previousFrame.terrainEpoch,
};
const currentIdentity = {
  ...previousIdentity,
  fluidEpoch: currentFrame.fluidEpoch,
  terrainEpoch: currentFrame.terrainEpoch,
};
const opticalExecution = {
  schema: 'kaminos.finger-fluid.optical-execution.v1',
  route: {
    requested: 'webgpu-watershed-changing-frame-optics-v1',
    effective: 'webgpu-watershed-changing-frame-optics-v1',
  },
  fallbackStatus: 'none',
  quality: {
    requested: 'hero',
    effective: 'interactive',
    adaptationReason: 'measured-frame-budget',
  },
  budget: {
    measurementStatus: 'unmeasured',
    measurementRoute: null,
    measurementFrameId: null,
    gpuTimeMs: null,
    activeSupportSamples: null,
    activePixelCount: null,
    resolutionScale: 0.75,
  },
};

const publishedReceiptPath = `${root}/tests/fixtures/wet-border-moving-hill-remap-receipt-v2.json`;
const publishedReceiptBytes = readFileSync(publishedReceiptPath);
assert.equal(
  createHash('sha256').update(publishedReceiptBytes).digest('hex'),
  '8b6a9ab084bc8fd8f32e055e696e5d1d3197e957072954daa122522f4930647d',
  'the fixture must remain byte-identical to Wet Border\'s published v2 browser receipt',
);
const publishedReceipt = JSON.parse(publishedReceiptBytes);
assert.equal(
  publishedReceipt.schema,
  'lerms.hill-of-hills.kaminos-moving-browser-receipt.v2',
);
assert.equal(publishedReceipt.kaminosPackageVersion, '0.2.1');
assert.equal(
  publishedReceipt.kaminosRuntimeRevision,
  '95920668287205517bc2e22f4f224b0d7584f53e',
  'the immutable v2 browser receipt retains the runtime revision it actually exercised',
);
assert.deepEqual(publishedReceipt.browser.pageAndConsoleErrors, []);
assert.deepEqual(publishedReceipt.canonicalReceiptCapture.pageAndConsoleErrors, []);
assert.equal(publishedReceipt.canonicalReceiptCapture.receiptsExactlyEqual, true);
assert.equal(
  publishedReceipt.canonicalReceiptCapture.sourceSurface,
  'window.__lermsHillKaminosDebugState.remap.receipt',
);

const publishedLineageId = publishedReceipt.committedRemap.lineageIds[0];
const publishedPreviousFrame = {
  ...previousFrame,
  fluidEpoch: publishedReceipt.preRemap.fluidEpoch,
  terrainEpoch: publishedReceipt.source.previousTerrainEpoch,
  conservationReceiptIds: [...publishedReceipt.committedRemap.predecessorReceiptIds],
  lineageIds: [publishedLineageId],
};
const publishedCurrentFrame = {
  ...currentFrame,
  fluidEpoch: publishedReceipt.postRemap.fluidEpoch,
  terrainEpoch: publishedReceipt.source.currentTerrainEpoch,
  conservationReceiptIds: [...publishedReceipt.postRemap.conservationReceiptIds],
  lineageIds: [publishedLineageId],
};
const publishedTransition = webgpuCore.validateFingerFluidOpticalRepresentationTransition({
  previousFrame: publishedPreviousFrame,
  currentFrame: publishedCurrentFrame,
  remapReceipt: publishedReceipt.committedRemap,
  expectedPreviousIdentity: {
    ...previousIdentity,
    fluidEpoch: publishedPreviousFrame.fluidEpoch,
    terrainEpoch: publishedPreviousFrame.terrainEpoch,
  },
  expectedCurrentIdentity: {
    ...currentIdentity,
    fluidEpoch: publishedCurrentFrame.fluidEpoch,
    terrainEpoch: publishedCurrentFrame.terrainEpoch,
  },
  opticalExecution,
});
assert.equal(
  publishedTransition.remap.receiptId,
  publishedReceipt.committedRemap.receiptId,
);
assert.equal(
  publishedTransition.remap.terrainId,
  publishedReceipt.committedRemap.terrainId,
);
assert.equal(
  publishedTransition.remap.sourceId,
  publishedReceipt.committedRemap.sourceId,
);
assert.equal(
  publishedTransition.remap.transformId,
  publishedReceipt.committedRemap.transformId,
);
assert.deepEqual(
  publishedTransition.conservationReceiptIds,
  publishedReceipt.postRemap.conservationReceiptIds,
);
assert.deepEqual(publishedTransition.lineageIds, [publishedLineageId]);

const accepted = webgpuCore.validateFingerFluidOpticalRepresentationTransition({
  previousFrame,
  currentFrame,
  remapReceipt,
  expectedPreviousIdentity: previousIdentity,
  expectedCurrentIdentity: currentIdentity,
  opticalExecution,
});

assert.equal(accepted.schema, 'kaminos.finger-fluid.optical-representation-transition.v1');
assert.deepEqual(accepted.route, opticalExecution.route);
assert.deepEqual(accepted.quality, opticalExecution.quality);
assert.deepEqual(accepted.epochs, {
  previousTerrain: 1,
  currentTerrain: 2,
  previousFluid: 1,
  remapFluid: 1,
  currentFluid: 2,
});
assert.deepEqual(accepted.remap, {
  receiptId: remapReceipt.receiptId,
  mode: 'phase_morph',
  state: 'committed',
  terrainId: 'hill-of-hills',
  sourceId: 'lerms/hill-of-hills/live-topology',
  transformId: 'hill-of-hills-chart-v1',
  displacedVolume: remapReceipt.displacedVolume,
  supportWork: remapReceipt.supportWork,
  maximumBedDisplacement: 0.01,
  maximumSupportSpeed: 0.6,
  deltaSeconds: 1 / 60,
  motionSubstepEnvelope: 1 / 60,
});
assert.deepEqual(accepted.conservationReceiptIds, [
  depositReceipt.transactionId,
  remapReceipt.receiptId,
]);
assert.deepEqual(accepted.lineageIds, [depositReceipt.lineageId]);
assert.deepEqual(accepted.budget, opticalExecution.budget);
assert.equal(Object.isFrozen(accepted), true);
assert.equal(Object.isFrozen(accepted.epochs), true);
assert.equal(Object.isFrozen(accepted.conservationReceiptIds), true);
assert.equal(Object.hasOwn(accepted, 'previousFrame'), false);
assert.equal(Object.hasOwn(accepted, 'currentFrame'), false);
assert.match(
  accepted.transitionId,
  /^kaminos\.finger-fluid\.optical-representation-transition\.v1:/,
);

const measuredExecution = {
  ...opticalExecution,
  budget: {
    measurementStatus: 'measured',
    measurementRoute: 'webgpu-timestamp-query-optical-pass-v1',
    measurementFrameId: accepted.transitionId,
    gpuTimeMs: 3.75,
    activeSupportSamples: 4,
    activePixelCount: 4096,
    resolutionScale: 0.75,
  },
};
const measured = webgpuCore.validateFingerFluidOpticalRepresentationTransition({
  previousFrame,
  currentFrame,
  remapReceipt,
  expectedPreviousIdentity: previousIdentity,
  expectedCurrentIdentity: currentIdentity,
  opticalExecution: measuredExecution,
});
assert.deepEqual(measured.budget, measuredExecution.budget);
assert.equal(measured.transitionId, accepted.transitionId);

const transition = overrides => ({
  previousFrame,
  currentFrame,
  remapReceipt,
  expectedPreviousIdentity: previousIdentity,
  expectedCurrentIdentity: currentIdentity,
  opticalExecution,
  ...overrides,
});

for (const [label, value, pattern] of [
  [
    'unsupported package version',
    transition({
      expectedCurrentIdentity: {
        ...currentIdentity,
        packageDescriptor: {
          ...KAMINOS_FLUID_PACKAGE_DESCRIPTOR,
          packageVersion: '0.1.0',
        },
      },
    }),
    /package version/i,
  ],
  [
    'non-successor terrain epoch',
    transition({
      currentFrame: { ...currentFrame, terrainEpoch: previousFrame.terrainEpoch + 2 },
      expectedCurrentIdentity: {
        ...currentIdentity,
        terrainEpoch: previousFrame.terrainEpoch + 2,
      },
    }),
    /successor terrain epoch/i,
  ],
  [
    'stale fluid epoch',
    transition({
      currentFrame: { ...currentFrame, fluidEpoch: previousFrame.fluidEpoch - 1 },
      expectedCurrentIdentity: {
        ...currentIdentity,
        fluidEpoch: previousFrame.fluidEpoch - 1,
      },
    }),
    /fluid epoch.*regressed/i,
  ],
  [
    'ordinary morph relabel',
    transition({
      remapReceipt: { ...remapReceipt, mode: 'ordinary_morph' },
    }),
    /phase_morph/i,
  ],
  [
    'uncommitted remap',
    transition({
      remapReceipt: { ...remapReceipt, state: 'proposed' },
    }),
    /committed/i,
  ],
  [
    'poisoned volume residual',
    transition({
      remapReceipt: {
        ...remapReceipt,
        residual: { ...remapReceipt.residual, volume: 0.01 },
      },
    }),
    /volume residual/i,
  ],
  [
    'missing predecessor receipt',
    transition({
      remapReceipt: { ...remapReceipt, predecessorReceiptIds: [] },
    }),
    /predecessor receipt/i,
  ],
  [
    'lost deposit lineage',
    transition({
      currentFrame: { ...currentFrame, lineageIds: [] },
    }),
    /lineage/i,
  ],
  [
    'missing remap receipt in current frame',
    transition({
      currentFrame: {
        ...currentFrame,
        conservationReceiptIds: [depositReceipt.transactionId],
      },
    }),
    /remap receipt/i,
  ],
  [
    'fallback optical route',
    transition({
      opticalExecution: {
        ...opticalExecution,
        fallbackStatus: 'screen-space-debug',
      },
    }),
    /fallback/i,
  ],
  [
    'substituted effective route',
    transition({
      opticalExecution: {
        ...opticalExecution,
        route: {
          ...opticalExecution.route,
          effective: 'sphere-debug',
        },
      },
    }),
    /route/i,
  ],
  [
    'hidden quality downshift',
    transition({
      opticalExecution: {
        ...opticalExecution,
        quality: {
          requested: 'hero',
          effective: 'interactive',
          adaptationReason: null,
        },
      },
    }),
    /adaptation reason/i,
  ],
  [
    'fabricated measured budget',
    transition({
      opticalExecution: {
        ...opticalExecution,
        budget: {
          ...measuredExecution.budget,
          measurementRoute: null,
          gpuTimeMs: null,
        },
      },
    }),
    /measurement route/i,
  ],
  [
    'stale measured transition identity',
    transition({
      opticalExecution: {
        ...measuredExecution,
        budget: {
          ...measuredExecution.budget,
          measurementFrameId: 'unrelated-optical-transition',
        },
      },
    }),
    /measurement frame id.*disagreement/i,
  ],
]) {
  assert.throws(
    () => webgpuCore.validateFingerFluidOpticalRepresentationTransition(value),
    pattern,
    `${label} must fail before changing-frame optical evidence is accepted`,
  );
}

console.log('finger fluid changing-frame optical contracts passed');
