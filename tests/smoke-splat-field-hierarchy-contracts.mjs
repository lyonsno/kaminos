import assert from 'node:assert/strict';

import {
  REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
  compileSmokeFieldHierarchy,
} from '../smoke-splat-field-hierarchy.mjs';
import {
  createSmokeSplatSlotCache,
} from '../smoke-splat-slot-cache.mjs';

const CHANNELS = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function makeField(grid, phase = 0) {
  const values = new Float32Array(grid ** 3 * CHANNELS.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const index = x + y * grid + z * grid * grid;
        const offset = index * CHANNELS.length;
        const plume = Math.max(0, 1 - Math.hypot(x - (2.2 + phase * 0.15), z - 2.5) / 3);
        const smoke = plume * (0.08 + y * 0.035) * (x % 2 === 0 ? 1.45 : 0.72);
        values[offset] = 0.03 * x;
        values[offset + 1] = 0.4 + smoke;
        values[offset + 2] = 0.02 * z;
        values[offset + 4] = smoke;
        values[offset + 5] = Math.max(0, 0.8 - y * 0.08);
        values[offset + 7] = x % 2 === 0 ? 0.8 : 0.1;
        values[offset + 12] = z % 2 === 0 ? 0.7 : 0.05;
        values[offset + 13] = (x + z) % 3 === 0 ? 0.9 : 0.05;
      }
    }
  }
  return values;
}

function makeDenseTailField(grid, phase = 0) {
  const values = new Float32Array(grid ** 3 * CHANNELS.length);
  const centerX = grid * 0.48 + phase * 0.08;
  const centerZ = grid * 0.52;
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const index = x + y * grid + z * grid * grid;
        const offset = index * CHANNELS.length;
        const radial = Math.hypot(x - centerX, z - centerZ);
        const plume = Math.exp(-(radial * radial) / (grid * 0.11) ** 2)
          * (0.35 + 0.65 * y / (grid - 1));
        const smoke = 0.00025 + plume;
        values[offset] = (x - centerX) * 0.015;
        values[offset + 1] = 0.28 + smoke * 0.35;
        values[offset + 2] = (z - centerZ) * 0.012;
        values[offset + 4] = smoke;
        values[offset + 5] = Math.max(0, 0.75 - y / grid * 0.5);
        values[offset + 7] = plume;
        values[offset + 12] = plume * 0.7;
        values[offset + 13] = plume * 0.5;
      }
    }
  }
  return values;
}

function makeDisconnectedSupportField(grid) {
  const values = new Float32Array(grid ** 3 * CHANNELS.length);
  const writeRegion = (minimum, maximum, smoke) => {
    for (let z = minimum; z < maximum; z += 1) {
      for (let y = minimum; y < maximum; y += 1) {
        for (let x = minimum; x < maximum; x += 1) {
          const offset = (x + y * grid + z * grid * grid) * CHANNELS.length;
          values[offset + 1] = 0.35 + smoke;
          values[offset + 4] = smoke;
          values[offset + 5] = 0.2;
        }
      }
    }
  };
  writeRegion(0, 2, 0.08);
  writeRegion(grid - 2, grid, 1);
  return values;
}

const baseRequest = {
  grid: 8,
  channelOrder: CHANNELS,
  field: makeField(8),
  sourceIdentity: 'sha256:frame-96',
  slotIdentity: {
    historySlot: 0,
    slotWriteTick: 96,
    simulatorGeneration: 4,
    modelIdentity: 'smoke-residual-selector:test',
  },
  coarseBlockSize: 4,
  fineBlockSize: 2,
  extinctionCoefficient: 1.35,
  fineMassFraction: 0.6,
  articulationThreshold: 0.4,
};

const first = compileSmokeFieldHierarchy(baseRequest);
assert.equal(first.schema, 'kaminos-hierarchical-smoke-splats-v0');
assert.equal(first.producerAuthority, REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY);
assert.equal(first.producerKind, 'real-field-hierarchical-target');
assert.ok(first.coarseSplats.length > 0, 'real smoke always retains coarse transport support');
assert.ok(first.fineSplats.length > 0, 'articulated fixture emits sparse fine residuals');
assert.ok(first.fineSplats.length < first.sourceStatistics.occupiedFineBinCount, 'fine articulation is sparse rather than one splat per occupied fine bin');
assert.ok(first.coarseSplats.every(splat => splat.hierarchyRole === 'transport-coarse'));
assert.ok(first.fineSplats.every(splat => splat.hierarchyRole === 'articulation-fine'));
assert.ok(Math.abs(first.accounting.sourceExtinctionMass - first.accounting.representedExtinctionMass) < 1e-8);
assert.equal(first.accounting.rejectedExtinctionMass, 0, 'unselected fine mass rolls into coarse transport');
assert.equal(first.capacity.outputWasTruncated, false);
assert.equal(first.temporalKeys.coarse.length, first.coarseSplats.length);
assert.equal(first.temporalKeys.fine.length, first.fineSplats.length);

const next = compileSmokeFieldHierarchy({
  ...baseRequest,
  field: makeField(8, 1),
  sourceIdentity: 'sha256:frame-97',
  slotIdentity: { ...baseRequest.slotIdentity, historySlot: 1, slotWriteTick: 97 },
});
assert.ok(
  first.temporalKeys.coarse.some(key => next.temporalKeys.coarse.includes(key)),
  'stable spatial hierarchy keys survive adjacent phase slots even though product identities change',
);
assert.notEqual(first.identity, next.identity);

const changedModel = compileSmokeFieldHierarchy({
  ...baseRequest,
  slotIdentity: { ...baseRequest.slotIdentity, modelIdentity: 'smoke-residual-selector:changed' },
});
assert.notEqual(
  first.identity,
  changedModel.identity,
  'public hierarchy identity includes the learned selector/model identity',
);

const noFine = compileSmokeFieldHierarchy({ ...baseRequest, fineSelector: () => false });
assert.equal(noFine.fineSplats.length, 0);
assert.ok(Math.abs(noFine.accounting.sourceExtinctionMass - noFine.accounting.representedExtinctionMass) < 1e-8);
assert.equal(noFine.accounting.rejectedExtinctionMass, 0, 'a maximally sparse selector cannot erase smoke mass');

const denseTailRequest = {
  ...baseRequest,
  grid: 16,
  field: makeDenseTailField(16),
  coarseBlockSize: 2,
  fineBlockSize: 1,
  fineSelector: () => false,
  coarseAnchorMassRatio: 0.08,
};
const consolidated = compileSmokeFieldHierarchy(denseTailRequest);
assert.ok(consolidated.coarseConsolidation, 'coarse transport publishes its effective consolidation contract');
assert.equal(consolidated.coarseConsolidation.identity, 'mass-preserving-anchor-voronoi-v1');
assert.equal(consolidated.coarseConsolidation.spatialMomentAuthority, 'anchor-bin-only-tail-optical-transfer-v0');
assert.equal(consolidated.coarseConsolidation.sourceCoarseBinCount, 8 ** 3);
assert.ok(
  consolidated.coarseSplats.length < consolidated.coarseConsolidation.sourceCoarseBinCount * 0.25,
  'dense low-mass tails consolidate into materially fewer uncapped transport anchors',
);
assert.equal(
  consolidated.coarseSplats.reduce((sum, splat) => sum + splat.consolidatedSourceBinCount, 0),
  consolidated.coarseConsolidation.sourceCoarseBinCount,
  'every source coarse bin is assigned to exactly one emitted transport anchor',
);
assert.ok(Math.abs(consolidated.accounting.sourceExtinctionMass - consolidated.accounting.representedExtinctionMass) < 1e-8);
assert.equal(consolidated.accounting.rejectedExtinctionMass, 0, 'consolidation transfers tail mass instead of thresholding it away');
assert.ok(consolidated.coarseConsolidation.anchorSourceExtinctionMass > 0);
assert.ok(consolidated.coarseConsolidation.transferredTailExtinctionMass > 0);
assert.ok(Math.abs(
  consolidated.coarseConsolidation.anchorSourceExtinctionMass
    + consolidated.coarseConsolidation.transferredTailExtinctionMass
    - consolidated.accounting.representedExtinctionMass,
) < 1e-8, 'anchor-origin and transferred-tail accounting covers all coarse extinction');
assert.equal(
  consolidated.coarseSplats.every(splat => splat.geometrySourceBinCount === 1),
  true,
  'each consolidated footprint derives geometry from exactly one stable anchor bin',
);
const maximumConsolidatedRadius = Math.max(...consolidated.coarseSplats.flatMap(splat => splat.radii));
assert.ok(
  maximumConsolidatedRadius <= 0.251,
  `transferred tails do not expand anchor covariance back to domain scale: ${maximumConsolidatedRadius}`,
);
assert.deepEqual(
  compileSmokeFieldHierarchy(denseTailRequest).coarseSplats,
  consolidated.coarseSplats,
  'coarse anchor choice, assignment, moments, and output order are deterministic',
);

const consolidatedNext = compileSmokeFieldHierarchy({
  ...denseTailRequest,
  field: makeDenseTailField(16, 1),
  sourceIdentity: 'sha256:dense-tail-frame-97',
  slotIdentity: { ...denseTailRequest.slotIdentity, historySlot: 1, slotWriteTick: 97 },
});
const sharedConsolidatedKeys = consolidated.temporalKeys.coarse.filter(key => consolidatedNext.temporalKeys.coarse.includes(key));
assert.ok(
  sharedConsolidatedKeys.length >= consolidated.temporalKeys.coarse.length * 0.8,
  'fixed spatial anchor keys remain stable across a small adjacent-phase perturbation',
);

const changedConsolidation = compileSmokeFieldHierarchy({ ...denseTailRequest, coarseAnchorMassRatio: 0.16 });
assert.notEqual(
  changedConsolidation.identity,
  consolidated.identity,
  'public product identity includes the effective coarse consolidation configuration',
);

const disconnectedRequest = {
  ...baseRequest,
  field: makeDisconnectedSupportField(8),
  fineSelector: () => false,
  fineMassFraction: 0.5,
  coarseBlockSize: 2,
  fineBlockSize: 1,
  coarseAnchorMassRatio: 0.8,
};
const globallyConsolidatedDisconnected = compileSmokeFieldHierarchy(disconnectedRequest);
assert.equal(
  globallyConsolidatedDisconnected.coarseSplats.length,
  1,
  'control reproduces global high-mass anchor selection erasing disconnected weak support',
);
const stratifiedDisconnected = compileSmokeFieldHierarchy({
  ...disconnectedRequest,
  coarseStratumSize: 2,
});
assert.equal(stratifiedDisconnected.coarseConsolidation.identity, 'mass-preserving-spatial-strata-v2');
assert.equal(stratifiedDisconnected.coarseConsolidation.stratumAuthority, 'fixed-coarse-bin-cubes-local-anchor-transfer-v0');
assert.equal(stratifiedDisconnected.coarseConsolidation.coarseStratumSize, 2);
assert.equal(stratifiedDisconnected.coarseConsolidation.occupiedStratumCount, 2);
assert.equal(stratifiedDisconnected.coarseConsolidation.minimumAnchorsPerOccupiedStratum, 1);
assert.ok(
  stratifiedDisconnected.coarseSplats.length >= stratifiedDisconnected.coarseConsolidation.occupiedStratumCount,
  'every occupied stratum retains at least one local transport anchor without a global output cap',
);
assert.ok(
  stratifiedDisconnected.coarseConsolidation.representedSupport.bounds.minimum[1] < 0
    && stratifiedDisconnected.coarseConsolidation.representedSupport.bounds.maximum[1] > 0,
  'local-only transfer preserves disconnected low and high spatial support',
);
assert.ok(
  globallyConsolidatedDisconnected.coarseConsolidation.representedSupport.bounds.minimum[1] > 0,
  'global control collapses represented support into the high-mass region',
);
assert.ok(Math.abs(
  stratifiedDisconnected.accounting.sourceExtinctionMass
    - stratifiedDisconnected.accounting.representedExtinctionMass,
) < 1e-8, 'spatial stratification preserves exact extinction');
assert.equal(stratifiedDisconnected.accounting.rejectedExtinctionMass, 0);
assert.deepEqual(
  compileSmokeFieldHierarchy({ ...disconnectedRequest, coarseStratumSize: 2 }).coarseSplats,
  stratifiedDisconnected.coarseSplats,
  'stratum selection, local ownership, and output order are deterministic',
);
assert.notEqual(
  stratifiedDisconnected.identity,
  globallyConsolidatedDisconnected.identity,
  'public product identity includes the effective coarse stratum size',
);
assert.throws(
  () => compileSmokeFieldHierarchy({ ...disconnectedRequest, coarseStratumSize: 3 }),
  /coarseStratumSize/i,
  'coarse stratum size must tile the coarse lattice exactly',
);

const broadFineRequest = {
  ...denseTailRequest,
  fineSelector: () => true,
  fineMassFraction: 0.5,
};
const ungatedFine = compileSmokeFieldHierarchy(broadFineRequest);
const massGatedFine = compileSmokeFieldHierarchy({
  ...broadFineRequest,
  fineOccupancyMassRatio: 0.8,
});
assert.equal(massGatedFine.fineOccupancy.identity, 'mass-relative-fine-occupancy-v0');
assert.equal(massGatedFine.fineOccupancy.enabled, true);
assert.equal(massGatedFine.fineOccupancy.selectorSelectedFineBinCount, ungatedFine.fineSplats.length);
assert.equal(massGatedFine.fineOccupancy.emittedFineBinCount, massGatedFine.fineSplats.length);
assert.ok(
  massGatedFine.fineSplats.length < ungatedFine.fineSplats.length * 0.25,
  'mass-relative occupancy removes the domain-wide low-mass fine tail without a count cap',
);
assert.ok(massGatedFine.fineOccupancy.occupancyTransferredSourceExtinctionMass > 0);
assert.ok(Math.abs(
  massGatedFine.fineOccupancy.selectorSelectedSourceExtinctionMass
    - massGatedFine.fineOccupancy.emittedFineSourceExtinctionMass
    - massGatedFine.fineOccupancy.occupancyTransferredSourceExtinctionMass,
) < 1e-8, 'fine source mass is either emitted or transferred back to coarse transport');
assert.ok(Math.abs(
  massGatedFine.accounting.sourceExtinctionMass - massGatedFine.accounting.representedExtinctionMass,
) < 1e-8);
assert.equal(massGatedFine.accounting.rejectedExtinctionMass, 0);
assert.equal(ungatedFine.fineOccupancy.enabled, false, 'default ratio preserves pre-gate fine selection');
assert.equal(ungatedFine.fineOccupancy.emittedFineBinCount, ungatedFine.fineSplats.length);
assert.notEqual(massGatedFine.identity, ungatedFine.identity, 'fine occupancy ratio enters product identity');
assert.deepEqual(
  compileSmokeFieldHierarchy({ ...broadFineRequest, fineOccupancyMassRatio: 0.8 }).fineSplats,
  massGatedFine.fineSplats,
  'mass-relative fine occupancy and output order are deterministic',
);
const massGatedFineNext = compileSmokeFieldHierarchy({
  ...broadFineRequest,
  field: makeDenseTailField(16, 1),
  sourceIdentity: 'sha256:dense-tail-fine-frame-97',
  slotIdentity: { ...broadFineRequest.slotIdentity, historySlot: 1, slotWriteTick: 97 },
  fineOccupancyMassRatio: 0.8,
});
const sharedMassGatedFineKeys = massGatedFine.temporalKeys.fine.filter(key => massGatedFineNext.temporalKeys.fine.includes(key));
assert.ok(
  sharedMassGatedFineKeys.length >= massGatedFine.temporalKeys.fine.length * 0.8,
  'mass-relative fine occupancy retains stable spatial keys across adjacent phases',
);
const highOccupancyGrid = 52;
assert.doesNotThrow(
  () => compileSmokeFieldHierarchy({
    ...broadFineRequest,
    grid: highOccupancyGrid,
    field: makeDenseTailField(highOccupancyGrid),
    fineBlockSize: 1,
    coarseBlockSize: 13,
    fineSelector: () => false,
    fineOccupancyMassRatio: 0.8,
  }),
  'fine occupancy thresholding must not spread occupied bins into the JavaScript argument stack',
);

const overflow = compileSmokeFieldHierarchy({ ...baseRequest, capacity: 2 });
assert.equal(overflow.capacity.status, 'capacity-overflow-untruncated');
assert.equal(overflow.capacity.outputWasTruncated, false);
assert.equal(overflow.splats.length, overflow.requiredSplatCount);
assert.equal(overflow.capacity.overflowCount, overflow.requiredSplatCount - 2);

const cache = createSmokeSplatSlotCache({
  producerAuthority: REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
  decodeSlot(request) {
    return compileSmokeFieldHierarchy({
      ...baseRequest,
      field: request.payload.field,
      sourceIdentity: request.payload.identity,
      slotIdentity: request.slotIdentity,
    });
  },
});
const cacheReport = cache.resolve({
  instances: [{ phaseHistorySlot: 0, slotWriteTick: 96 }],
  payloadForSlot: () => ({ identity: 'sha256:frame-96', field: makeField(8) }),
  simulatorGeneration: 4,
  modelIdentity: 'smoke-residual-selector:test',
  requestedProducerAuthority: REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
});
assert.equal(cacheReport.effectiveProducerAuthority, REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY);
assert.equal(cacheReport.slotProducts[0].producerAuthority, REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY);
assert.match(cacheReport.cacheIdentity, /real-field-hierarchical-smoke-splat-producer-v0/);
assert.notEqual(cacheReport.cacheIdentity, 'kaminos-smoke-splat-slot-cache-v0');

assert.throws(
  () => compileSmokeFieldHierarchy({ ...baseRequest, channelOrder: [...CHANNELS].reverse() }),
  /fluid channel order/i,
);
assert.throws(
  () => compileSmokeFieldHierarchy({ ...baseRequest, field: new Float32Array(baseRequest.field.length - 1) }),
  /field length/i,
);
assert.throws(
  () => compileSmokeFieldHierarchy({ ...baseRequest, field: new Float32Array(baseRequest.field.length) }),
  /blank smoke/i,
);
assert.throws(
  () => compileSmokeFieldHierarchy({ ...baseRequest, fineOccupancyMassRatio: 1.01 }),
  /fineOccupancyMassRatio/i,
);

console.log('smoke splat field hierarchy contracts passed');
