import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RARE_GESTALT_PRESSURE_CANDIDATES,
  writeRareGestaltPressureWitness,
} from '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/assay-contract.mjs';
import {
  buildRareGestaltImagegenPlan,
} from '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/imagegen-contract.mjs';
import {
  buildRareGestaltContactSheetManifest,
} from '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/contact-sheet.mjs';
import {
  buildRareGestaltTrellisPromotionPlan,
  buildRareGestaltTrellisWitnessPlan,
} from '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/trellis/assay-contract.mjs';

assert.equal(RARE_GESTALT_PRESSURE_CANDIDATES.length, 6);
assert.equal(new Set(RARE_GESTALT_PRESSURE_CANDIDATES.map(candidate => candidate.id)).size, 6);
assert.deepEqual(
  [...new Set(RARE_GESTALT_PRESSURE_CANDIDATES.map(candidate => candidate.program.id))].sort(),
  [
    'kaminos.lirm-armature-program.annular-tripod.v0',
    'kaminos.lirm-armature-program.tripod-canopy.v0',
  ],
);
assert.ok(RARE_GESTALT_PRESSURE_CANDIDATES.every(candidate => candidate.lineagePressure));

const outDir = await mkdtemp(join(tmpdir(), 'lirm-rare-gestalt-pressure-'));
const result = await writeRareGestaltPressureWitness({ outDir, pixelWidth: 160, pixelHeight: 144 });
assert.equal(result.status, 'complete-uninspected');
assert.equal(result.candidates.length, 6);
assert.ok(result.candidates.every(candidate => candidate.receipt.status === 'complete'));
assert.ok(result.candidates.every(candidate => candidate.receipt.effectiveRoute === 'kaminos/lirm-armature-program/implicit-body-v0'));
assert.ok(result.candidates.every(candidate => candidate.receipt.outputInventory.trellisSource.rasterPath.endsWith('.png')));

const durableReceipt = JSON.parse(await readFile(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(durableReceipt.status, 'complete-uninspected');
assert.equal(durableReceipt.visualInspectionClaim, 'not-yet-inspected');
assert.equal(durableReceipt.failurePhase, null);
assert.equal(durableReceipt.falseClosureGuards.blankOrMissingControlCountsAsSuccess, false);
assert.equal(durableReceipt.falseClosureGuards.generatorFiringClaim, 'forbidden');

const inspectedReceipt = {
  ...durableReceipt,
  status: 'complete-inspected',
  visualInspectionClaim: 'six controls inspected; all admitted',
};
const imagegenPlan = await buildRareGestaltImagegenPlan({
  witnessReceipt: inspectedReceipt,
  witnessRoot: outDir,
  promptRoot: new URL('../artifacts/lirm-rare-gestalt-pressure-ladder-v1/prompts/', import.meta.url).pathname,
  outputRoot: join(outDir, 'imagegen-runtime'),
  seeds: [718301],
});
assert.equal(imagegenPlan.schema, 'kaminos.lirm-rare-gestalt-imagegen-pressure-plan.v0');
assert.equal(imagegenPlan.cells.length, 12);
assert.equal(new Set(imagegenPlan.cells.map(cell => cell.cellId)).size, 12);
assert.deepEqual([...new Set(imagegenPlan.cells.map(cell => cell.stance))].sort(), [
  'anatomical-completion',
  'prior-led-invention',
]);
assert.ok(imagegenPlan.cells.every(cell => cell.requestedRoute === 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref'));
assert.ok(imagegenPlan.cells.every(cell => cell.settings.steps === 8));
assert.equal(imagegenPlan.falseClosureGuards.visuallyNovelWithoutLineage, 'does_not_satisfy');
await assert.rejects(
  buildRareGestaltImagegenPlan({
    witnessReceipt: durableReceipt,
    witnessRoot: outDir,
    promptRoot: new URL('../artifacts/lirm-rare-gestalt-pressure-ladder-v1/prompts/', import.meta.url).pathname,
    outputRoot: join(outDir, 'invalid-runtime'),
    seeds: [718301],
  }),
  /visually inspected control witness/,
);

const runner = await readFile(new URL(
  '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/run-witness.mjs',
  import.meta.url,
), 'utf8');
assert.match(runner, /writeRareGestaltPressureWitness/);
assert.match(runner, /failurePhase/);

const imagegenRunner = await readFile(new URL(
  '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/run-imagegen.mjs',
  import.meta.url,
), 'utf8');
assert.match(imagegenRunner, /buildRareGestaltImagegenPlan/);
assert.match(imagegenRunner, /validateGestaltImagegenCompletion/);
assert.match(imagegenRunner, /runGreenroom\(\['status', jobId\]\)/);
assert.doesNotMatch(imagegenRunner, /\['status', jobId, '--json'\]/);
assert.match(imagegenRunner, /lastTrustworthyEvidence/);

const contactSheetManifest = buildRareGestaltContactSheetManifest({
  accepted: imagegenPlan.cells.map(cell => ({
    cellId: cell.cellId,
    candidateId: cell.candidateId,
    stance: cell.stance,
    durableOutput: { path: `imagegen-outputs/${cell.cellId}.png` },
  })),
  artifactRoot: outDir,
});
assert.equal(contactSheetManifest.columns, 2);
assert.equal(contactSheetManifest.rows, 6);
assert.equal(contactSheetManifest.cells.length, 12);
assert.deepEqual(contactSheetManifest.cells.slice(0, 2).map(cell => cell.stance), [
  'anatomical-completion',
  'prior-led-invention',
]);
assert.equal(new Set(contactSheetManifest.cells.map(cell => cell.candidateId)).size, 6);

const promoted = [
  ['annular-tripod-open-crown', 'anatomical-completion', 'open-annulus-single-pendant'],
  ['annular-tripod-wide-slant', 'prior-led-invention', 'slanted-annulus-prior-invention'],
  ['tripod-canopy-wide-low-pendant', 'prior-led-invention', 'broad-canopy-multiple-pendants'],
  ['tripod-canopy-asymmetric-deep', 'anatomical-completion', 'clustered-canopy-single-pendant'],
].map(([candidateId, stance, role]) => ({
  cellId: `${candidateId}-clay-depth-normal-${stance}-seed718301`,
  role,
}));
const durableImageRoot = join(outDir, 'promoted-images');
await mkdir(durableImageRoot, { recursive: true });
const promotedAccepted = [];
for (const selection of promoted) {
  const bytes = Buffer.from(`promoted:${selection.cellId}`);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(join(durableImageRoot, `${selection.cellId}.png`), bytes);
  promotedAccepted.push({
    cellId: selection.cellId,
    output: { sha256: hash },
    durableOutput: { sha256: hash },
  });
}
const trellisPlan = await buildRareGestaltTrellisPromotionPlan({
  imagegenPlan,
  imagegenCollection: {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-collection.v0',
    status: 'complete-inspected',
    accepted: promotedAccepted,
  },
  adjudication: {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-adjudication.v0',
    status: 'visually-inspected-promotion-selected',
    contactSheet: { inspectedAtOriginalResolution: true },
    trellisPromotion: { status: 'selected', evidenceRoles: promoted },
  },
  durableImageRoot,
  outputRoot: join(outDir, 'trellis-runtime'),
});
assert.equal(trellisPlan.schema, 'kaminos.lirm-rare-gestalt-trellis-promotion-plan.v0');
assert.equal(trellisPlan.cells.length, 4);
assert.deepEqual(trellisPlan.cells.map(cell => cell.evidenceRole), promoted.map(item => item.role));
assert.ok(trellisPlan.cells.every(cell => cell.jobType === 'trellis2mlx_fast'));
assert.ok(trellisPlan.cells.every(cell => cell.settings.steps === 6));
assert.ok(trellisPlan.cells.every(cell => cell.settings.cascade === false));
assert.ok(trellisPlan.cells.every(cell => cell.settings.targetFaces === 200000));
assert.equal(trellisPlan.evidencePredicate.spatialCoherenceRequiresRenderedWitness, true);
await assert.rejects(
  buildRareGestaltTrellisPromotionPlan({
    imagegenPlan,
    imagegenCollection: {
      schema: 'kaminos.lirm-rare-gestalt-imagegen-collection.v0',
      status: 'complete-uninspected',
      accepted: promotedAccepted,
    },
    adjudication: {
      schema: 'kaminos.lirm-rare-gestalt-imagegen-adjudication.v0',
      status: 'visually-inspected-promotion-selected',
      contactSheet: { inspectedAtOriginalResolution: true },
      trellisPromotion: { status: 'selected', evidenceRoles: promoted },
    },
    durableImageRoot,
    outputRoot: join(outDir, 'invalid-trellis-runtime'),
  }),
  /complete and inspected/,
);

const trellisRunner = await readFile(new URL(
  '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/trellis/run-promotion.mjs',
  import.meta.url,
), 'utf8');
assert.match(trellisRunner, /runGreenroom\(\['status', submitted\.jobId\]\)/);
assert.doesNotMatch(trellisRunner, /\['status', submitted\.jobId, '--json'\]/);
assert.match(trellisRunner, /complete-glbs-unwitnessed/);
const trellisAccepted = [];
for (const cell of trellisPlan.cells) {
  const path = join(outDir, `${cell.cellId}.glb`);
  const bytes = Buffer.from(`glb:${cell.cellId}`);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(path, bytes);
  trellisAccepted.push({
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    output: { path, sha256: hash },
  });
}
const witnessScript = join(outDir, 'blender-witness.py');
await writeFile(witnessScript, 'print("witness")');
const witnessPlan = await buildRareGestaltTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion: {
    schema: 'kaminos.lirm-rare-gestalt-trellis-collection.v0',
    status: 'complete-glbs-unwitnessed',
    accepted: trellisAccepted,
  },
  witnessScript,
  outputRoot: join(outDir, 'witness-runtime'),
});
assert.equal(witnessPlan.schema, 'kaminos.lirm-rare-gestalt-trellis-witness-plan.v0');
assert.equal(witnessPlan.cells.length, 16);
assert.deepEqual(witnessPlan.requiredViews.map(item => item.view), ['left', 'front', 'right', 'opposite']);
assert.equal(new Set(witnessPlan.cells.map(cell => cell.witnessId)).size, 16);
assert.ok(witnessPlan.cells.every(cell => cell.jobType === 'kaminos_blender_glb_witness_molten_0718'));
assert.equal(witnessPlan.evidencePredicate.apertureAndSuspensionRequireOppositeViewInspection, true);

const witnessRunner = await readFile(new URL(
  '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/trellis/run-witness.mjs',
  import.meta.url,
), 'utf8');
assert.match(witnessRunner, /runGreenroom\(\['status', submitted\.jobId\]\)/);
assert.doesNotMatch(witnessRunner, /\['status', submitted\.jobId, '--json'\]/);
assert.match(witnessRunner, /complete-frames-uninspected/);

const witnessSheetBuilder = await readFile(new URL(
  '../artifacts/lirm-rare-gestalt-pressure-ladder-v1/trellis/build-witness-contact-sheet.mjs',
  import.meta.url,
), 'utf8');
assert.match(witnessSheetBuilder, /complete-frames-uninspected/);
assert.match(witnessSheetBuilder, /witness hash drift/);
assert.match(witnessSheetBuilder, /visualInspectionClaim/);

console.log('LIRM rare gestalt pressure ladder contracts passed');
