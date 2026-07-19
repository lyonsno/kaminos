import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHeritableLineageTrellisPromotionPlan,
  buildHeritableLineageTrellisWitnessPlan,
  recoverMatchingSubmissions,
  trellisSubmissionFingerprint,
  witnessSubmissionFingerprint,
} from '../artifacts/lirm-heritable-hybrid-lineage-v0/trellis/assay-contract.mjs';
import * as trellisContract from '../artifacts/lirm-heritable-hybrid-lineage-v0/trellis/assay-contract.mjs';

const selections = [
  ['annular-canopy-founder', 'founder-spatial-baseline', 'founder', 0],
  ['cleft-crown-twins-g3', 'cleft-crown-terminal', 'cleft-crown-twins', 3],
  ['stilted-ventral-keel-g3', 'stilted-keel-terminal', 'stilted-ventral-keel', 3],
  ['lateral-sail-radiant-g3', 'lateral-sail-terminal', 'lateral-sail-radiant', 3],
].map(([candidateId, role, lineageId, generation]) => ({
  cellId: `${candidateId}-clay-depth-normal-lineage-metabolizer-seed718501`,
  candidateId,
  role,
  lineageId,
  generation,
}));

const root = await mkdtemp(join(tmpdir(), 'lirm-heritable-lineage-trellis-'));
const durableImageRoot = join(root, 'images');
await mkdir(durableImageRoot, { recursive: true });
const accepted = [];
for (const selection of selections) {
  const bytes = Buffer.from(`lineage:${selection.cellId}`);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(join(durableImageRoot, `${selection.cellId}.png`), bytes);
  accepted.push({
    cellId: selection.cellId,
    candidateId: selection.candidateId,
    lineageId: selection.lineageId,
    generation: selection.generation,
    output: { sha256 },
    durableOutput: { path: `imagegen-outputs/${selection.cellId}.png`, sha256 },
  });
  selection.sha256 = sha256;
}

const imagegenPlan = {
  schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-plan.v0',
  status: 'planned',
  cells: selections.map(selection => ({
    cellId: selection.cellId,
    candidateId: selection.candidateId,
    lineageId: selection.lineageId,
    generation: selection.generation,
    parentId: selection.generation === 0 ? null : `${selection.lineageId}-g2`,
    seed: 718501,
    referenceSet: 'clay-depth-normal',
    inheritedCommitments: ['open-annular-aperture', 'independent-dorsal-canopy', 'sparse-tripod-support-field', 'spatially-distinct-suspended-anatomy'],
    inheritedMutations: selection.generation === 0 ? [] : ['g1', 'g2', 'g3'],
  })),
};
const imagegenCollection = {
  schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-collection.v0',
  status: 'complete-inspected',
  visualInspectionClaim: 'inspected',
  accepted,
};
const sheetBytes = Buffer.from('inspected-heritable-lineage-sheet');
const sheetSha256 = `sha256:${createHash('sha256').update(sheetBytes).digest('hex')}`;
await writeFile(join(root, 'lineage-sheet.png'), sheetBytes);
const contactSheetReceipt = {
  schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-contact-sheet-receipt.v0',
  status: 'complete-inspected',
  visualInspectionVerified: true,
  visualInspectionClaim: 'inspected',
  contactSheet: { path: 'lineage-sheet.png', sha256: sheetSha256 },
  sources: accepted.map(item => ({ cellId: item.cellId, sha256: item.durableOutput.sha256 })),
};
const adjudication = {
  schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-adjudication.v0',
  status: 'visually-inspected-promotion-selected',
  contactSheet: { inspectedAtOriginalResolution: true, sha256: sheetSha256 },
  trellisPromotion: {
    status: 'selected',
    evidenceRoles: selections.map(({ cellId, candidateId, role, lineageId, generation, sha256 }) => ({
      cellId, candidateId, role, lineageId, generation, sha256,
    })),
  },
};

const trellisPlan = await buildHeritableLineageTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication,
  contactSheetReceipt,
  contactSheetRoot: root,
  durableImageRoot,
  outputRoot: join(root, 'trellis-runtime'),
});
assert.equal(trellisPlan.schema, 'kaminos.lirm-heritable-hybrid-lineage-trellis-promotion-plan.v0');
assert.equal(trellisPlan.cells.length, 4);
assert.deepEqual(trellisPlan.cells.map(cell => cell.evidenceRole), selections.map(item => item.role));
assert.deepEqual(trellisPlan.cells.map(cell => cell.generation), [0, 3, 3, 3]);
assert.equal(new Set(trellisPlan.cells.map(cell => cell.settings.seed)).size, 1);
assert.ok(trellisPlan.cells.every(cell => cell.jobType === 'trellis2mlx_fast'));
assert.ok(trellisPlan.cells.every(cell => cell.settings.resolution === 512));
assert.ok(trellisPlan.cells.every(cell => cell.settings.steps === 6));
assert.ok(trellisPlan.cells.every(cell => cell.settings.cascade === false));
assert.ok(trellisPlan.cells.every(cell => cell.settings.targetFaces === 200000));
assert.equal(trellisPlan.evidencePredicate.frontViewOnlyDoesNotSatisfy, true);
assert.equal(trellisPlan.evidencePredicate.imageSpaceInheritanceDoesNotSatisfy, true);

const trellisFingerprint = trellisSubmissionFingerprint(trellisPlan.cells[0]);
assert.notEqual(trellisFingerprint, trellisSubmissionFingerprint({
  ...trellisPlan.cells[0],
  input: { ...trellisPlan.cells[0].input, sha256: `sha256:${'1'.repeat(64)}` },
}));
const staleTrellisRecovery = recoverMatchingSubmissions({
  cells: trellisPlan.cells,
  priorSubmitted: [{
    cellId: trellisPlan.cells[0].cellId,
    jobId: 'stale-lineage-input',
    submissionFingerprint: trellisSubmissionFingerprint({
      ...trellisPlan.cells[0],
      input: { ...trellisPlan.cells[0].input, sha256: `sha256:${'1'.repeat(64)}` },
    }),
  }],
  idKey: 'cellId',
  fingerprintFor: trellisSubmissionFingerprint,
});
assert.equal(staleTrellisRecovery.recovered.length, 0);
assert.equal(staleTrellisRecovery.staleRecoveredSubmissions[0].reason, 'submission-fingerprint-mismatch');

await assert.rejects(buildHeritableLineageTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection: { ...imagegenCollection, status: 'complete-uninspected' },
  adjudication,
  contactSheetReceipt,
  contactSheetRoot: root,
  durableImageRoot,
  outputRoot: join(root, 'invalid-runtime'),
}), /complete and inspected/);
await assert.rejects(buildHeritableLineageTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication: {
    ...adjudication,
    contactSheet: { ...adjudication.contactSheet, sha256: `sha256:${'f'.repeat(64)}` },
  },
  contactSheetReceipt,
  contactSheetRoot: root,
  durableImageRoot,
  outputRoot: join(root, 'stale-adjudication-runtime'),
}), /adjudication contact sheet hash drift/);
await assert.rejects(buildHeritableLineageTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection,
  adjudication: {
    ...adjudication,
    trellisPromotion: {
      ...adjudication.trellisPromotion,
      evidenceRoles: adjudication.trellisPromotion.evidenceRoles.slice(0, 3),
    },
  },
  contactSheetReceipt,
  contactSheetRoot: root,
  durableImageRoot,
  outputRoot: join(root, 'partial-terminal-runtime'),
}), /founder and three terminal lineages/);

const trellisAccepted = [];
for (const cell of trellisPlan.cells) {
  const path = join(root, `${cell.cellId}.glb`);
  const bytes = Buffer.from(`glb:${cell.cellId}`);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(path, bytes);
  trellisAccepted.push({
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    candidateId: cell.candidateId,
    lineageId: cell.lineageId,
    generation: cell.generation,
    output: { path, sha256 },
  });
}
const witnessScript = join(root, 'blender-witness.py');
await writeFile(witnessScript, 'print("witness")');
const witnessPlan = await buildHeritableLineageTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion: {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-trellis-collection.v0',
    status: 'complete-glbs-unwitnessed',
    accepted: trellisAccepted,
  },
  witnessScript,
  outputRoot: join(root, 'witness-runtime'),
});
assert.equal(witnessPlan.schema, 'kaminos.lirm-heritable-hybrid-lineage-trellis-witness-plan.v0');
assert.equal(witnessPlan.cells.length, 16);
assert.deepEqual(witnessPlan.requiredViews.map(item => item.view), ['left', 'front', 'right', 'opposite']);
assert.equal(new Set(witnessPlan.cells.map(cell => cell.witnessId)).size, 16);
assert.ok(witnessPlan.cells.every(cell => cell.jobType === 'kaminos_blender_glb_witness_molten_0718'));
assert.equal(witnessPlan.evidencePredicate.annulusAndSuspensionRequireOppositeViewInspection, true);

const witnessFingerprint = witnessSubmissionFingerprint(witnessPlan.cells[0]);
assert.notEqual(witnessFingerprint, witnessSubmissionFingerprint({
  ...witnessPlan.cells[0],
  witnessScript: { ...witnessPlan.cells[0].witnessScript, sha256: `sha256:${'2'.repeat(64)}` },
}));
const staleWitnessRecovery = recoverMatchingSubmissions({
  cells: witnessPlan.cells,
  priorSubmitted: [{
    witnessId: witnessPlan.cells[0].witnessId,
    jobId: 'stale-witness-script',
    submissionFingerprint: witnessSubmissionFingerprint({
      ...witnessPlan.cells[0],
      witnessScript: { ...witnessPlan.cells[0].witnessScript, sha256: `sha256:${'2'.repeat(64)}` },
    }),
  }],
  idKey: 'witnessId',
  fingerprintFor: witnessSubmissionFingerprint,
});
assert.equal(staleWitnessRecovery.recovered.length, 0);
assert.equal(staleWitnessRecovery.staleRecoveredSubmissions[0].reason, 'submission-fingerprint-mismatch');

for (const file of ['run-promotion.mjs', 'run-witness.mjs', 'build-witness-contact-sheet.mjs']) {
  const source = await readFile(new URL(
    `../artifacts/lirm-heritable-hybrid-lineage-v0/trellis/${file}`,
    import.meta.url,
  ), 'utf8');
  assert.match(source, /failurePhase|visualInspectionClaim/);
  assert.doesNotMatch(source, /\['status', [^\]]+, '--json'\]/);
  if (file === 'build-witness-contact-sheet.mjs') {
    assert.match(source, /sixteen route-validated witness frames assembled/);
  }
  if (file.startsWith('run-')) {
    assert.match(source, /submissionFingerprint/);
    assert.match(source, /staleRecoveredSubmissions/);
  }
}

assert.equal(
  typeof trellisContract.validateHeritableLineageSpatialEvidence,
  'function',
  'persisted heritable-lineage spatial evidence validator not implemented',
);

const artifactRoot = new URL('../artifacts/lirm-heritable-hybrid-lineage-v0/trellis/', import.meta.url);
const spatialAdjudication = JSON.parse(await readFile(new URL('spatial-adjudication.json', artifactRoot), 'utf8'));
const persistedTrellisCompletion = JSON.parse(await readFile(new URL('completion-report.json', artifactRoot), 'utf8'));
const persistedWitnessPlan = JSON.parse(await readFile(new URL('witness-plan.json', artifactRoot), 'utf8'));
const persistedWitnessCompletion = JSON.parse(await readFile(new URL('witness-completion-report.json', artifactRoot), 'utf8'));
const persistedWitnessReceipt = JSON.parse(await readFile(new URL('witness-contact-sheet-receipt.json', artifactRoot), 'utf8'));

const spatialEvidenceResult = await trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
});
assert.equal(spatialEvidenceResult.status, 'verified-spatial-lineage-hit-with-bounded-drift');
assert.equal(spatialEvidenceResult.verifiedCasts, 4);
assert.equal(spatialEvidenceResult.verifiedWitnessFrames, 16);

const forgedSheet = structuredClone(spatialAdjudication);
forgedSheet.witnessSheet.sha256 = `sha256:${'a'.repeat(64)}`;
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: forgedSheet,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
}), /witness sheet hash drift/);

const forgedCast = structuredClone(spatialAdjudication);
forgedCast.casts[0].glb.sha256 = `sha256:${'b'.repeat(64)}`;
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: forgedCast,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
}), /cast hash drift/);

const partialWitness = structuredClone(persistedWitnessCompletion);
partialWitness.accepted.pop();
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: partialWitness,
  witnessReceipt: persistedWitnessReceipt,
}), /exactly sixteen witness frames/);

const forgedInspection = structuredClone(persistedWitnessReceipt);
forgedInspection.visualInspectionClaim = 'pending';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: forgedInspection,
}), /inspected witness receipt/);

const fallbackRoute = structuredClone(persistedTrellisCompletion);
fallbackRoute.accepted[0].requestedRoute = 'fallback/trellis';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: fallbackRoute,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
}), /Trellis route drift/);

const forgedWitnessRunner = structuredClone(persistedWitnessCompletion);
forgedWitnessRunner.accepted[0].effectiveRoute =
  `/tmp/fallback-runner --pretend ${forgedWitnessRunner.accepted[0].effectiveRoute}`;
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: forgedWitnessRunner,
  witnessReceipt: persistedWitnessReceipt,
}), /witness route or view drift/);

const forgedWitnessJobType = structuredClone(persistedWitnessCompletion);
forgedWitnessJobType.accepted[0].effectiveJobType = 'fallback_witness';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: forgedWitnessJobType,
  witnessReceipt: persistedWitnessReceipt,
}), /witness route or view drift/);

const forgedWitnessParams = structuredClone(persistedWitnessCompletion);
forgedWitnessParams.accepted[0].effectiveParams.yaw = '0';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: forgedWitnessParams,
  witnessReceipt: persistedWitnessReceipt,
}), /witness route or view drift/);

const forgedMaterialHeredity = structuredClone(spatialAdjudication);
forgedMaterialHeredity.verdict.materialHeredityPreserved = true;
forgedMaterialHeredity.verdict.claim =
  'Exact material heredity and exact support topology survived all generations.';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: forgedMaterialHeredity,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: persistedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
}), /spatial adjudication verdict keys drift|forbidden heredity claim/);

const forgedWitnessInput = structuredClone(persistedWitnessCompletion);
forgedWitnessInput.accepted[0].input = {
  path: '/tmp/other.glb',
  bytes: 1,
  sha256: `sha256:${'d'.repeat(64)}`,
};
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: forgedWitnessInput,
  witnessReceipt: persistedWitnessReceipt,
}), /witness input identity drift/);

const forgedWitnessScript = structuredClone(persistedWitnessCompletion);
forgedWitnessScript.accepted[0].witnessScript = {
  path: '/tmp/forged-witness.py',
  bytes: 1,
  sha256: `sha256:${'e'.repeat(64)}`,
};
forgedWitnessScript.accepted[0].effectiveParams.witness_script = '/tmp/forged-witness.py';
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: persistedWitnessPlan,
  witnessCompletion: forgedWitnessScript,
  witnessReceipt: persistedWitnessReceipt,
}), /witness script identity drift/);

const alternateScriptPath = fileURLToPath(new URL(
  '../artifacts/lirm-heritable-hybrid-lineage-v0/trellis/run-witness.mjs',
  import.meta.url,
));
const alternateScriptBytes = await readFile(alternateScriptPath);
const alternateScriptEvidence = {
  path: alternateScriptPath,
  bytes: alternateScriptBytes.length,
  sha256: `sha256:${createHash('sha256').update(alternateScriptBytes).digest('hex')}`,
};
const mutuallyForgedWitnessPlan = structuredClone(persistedWitnessPlan);
const mutuallyForgedWitnessCompletion = structuredClone(persistedWitnessCompletion);
mutuallyForgedWitnessPlan.cells[0].witnessScript = alternateScriptEvidence;
mutuallyForgedWitnessCompletion.accepted[0].witnessScript = alternateScriptEvidence;
mutuallyForgedWitnessCompletion.accepted[0].effectiveParams.witness_script = alternateScriptPath;
await assert.rejects(trellisContract.validateHeritableLineageSpatialEvidence({
  artifactRoot,
  adjudication: spatialAdjudication,
  trellisCompletion: persistedTrellisCompletion,
  witnessPlan: mutuallyForgedWitnessPlan,
  witnessCompletion: mutuallyForgedWitnessCompletion,
  witnessReceipt: persistedWitnessReceipt,
}), /persisted witness plan drift/);

assert.equal(
  typeof trellisContract.preserveIdenticalWitnessInspectionState,
  'function',
  'idempotent witness inspection preservation not implemented',
);
const recollectedWitness = {
  ...structuredClone(persistedWitnessCompletion),
  status: 'complete-frames-uninspected',
  visualInspectionClaim: 'not-yet-inspected',
};
const preservedInspection = trellisContract.preserveIdenticalWitnessInspectionState({
  prior: persistedWitnessCompletion,
  current: recollectedWitness,
});
assert.equal(preservedInspection.status, 'complete-frames-inspected');
assert.equal(preservedInspection.visualInspectionClaim, 'inspected');
assert.match(preservedInspection.lastTrustworthyEvidence, /unchanged route-validated witness frames/);

const driftedRecollection = structuredClone(recollectedWitness);
driftedRecollection.accepted[0].output.sha256 = `sha256:${'c'.repeat(64)}`;
const invalidatedInspection = trellisContract.preserveIdenticalWitnessInspectionState({
  prior: persistedWitnessCompletion,
  current: driftedRecollection,
});
assert.equal(invalidatedInspection.status, 'complete-frames-uninspected');
assert.equal(invalidatedInspection.visualInspectionClaim, 'not-yet-inspected');

console.log('LIRM heritable hybrid lineage Trellis contracts passed');
