import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  STRUCTURAL_AUTHORITY_CELL_IDS,
  buildStructuralAuthoritySubmissionCell,
  buildStructuralAuthorityTranchePlan,
  buildExposureFilteredComparisonManifest,
  measureCarrierSignalBudget,
  validateExposureLedger,
  validateStructuralAuthorityExecutionManifest,
  writeStructuralAuthorityPrelaunch,
} = await import('../lirm-support-structural-authority-prelaunch.mjs');
const {
  buildGreenroomSubmitArgs,
} = await import('../lirm-speciation-gestalt-imagegen-core.mjs');

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
const submissionCell = buildStructuralAuthoritySubmissionCell({
  cell: plan.cells[0],
  sourceImages: plan.cells[0].referenceSlots.map(slot => ({
    ...slot,
    sha256: `sha256:${'a'.repeat(64)}`,
  })),
});
const submitArgs = buildGreenroomSubmitArgs(submissionCell);
assert.ok(submitArgs.includes('reference_path_2=/fixture/source/cells/cell-a/depth.png'));
assert.ok(submitArgs.includes('reference_path_3=/fixture/source/cells/cell-a/normal.png'));
assert.ok(submitArgs.includes('reference_path_4=/fixture/source/cells/cell-a/support-control.png'));

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
for (const field of [
  'lerm_identity',
  'nintendo_region_coherence',
  'connected_body',
  'head_tail_polarity',
]) {
  assert.throws(
    () => validateExposureLedger({ ...acceptedLedger, [field]: false }),
    new RegExp(`positive ${field} classification`),
  );
}

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
assert.throws(
  () => buildExposureFilteredComparisonManifest({
    plan,
    ledgers: [
      ...plan.cells.map(cell => ({ ...acceptedLedger, cellId: cell.cellId })),
      { ...acceptedLedger, cellId: 'cell-a', operatorExposure: 'prohibited' },
    ],
  }),
  /duplicate exposure ledger for cell-a/,
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
  cells: plan.cells.map(cell => {
    const sourceImages = cell.referenceSlots.map(slot => ({
      role: slot.role,
      path: slot.path,
      sha256: `sha256:${'a'.repeat(64)}`,
    }));
    return {
      cellId: cell.cellId,
      atlasCellId: cell.atlasCellId,
      carrierMode: cell.carrierMode,
      seed: cell.seed,
      jobType: cell.jobType,
      sourceImages,
      input: sourceImages[0],
      references: sourceImages.slice(1),
    };
  }),
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
assert.throws(
  () => validateStructuralAuthorityExecutionManifest({
    ...executionManifest,
    cells: executionManifest.cells.map((cell, index) => index === 0
      ? { ...cell, references: cell.references.slice(0, 2) }
      : cell),
  }),
  /exactly depth, normal, support_control references/,
);

async function listRelativeFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, path));
    else files.push(path.slice(root.length + 1));
  }
  return files.sort();
}

const generatedRoot = await mkdtemp(join(tmpdir(), 'lirm-structural-authority-prelaunch-'));
const committedRoot = join(
  import.meta.dirname,
  '..',
  'artifacts',
  'lirm-support-structural-authority-tranche-01',
);
try {
  await writeStructuralAuthorityPrelaunch({ outDir: generatedRoot });
  const generatedFiles = await listRelativeFiles(generatedRoot);
  const committedFiles = await listRelativeFiles(committedRoot);
  assert.deepEqual(committedFiles, generatedFiles, 'committed prelaunch artifact file set is stale');
  for (const path of generatedFiles) {
    assert.deepEqual(
      await readFile(join(committedRoot, path)),
      await readFile(join(generatedRoot, path)),
      `committed prelaunch artifact is stale: ${path}`,
    );
  }
} finally {
  await rm(generatedRoot, { recursive: true, force: true });
}

console.log('lirm support structural authority prelaunch contracts passed');
