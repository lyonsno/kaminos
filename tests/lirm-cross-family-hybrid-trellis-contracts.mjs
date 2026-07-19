import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCrossFamilyHybridTrellisPromotionPlan,
  buildCrossFamilyHybridTrellisWitnessPlan,
  recoverMatchingSubmissions,
  trellisSubmissionFingerprint,
  witnessSubmissionFingerprint,
} from '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/trellis/assay-contract.mjs';

const candidateIds = [
  'crown-halo-pendant-tripod',
  'offset-keyhole-canopy-strider',
  'wide-portal-saddle-canopy',
];
const selections = candidateIds.map((candidateId) => ({
  cellId: `${candidateId}-clay-depth-normal-prior-led-invention-seed718401`,
  role: `${candidateId}-hybrid-survivor`,
}));
const root = await mkdtemp(join(tmpdir(), 'lirm-cross-family-hybrid-trellis-'));
const durableImageRoot = join(root, 'images');
await mkdir(durableImageRoot, { recursive: true });
const accepted = [];
for (const selection of selections) {
  const bytes = Buffer.from(`hybrid:${selection.cellId}`);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(join(durableImageRoot, `${selection.cellId}.png`), bytes);
  accepted.push({
    cellId: selection.cellId,
    output: { sha256 },
    durableOutput: { sha256 },
  });
}
const imagegenPlan = {
  schema: 'kaminos.lirm-cross-family-hybrid-imagegen-pressure-plan.v0',
  status: 'planned',
  cells: selections.map((selection, index) => ({
    cellId: selection.cellId,
    candidateId: candidateIds[index],
    stance: 'prior-led-invention',
    seed: 718401,
    referenceSet: 'clay-depth-normal',
  })),
};
const imagegenCollection = {
  schema: 'kaminos.lirm-cross-family-hybrid-imagegen-collection.v0',
  status: 'complete-inspected',
  accepted,
};
const contactSheetSha256 = `sha256:${createHash('sha256').update('inspected-sheet').digest('hex')}`;
await writeFile(join(root, 'inspected-sheet.png'), 'inspected-sheet');
const contactSheetReceipt = {
  schema: 'kaminos.lirm-cross-family-hybrid-imagegen-contact-sheet-receipt.v0',
  status: 'complete-inspected',
  visualInspectionVerified: true,
  contactSheet: { path: 'inspected-sheet.png', sha256: contactSheetSha256 },
  sources: accepted.map(item => ({
    cellId: item.cellId,
    sha256: item.durableOutput.sha256,
  })),
};
const adjudication = {
  schema: 'kaminos.lirm-cross-family-hybrid-imagegen-adjudication.v0',
  status: 'visually-inspected-promotion-selected',
  contactSheet: { inspectedAtOriginalResolution: true, sha256: contactSheetSha256 },
  trellisPromotion: { status: 'selected', evidenceRoles: selections },
};

const trellisPlan = await buildCrossFamilyHybridTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication,
  contactSheetReceipt,
  contactSheetRoot: root,
  durableImageRoot,
  outputRoot: join(root, 'trellis-runtime'),
});
assert.equal(trellisPlan.schema, 'kaminos.lirm-cross-family-hybrid-trellis-promotion-plan.v0');
assert.equal(trellisPlan.cells.length, 3);
assert.deepEqual(trellisPlan.cells.map((cell) => cell.evidenceRole), selections.map((item) => item.role));
assert.ok(trellisPlan.cells.every((cell) => cell.jobType === 'trellis2mlx_fast'));
assert.ok(trellisPlan.cells.every((cell) => cell.settings.resolution === 512));
assert.ok(trellisPlan.cells.every((cell) => cell.settings.steps === 6));
assert.ok(trellisPlan.cells.every((cell) => cell.settings.cascade === false));
assert.ok(trellisPlan.cells.every((cell) => cell.settings.targetFaces === 200000));
assert.equal(trellisPlan.evidencePredicate.frontViewOnlyDoesNotSatisfy, true);
const trellisFingerprint = trellisSubmissionFingerprint(trellisPlan.cells[0]);
assert.notEqual(
  trellisFingerprint,
  trellisSubmissionFingerprint({
    ...trellisPlan.cells[0],
    input: { ...trellisPlan.cells[0].input, sha256: `sha256:${'1'.repeat(64)}` },
  }),
);
const trellisRecovery = recoverMatchingSubmissions({
  cells: trellisPlan.cells,
  priorSubmitted: [{
    cellId: trellisPlan.cells[0].cellId,
    jobId: 'stale-input-job',
    submissionFingerprint: trellisSubmissionFingerprint({
      ...trellisPlan.cells[0],
      input: { ...trellisPlan.cells[0].input, sha256: `sha256:${'1'.repeat(64)}` },
    }),
  }],
  idKey: 'cellId',
  fingerprintFor: trellisSubmissionFingerprint,
});
assert.equal(trellisRecovery.recovered.length, 0);
assert.equal(trellisRecovery.staleRecoveredSubmissions[0].reason, 'submission-fingerprint-mismatch');
await assert.rejects(
  buildCrossFamilyHybridTrellisPromotionPlan({
    imagegenPlan,
    imagegenCollection: { ...imagegenCollection, status: 'complete-uninspected' },
    adjudication,
    contactSheetReceipt,
    contactSheetRoot: root,
    durableImageRoot,
    outputRoot: join(root, 'invalid-runtime'),
  }),
  /complete and inspected/,
);
await assert.rejects(
  buildCrossFamilyHybridTrellisPromotionPlan({
    imagegenPlan,
    imagegenCollection,
    adjudication: {
      ...adjudication,
      contactSheet: { ...adjudication.contactSheet, sha256: `sha256:${'f'.repeat(64)}` },
    },
    contactSheetReceipt: {
      ...contactSheetReceipt,
      contactSheet: { path: 'does-not-exist.png', sha256: `sha256:${'f'.repeat(64)}` },
    },
    contactSheetRoot: root,
    durableImageRoot,
    outputRoot: join(root, 'missing-live-sheet-runtime'),
  }),
  /contact sheet.*missing|contact sheet.*hash drift|ENOENT/,
);
await assert.rejects(
  buildCrossFamilyHybridTrellisPromotionPlan({
    imagegenPlan,
    imagegenCollection,
    adjudication: {
      ...adjudication,
      contactSheet: { ...adjudication.contactSheet, sha256: `sha256:${'f'.repeat(64)}` },
    },
    contactSheetReceipt: {
      ...contactSheetReceipt,
      contactSheet: { ...contactSheetReceipt.contactSheet, sha256: `sha256:${'f'.repeat(64)}` },
    },
    contactSheetRoot: root,
    durableImageRoot,
    outputRoot: join(root, 'forged-live-sheet-runtime'),
  }),
  /contact sheet live file hash drift/,
);
await assert.rejects(
  buildCrossFamilyHybridTrellisPromotionPlan({
    imagegenPlan,
    imagegenCollection,
    adjudication: {
      ...adjudication,
      contactSheet: {
        ...adjudication.contactSheet,
        sha256: `sha256:${'0'.repeat(64)}`,
      },
    },
    contactSheetReceipt,
    contactSheetRoot: root,
    durableImageRoot,
    outputRoot: join(root, 'stale-adjudication-runtime'),
  }),
  /adjudication contact sheet hash drift/,
);

const trellisAccepted = [];
for (const cell of trellisPlan.cells) {
  const path = join(root, `${cell.cellId}.glb`);
  const bytes = Buffer.from(`glb:${cell.cellId}`);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(path, bytes);
  trellisAccepted.push({
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    output: { path, sha256 },
  });
}
const witnessScript = join(root, 'blender-witness.py');
await writeFile(witnessScript, 'print("witness")');
const witnessPlan = await buildCrossFamilyHybridTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion: {
    schema: 'kaminos.lirm-cross-family-hybrid-trellis-collection.v0',
    status: 'complete-glbs-unwitnessed',
    accepted: trellisAccepted,
  },
  witnessScript,
  outputRoot: join(root, 'witness-runtime'),
});
assert.equal(witnessPlan.schema, 'kaminos.lirm-cross-family-hybrid-trellis-witness-plan.v0');
assert.equal(witnessPlan.cells.length, 12);
assert.deepEqual(witnessPlan.requiredViews.map((item) => item.view), ['left', 'front', 'right', 'opposite']);
assert.equal(new Set(witnessPlan.cells.map((cell) => cell.witnessId)).size, 12);
assert.ok(witnessPlan.cells.every((cell) => cell.jobType === 'kaminos_blender_glb_witness_molten_0718'));
assert.equal(witnessPlan.evidencePredicate.apertureAndSuspensionRequireOppositeViewInspection, true);
const witnessFingerprint = witnessSubmissionFingerprint(witnessPlan.cells[0]);
assert.notEqual(
  witnessFingerprint,
  witnessSubmissionFingerprint({
    ...witnessPlan.cells[0],
    witnessScript: { ...witnessPlan.cells[0].witnessScript, sha256: `sha256:${'2'.repeat(64)}` },
  }),
);
const witnessRecovery = recoverMatchingSubmissions({
  cells: witnessPlan.cells,
  priorSubmitted: [{
    witnessId: witnessPlan.cells[0].witnessId,
    jobId: 'stale-script-job',
    submissionFingerprint: witnessSubmissionFingerprint({
      ...witnessPlan.cells[0],
      witnessScript: { ...witnessPlan.cells[0].witnessScript, sha256: `sha256:${'2'.repeat(64)}` },
    }),
  }],
  idKey: 'witnessId',
  fingerprintFor: witnessSubmissionFingerprint,
});
assert.equal(witnessRecovery.recovered.length, 0);
assert.equal(witnessRecovery.staleRecoveredSubmissions[0].reason, 'submission-fingerprint-mismatch');

for (const file of ['run-promotion.mjs', 'run-witness.mjs', 'build-witness-contact-sheet.mjs']) {
  const source = await readFile(new URL(
    `../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/trellis/${file}`,
    import.meta.url,
  ), 'utf8');
  assert.match(source, /failurePhase|visualInspectionClaim/);
  assert.doesNotMatch(source, /\['status', [^\]]+, '--json'\]/);
  if (file.startsWith('run-')) {
    assert.match(source, /submissionFingerprint/);
    assert.match(source, /staleRecoveredSubmissions/);
  }
}

for (const file of ['submission-report.json', 'witness-submission-report.json']) {
  const report = JSON.parse(await readFile(new URL(
    `../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/trellis/${file}`,
    import.meta.url,
  ), 'utf8'));
  if (report.status === 'submitted') {
    assert.ok(
      report.submitted.every(item => typeof item.submissionFingerprint === 'string'),
      `${file} cannot claim submitted without fingerprint-bound entries`,
    );
  }
}

console.log('LIRM cross-family hybrid Trellis contracts passed');
