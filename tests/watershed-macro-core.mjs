import assert from 'node:assert/strict';

import { createTerrainFluidFrame } from '@kaminos/fluid-contracts';
import {
  advanceMappedMacroState,
  createMacroFluidRepresentationFrame,
  createMacroFluidTerrainFeedbackFrame,
  createMappedMacroState,
  createMappedMacroRuntime,
  depositLocalToMacro,
  remapMappedMacroState,
  summarizeMappedMacroState,
} from '@kaminos/fluid-webgpu';

function makeTerrain({
  width,
  height,
  spacing = [0.25, 0.25],
  bed,
  jacobian,
  epoch = 1,
  priorEpoch = 0,
  motionClass = 'stable',
  supportVelocity,
  worldMetersPerUnit = 1,
  tangentU,
  tangentV,
} = {}) {
  const sampleCount = width * height;
  const jacobianValues = jacobian ? Float64Array.from(jacobian) : new Float64Array(sampleCount).fill(1);
  const defaultTangentU = new Float64Array(sampleCount * 3);
  const defaultTangentV = new Float64Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    const scale = Math.sqrt(jacobianValues[index]);
    defaultTangentU[index * 3] = scale;
    defaultTangentV[index * 3 + 2] = scale;
  }
  return createTerrainFluidFrame({
    requestedRoute: 'test/analytic-terrain',
    effectiveRoute: 'test/analytic-terrain',
    producerId: 'watershed-macro-test',
    producerRevision: 'test-revision',
    requestedSourceId: 'analytic-live',
    effectiveSourceId: 'analytic-live',
    worldMetersPerUnit,
    gravity: [0, -9.81, 0],
    terrainId: 'analytic-terrain',
    supportClass: 'heightfield',
    transformId: 'analytic-substrate-to-world-v1',
    priorEpoch,
    currentEpoch: epoch,
    motionClass,
    grid: { width, height, spacing, origin: [0, 0, 0] },
    fields: {
      bedHeight: Float64Array.from(bed),
      jacobian: jacobianValues,
      gradient: new Float64Array(sampleCount * 2),
      tangentU: tangentU ?? defaultTangentU,
      tangentV: tangentV ?? defaultTangentV,
      normal: new Float64Array(Array.from({ length: sampleCount }, () => [0, 1, 0]).flat()),
      supportVelocity: supportVelocity || new Float64Array(sampleCount * 3),
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    complete: true,
  });
}

function maximum(values) {
  let result = -Infinity;
  for (const value of values) result = Math.max(result, value);
  return result;
}

const width = 18;
const height = 12;
const bed = Array.from({ length: width * height }, (_, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  return 0.18 * Math.sin(x * 0.31) * Math.cos(y * 0.27) + 0.24;
});
const terrain = makeTerrain({ width, height, bed });
assert.throws(
  () => createMappedMacroState({
    terrainFrame: makeTerrain({
      width: 2,
      height: 1,
      bed: [0, 0],
      tangentU: new Float64Array([1, 0, 0, 1, 0.25, 0]),
    }),
    depth: new Float64Array([0.1, 0.1]),
  }),
  /orthogonal heightfield metric/,
  'the reference core must reject terrain metrics it does not solve',
);
let still = createMappedMacroState({ terrainFrame: terrain, freeSurface: 1.1 });
const initialStill = summarizeMappedMacroState(still, terrain);
for (let step = 0; step < 120; step += 1) {
  still = advanceMappedMacroState(still, terrain, { deltaSeconds: 1 / 120 }).state;
}
const finalStill = summarizeMappedMacroState(still, terrain);
assert.ok(finalStill.maximumSpeed < 1e-10, `lake at rest generated velocity ${finalStill.maximumSpeed}`);
assert.ok(finalStill.maximumFreeSurfaceError < 1e-10, `lake at rest changed free surface by ${finalStill.maximumFreeSurfaceError}`);
assert.ok(Math.abs(finalStill.volume - initialStill.volume) < 1e-10, 'lake-at-rest volume is conserved');

const liftedTerrain = makeTerrain({
  width,
  height,
  bed: bed.map(value => value + 0.08),
  priorEpoch: 1,
  epoch: 2,
  motionClass: 'ordinary_morph',
  supportVelocity: new Float64Array(width * height * 3).fill(0).map((value, index) => index % 3 === 1 ? 0.08 : value),
});
still = remapMappedMacroState(still, terrain, liftedTerrain, { mode: 'ordinary_morph' }).state;
const beforeMovingStep = summarizeMappedMacroState(still, liftedTerrain);
still = advanceMappedMacroState(still, liftedTerrain, { deltaSeconds: 1 / 120 }).state;
const afterMovingStep = summarizeMappedMacroState(still, liftedTerrain);
assert.ok(afterMovingStep.maximumSpeed < 1e-10, 'uniform ordinary support motion preserves relative lake at rest');
assert.ok(Math.abs(afterMovingStep.volume - beforeMovingStep.volume) < 1e-10, 'ordinary support remap preserves volume');
assert.throws(
  () => remapMappedMacroState(
    createMappedMacroState({ terrainFrame: terrain, freeSurface: 1.1 }),
    terrain,
    makeTerrain({
      width,
      height,
      bed,
      priorEpoch: 1,
      epoch: 2,
      motionClass: 'ordinary_morph',
      worldMetersPerUnit: 4,
    }),
  ),
  /physical-meter-normalized terrain coordinates/,
  'an unsupported remap metric must fail before a terrain-remap receipt can publish',
);

const damWidth = 48;
const damTerrain = makeTerrain({ width: damWidth, height: 1, bed: new Array(damWidth).fill(0) });
let dam = createMappedMacroState({
  terrainFrame: damTerrain,
  depth: Float64Array.from({ length: damWidth }, (_, index) => index < 12 ? 0.8 : 0),
});
const initialDamVolume = summarizeMappedMacroState(dam, damTerrain).volume;
for (let step = 0; step < 80; step += 1) {
  dam = advanceMappedMacroState(dam, damTerrain, { deltaSeconds: 1 / 240 }).state;
}
const damSummary = summarizeMappedMacroState(dam, damTerrain);
assert.ok(damSummary.minimumDepth >= 0, `wet/dry front produced negative depth ${damSummary.minimumDepth}`);
assert.ok(Math.abs(damSummary.volume - initialDamVolume) < 1e-9, 'closed wet/dry evolution conserves volume');
assert.ok(damSummary.wetCellCount > 12, 'the wet front advances into initially dry terrain');

const mappedWidth = 20;
const mappedTerrain = makeTerrain({
  width: mappedWidth,
  height: 1,
  bed: new Array(mappedWidth).fill(0),
  jacobian: Array.from({ length: mappedWidth }, (_, index) => 0.75 + index / mappedWidth),
});
let mappedDam = createMappedMacroState({
  terrainFrame: mappedTerrain,
  depth: Float64Array.from({ length: mappedWidth }, (_, index) => index < 7 ? 0.6 : 0),
});
const mappedInitialVolume = summarizeMappedMacroState(mappedDam, mappedTerrain).volume;
for (let step = 0; step < 40; step += 1) {
  mappedDam = advanceMappedMacroState(mappedDam, mappedTerrain, { deltaSeconds: 1 / 240 }).state;
}
const mappedFinalVolume = summarizeMappedMacroState(mappedDam, mappedTerrain).volume;
assert.ok(
  Math.abs(mappedFinalVolume - mappedInitialVolume) < 1e-9,
  `one shared face must debit and credit the same mapped volume across unequal Jacobians: ${mappedInitialVolume} -> ${mappedFinalVolume}`,
);

const depositTerrain = makeTerrain({ width: 24, height: 16, bed: new Array(24 * 16).fill(0) });
let deposited = createMappedMacroState({ terrainFrame: depositTerrain, depth: new Float64Array(24 * 16) });
const deposit = depositLocalToMacro(deposited, depositTerrain, {
  transactionId: 'local-impact-1',
  lineageId: 'waterfall-1',
  fluidEpoch: 1,
  allocationGeneration: 1,
  supportId: 'analytic-terrain',
  transformId: 'analytic-substrate-v1',
  deposits: [
    { x: 11, y: 7, volume: 0.025, momentum: [0.05, 0, 0] },
    { x: 12, y: 7, volume: 0.025, momentum: [0.05, 0, 0] },
  ],
  debitedMaterials: { temperature: 0.015 },
});
assert.throws(
  () => depositLocalToMacro(createMappedMacroState({ terrainFrame: depositTerrain, depth: new Float64Array(24 * 16) }), depositTerrain, {
    transactionId: 'poisoned-epoch',
    lineageId: 'waterfall-1',
    fluidEpoch: 999,
    allocationGeneration: 1,
    supportId: 'analytic-terrain',
    transformId: 'analytic-substrate-v1',
    deposits: [{ x: 11, y: 7, volume: 0.01, momentum: [0, 0, 0] }],
  }),
  /requested fluidEpoch 999 does not match committed state epoch 1/,
  'a deposit cannot commit a receipt for an epoch the state did not reach',
);
deposited = deposit.state;
assert.equal(deposit.receipt.state, 'committed');
assert.equal(deposit.receipt.residual.volume, 0);
assert.deepEqual(deposit.receipt.residual.momentum, [0, 0, 0]);
const depositVolume = summarizeMappedMacroState(deposited, depositTerrain).volume;
assert.ok(Math.abs(depositVolume - 0.05) < 1e-12, 'deposited local volume becomes macro-owned exactly once');
assert.ok(
  Math.abs(Array.from(deposited.materialMasses.temperature).reduce((sum, value) => sum + value, 0) * 0.25 * 0.25 - 0.015) < 1e-12,
  'transported material mass becomes macro-owned with the same transaction',
);
for (let step = 0; step < 90; step += 1) {
  deposited = advanceMappedMacroState(deposited, depositTerrain, { deltaSeconds: 1 / 240 }).state;
}
const spread = summarizeMappedMacroState(deposited, depositTerrain);
assert.ok(spread.wetCellCount > 2, `deposit did not launch an outward wave: ${spread.wetCellCount} wet cells`);
assert.ok(Math.abs(spread.volume - 0.05) < 1e-9, 'outward wave remains conservative');
assert.ok(Math.abs(spread.materialMasses.temperature - 0.015) < 1e-9, 'outward wave conserves transported material mass');
assert.ok(maximum(deposited.mappedDepth) > 0, 'outward wave retains positive water');

const poisoned = createMappedMacroState({ terrainFrame: depositTerrain, depth: new Float64Array(24 * 16) });
poisoned.mappedDepth[0] = Number.NaN;
assert.throws(
  () => advanceMappedMacroState(poisoned, depositTerrain, { deltaSeconds: 1 / 240 }),
  /mappedDepth\[0\] must be finite/,
  'non-finite conserved state fails before a successful macro step receipt can publish',
);

const feedback = createMacroFluidTerrainFeedbackFrame(deposited, depositTerrain, {
  requestedRoute: 'kaminos/fluid/terrain-feedback',
  effectiveRoute: 'kaminos/fluid/terrain-feedback',
  producerRevision: 'watershed-test-revision',
  conservationReceiptIds: [deposit.receipt.transactionId],
});
assert.equal(feedback.terrainEpoch, depositTerrain.currentEpoch);
assert.equal(feedback.fluidEpoch, deposited.fluidEpoch);
assert.equal(feedback.fields.depth.length, 24 * 16);
assert.equal(feedback.fields.tangentMomentum.length, 24 * 16 * 2);
assert.ok(feedback.fields.wetness.some(value => value > 0), 'terrain feedback exposes current wet support');

const representation = createMacroFluidRepresentationFrame(deposited, depositTerrain, {
  requestedRoute: 'kaminos/fluid/representation-frame',
  effectiveRoute: 'kaminos/fluid/representation-frame',
  producerRevision: 'watershed-test-revision',
  local: { sourceBuffer: null, count: 0, supportScale: 0.05 },
  parcels: { sourceBuffer: null, count: 0 },
  physicalMaterial: { densityKgM3: 997, absorptionPerMeter: [0.05, 0.02, 0.01] },
});
assert.equal(representation.fluidEpoch, deposited.fluidEpoch);
assert.equal(representation.macro.mappedDepth.length, 24 * 16);
assert.ok(!('camera' in representation), 'published physical representation state is camera-independent');

const runtime = createMappedMacroRuntime({
  terrainFrame: depositTerrain,
  depth: new Float64Array(24 * 16),
  producerRevision: 'watershed-test-revision',
});
assert.equal(runtime.identity.route, 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1');
assert.equal(runtime.identity.terrainEpoch, depositTerrain.currentEpoch);
runtime.depositLocal({
  transactionId: 'runtime-deposit-1',
  lineageId: 'runtime-waterfall-1',
  fluidEpoch: 1,
  allocationGeneration: 1,
  supportId: 'analytic-terrain',
  transformId: 'analytic-substrate-v1',
  deposits: [{ x: 11, y: 7, volume: 0.01, momentum: [0, 0, 0] }],
});
runtime.step({ terrainFrame: depositTerrain, deltaSeconds: 1 / 240 });
assert.ok(runtime.snapshot().fluidEpoch >= 2, 'runtime update advances exact fluid epoch identity');
assert.equal(runtime.feedback().route.effective, 'kaminos/fluid/terrain-feedback');
assert.equal(runtime.representation().route.effective, 'kaminos/fluid/representation-frame');

console.log('watershed mapped macro core passed');
