import assert from 'node:assert/strict';

const {
  STRUCTURAL_AUTHORITY_CELL_IDS,
  buildStructuralAuthorityTranchePlan,
  buildExposureFilteredComparisonManifest,
  measureCarrierSignalBudget,
  validateExposureLedger,
  validateStructuralAuthorityExecutionManifest,
} = await import('../lirm-support-structural-authority-prelaunch.mjs');

const plan = buildStructuralAuthorityTranchePlan({
  sourceRoot: '/fixture/source',
  outputRoot: '/fixture/output',
});

assert.deepEqual(STRUCTURAL_AUTHORITY_CELL_IDS, ['cell-a', 'cell-b', 'cell-c']);
assert.equal(plan.seed, 727001);
assert.equal(plan.requestedRoute, 'gpu-greenroom/mflux_flux2_edit_promptfile_4ref');
assert.deepEqual(plan.referenceOrder, ['clay', 'depth', 'normal', 'support_control']);
assert.deepEqual(plan.cells.map(cell => cell.cellId), STRUCTURAL_AUTHORITY_CELL_IDS);
assert.deepEqual(
  plan.cells.map(cell => [cell.cellId, cell.atlasCellId, cell.carrierMode]),
  [
    ['cell-a', 'body-only--wide', 'zero_support'],
    ['cell-b', 'attachment-fields--wide', 'latent_continuous_underside'],
    ['cell-c', 'external-rig--wide', 'consumed_explicit_role_plane'],
  ],
);
for (const cell of plan.cells) {
  assert.equal(cell.seed, 727001);
  assert.equal(cell.jobType, 'mflux_flux2_edit_promptfile_4ref');
  assert.deepEqual(cell.referenceSlots.map(slot => slot.role), plan.referenceOrder);
}

const width = 4;
const height = 3;
const channels = 3;
const bodyMask = Uint8Array.from([
  0, 0, 0, 0,
  0, 1, 1, 0,
  0, 1, 1, 0,
]);
const zeroData = new Uint8Array(width * height * channels);
const zeroBudget = measureCarrierSignalBudget({
  width,
  height,
  channels,
  data: zeroData,
  bodyMask,
  rolePeaks: [],
  disposition: 'zero_support',
});
assert.equal(zeroBudget.aggregate.nonBackgroundPixelCount, 0);
assert.equal(zeroBudget.aggregate.l1Energy, 0);
assert.equal(zeroBudget.aggregate.l2Energy, 0);
assert.equal(zeroBudget.bodyMaskOverlap.pixelCount, 0);

const signalData = new Uint8Array(width * height * channels);
const signalIndex = (2 * width + 1) * channels;
signalData[signalIndex] = 255;
signalData[signalIndex + 1] = 128;
const signalBudget = measureCarrierSignalBudget({
  width,
  height,
  channels,
  data: signalData,
  bodyMask,
  rolePeaks: [{ role: 'front-left', x: 1, y: 2, value: 255 }],
  disposition: 'consumed_explicit_role_plane',
});
assert.equal(signalBudget.aggregate.nonBackgroundPixelCount, 1);
assert.equal(signalBudget.aggregate.l1Energy, 383);
assert.ok(signalBudget.aggregate.l2Energy > 285 && signalBudget.aggregate.l2Energy < 286);
assert.equal(signalBudget.bodyMaskOverlap.pixelCount, 1);
assert.deepEqual(signalBudget.roles[0], {
  role: 'front-left',
  peak: { x: 1, y: 2, value: 255 },
});

const acceptedLedger = validateExposureLedger({
  schema: 'kaminos.lirm-structural-authority-exposure-ledger.v0',
  cellId: 'cell-a',
  safe: true,
  happy: true,
  lerm_identity: true,
  nintendo_region_coherence: true,
  connected_body: true,
  head_tail_polarity: true,
  literal_carrier_mark_leakage: false,
  operatorExposure: 'eligible',
  classifier: {
    id: 'independent-visual-classifier',
    model: 'gpt-5.5',
    context: 'full-resolution-output',
  },
});
assert.equal(acceptedLedger.operatorExposure, 'eligible');
assert.throws(
  () => validateExposureLedger({
    schema: 'kaminos.lirm-structural-authority-exposure-ledger.v0',
    cellId: 'cell-a',
    happy_safe: true,
    operatorExposure: 'eligible',
  }),
  /decomposed classification fields/,
);
assert.throws(
  () => validateExposureLedger({ ...acceptedLedger, literal_carrier_mark_leakage: true }),
  /carrier mark leakage prohibits operator exposure/,
);
assert.throws(
  () => validateExposureLedger({ ...acceptedLedger, safe: false }),
  /safe and happy classifications/,
);

const filtered = buildExposureFilteredComparisonManifest({
  plan,
  ledgers: plan.cells.map(cell => ({ ...acceptedLedger, cellId: cell.cellId })),
});
assert.deepEqual(filtered.cells.map(cell => cell.cellId), STRUCTURAL_AUTHORITY_CELL_IDS);
assert.equal(filtered.operatorExposure, 'eligible');
assert.throws(
  () => buildExposureFilteredComparisonManifest({
    plan,
    ledgers: [{ ...acceptedLedger, cellId: 'cell-a' }],
  }),
  /missing exposure ledger/,
);

const executionManifest = {
  schema: 'kaminos.lirm-support-structural-authority-execution-manifest.v0',
  seed: 727001,
  requestedRoute: plan.requestedRoute,
  referenceOrder: plan.referenceOrder,
  receipts: {
    carrierSignalBudget: 'receipts/carrier-signal-budget.json',
    fluxRouteContract: 'receipts/flux-4ref-route-contract.json',
    exposureFilterContract: 'receipts/exposure-filter-contract.json',
    sealedSourceMapping: 'source-mapping.json',
  },
  cells: plan.cells.map(cell => ({
    cellId: cell.cellId,
    atlasCellId: cell.atlasCellId,
    carrierMode: cell.carrierMode,
    seed: cell.seed,
    jobType: cell.jobType,
    sourceImages: cell.referenceSlots.map(slot => ({
      role: slot.role,
      path: slot.path,
      sha256: `sha256:${'a'.repeat(64)}`,
    })),
  })),
};
assert.equal(validateStructuralAuthorityExecutionManifest(executionManifest).seed, 727001);
assert.throws(
  () => validateStructuralAuthorityExecutionManifest({
    ...executionManifest,
    cells: executionManifest.cells.slice(0, 2),
  }),
  /exactly cell-a, cell-b, cell-c/,
);
assert.throws(
  () => validateStructuralAuthorityExecutionManifest({
    ...executionManifest,
    cells: executionManifest.cells.map((cell, index) => index === 0
      ? { ...cell, sourceImages: cell.sourceImages.slice(0, 3) }
      : cell),
  }),
  /exactly four ordered source images/,
);

console.log('lirm support structural authority prelaunch contracts passed');
