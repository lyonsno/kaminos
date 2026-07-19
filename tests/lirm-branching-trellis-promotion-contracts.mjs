import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  buildBranchingTrellisPromotionPlan,
  buildBranchingTrellisWitnessPlan,
} = await import(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/trellis/assay-contract.mjs'
);

const selected = [
  {
    cellId: 'forked-saddle-lirm02-clay-depth-normal-anatomical-completion-seed718201',
    candidateId: 'forked-saddle-lirm02',
    stance: 'anatomical-completion',
    seed: 718201,
    role: 'rare-topology-preservation',
  },
  {
    cellId: 'asymmetric-bead-chain-lirm07-clay-depth-normal-anatomical-completion-seed718202',
    candidateId: 'asymmetric-bead-chain-lirm07',
    stance: 'anatomical-completion',
    seed: 718202,
    role: 'clean-adherence-baseline',
  },
  {
    cellId: 'asymmetric-bead-chain-lirm07-clay-depth-normal-prior-led-invention-seed718201',
    candidateId: 'asymmetric-bead-chain-lirm07',
    stance: 'prior-led-invention',
    seed: 718201,
    role: 'productive-prior-extrapolation',
  },
];

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = await mkdtemp(join(tmpdir(), 'lirm-branching-trellis-promotion-'));
const durableImageRoot = join(root, 'outputs');
const outputRoot = join(root, 'trellis-outputs');
await mkdir(durableImageRoot, { recursive: true });

const imagegenPlan = {
  schema: 'kaminos.lirm-branching-imagegen-pressure-plan.v0',
  status: 'planned',
  cells: selected.map(item => ({
    cellId: item.cellId,
    candidateId: item.candidateId,
    stance: item.stance,
    seed: item.seed,
    referenceSet: 'clay-depth-normal',
  })),
};
const accepted = [];
for (const item of selected) {
  const bytes = Buffer.from(`generated:${item.cellId}`);
  const path = join(durableImageRoot, `${item.cellId}.png`);
  await writeFile(path, bytes);
  accepted.push({
    cellId: item.cellId,
    output: {
      path: join(root, 'disposable-greenroom-output.png'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
  });
}
const imagegenCompletion = {
  schema: 'kaminos.lirm-branching-imagegen-pressure-collection.v0',
  status: 'complete',
  accepted,
};
const adjudication = {
  schema: 'kaminos.lirm-branching-imagegen-pressure-assay.v0',
  status: 'visually-inspected-promotion-selected',
  visualInspection: { inspectedAtOriginalResolution: true },
  trellisPromotion: {
    status: 'selected',
    evidenceRoles: selected.map(({ cellId, role }) => ({ cellId, role })),
  },
};

const plan = await buildBranchingTrellisPromotionPlan({
  imagegenPlan,
  imagegenCompletion,
  adjudication,
  durableImageRoot,
  outputRoot,
});

assert.equal(plan.schema, 'kaminos.lirm-branching-trellis-promotion-plan.v0');
assert.equal(plan.status, 'planned');
assert.equal(plan.cells.length, 3);
assert.deepEqual(plan.comparisonContract.evidenceRoles, selected.map(({ cellId, role }) => ({ cellId, role })));
assert.deepEqual(plan.cells.map(cell => cell.evidenceRole), selected.map(item => item.role));
assert.deepEqual(plan.cells.map(cell => cell.cellId), selected.map(item => item.cellId));
assert.ok(plan.cells.every(cell => cell.jobType === 'trellis2mlx_fast'));
assert.ok(plan.cells.every(cell => cell.requestedRoute === 'gpu-greenroom/trellis2mlx_fast'));
assert.ok(plan.cells.every(cell => cell.settings.resolution === 512));
assert.ok(plan.cells.every(cell => cell.settings.steps === 6));
assert.ok(plan.cells.every(cell => cell.settings.targetFaces === 200000));
assert.ok(plan.cells.every(cell => cell.settings.textureSize === 1024));
assert.ok(plan.cells.every(cell => cell.settings.cascade === false));
assert.ok(plan.cells.every(cell => cell.settings.simplifyFirst === true));
assert.ok(plan.cells.every(cell => cell.input.path.startsWith(durableImageRoot)));
assert.ok(plan.cells.every(cell => cell.outputPath.endsWith('/output.glb')));
assert.equal(plan.evidencePredicate.directInferenceForbidden, true);
assert.equal(plan.evidencePredicate.routeFallbackAllowed, false);
assert.equal(plan.evidencePredicate.spatialCoherenceRequiresRenderedWitness, true);
assert.equal(plan.evidencePredicate.visuallyNovelWithoutLineage, 'does_not_satisfy');

await assert.rejects(
  buildBranchingTrellisPromotionPlan({
    imagegenPlan,
    imagegenCompletion,
    adjudication: { ...adjudication, status: 'outputs-complete-uninspected' },
    durableImageRoot,
    outputRoot,
  }),
  /visually inspected/,
);
await assert.rejects(
  buildBranchingTrellisPromotionPlan({
    imagegenPlan,
    imagegenCompletion: { ...imagegenCompletion, accepted: accepted.slice(1) },
    adjudication,
    durableImageRoot,
    outputRoot,
  }),
  /not accepted/,
);

const promotionRunner = await readFile(new URL(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/trellis/run-promotion.mjs',
  import.meta.url,
), 'utf8');
assert.match(promotionRunner, /runGreenroom\(\['status', jobId\]\)/);
assert.doesNotMatch(promotionRunner, /\['status', jobId, '--json'\]/);
assert.match(promotionRunner, /complete-glbs-unwitnessed/);
assert.match(promotionRunner, /lastTrustworthyEvidence/);

const witnessScript = join(root, 'blender-witness.py');
await writeFile(witnessScript, 'print("witness")');
const trellisCompletionAccepted = [];
for (const cell of plan.cells) {
  const path = join(root, `${cell.cellId}.glb`);
  const bytes = Buffer.from(`glb:${cell.cellId}`);
  await writeFile(path, bytes);
  trellisCompletionAccepted.push({
    cellId: cell.cellId,
    evidenceRole: cell.evidenceRole,
    output: { path, bytes: bytes.length, sha256: sha256(bytes) },
  });
}
const trellisCompletion = {
  schema: 'kaminos.lirm-branching-trellis-collection.v0',
  status: 'complete-glbs-unwitnessed',
  accepted: trellisCompletionAccepted,
};
const witnessPlan = await buildBranchingTrellisWitnessPlan({
  trellisPlan: plan,
  trellisCompletion,
  witnessScript,
  outputRoot: join(root, 'witness'),
});
assert.equal(witnessPlan.schema, 'kaminos.lirm-branching-trellis-witness-plan.v0');
assert.equal(witnessPlan.cells.length, 12);
assert.deepEqual(witnessPlan.requiredViews.map(item => item.view), ['left', 'front', 'right', 'opposite']);
assert.equal(new Set(witnessPlan.cells.map(cell => cell.witnessId)).size, 12);
assert.deepEqual(
  [...new Set(witnessPlan.cells.map(cell => cell.evidenceRole))].sort(),
  selected.map(item => item.role).sort(),
);
assert.ok(witnessPlan.cells.every(cell => cell.input.path.endsWith('.glb')));
assert.ok(witnessPlan.cells.every(cell => cell.jobType === 'kaminos_blender_glb_witness_molten_0718'));
assert.equal(witnessPlan.evidencePredicate.blankOrMissingFrameCountsAsSuccess, false);
assert.equal(witnessPlan.evidencePredicate.spatialClaimRequiresHumanVisualInspection, true);
await assert.rejects(
  buildBranchingTrellisWitnessPlan({
    trellisPlan: plan,
    trellisCompletion: { ...trellisCompletion, status: 'waiting' },
    witnessScript,
    outputRoot: join(root, 'witness-invalid'),
  }),
  /not witnessable/,
);

const witnessRunner = await readFile(new URL(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/trellis/run-witness.mjs',
  import.meta.url,
), 'utf8');
assert.match(witnessRunner, /runGreenroom\(\['status', jobId\]\)/);
assert.doesNotMatch(witnessRunner, /\['status', jobId, '--json'\]/);
assert.match(witnessRunner, /complete-frames-uninspected/);
assert.match(witnessRunner, /visualInspectionClaim/);

const inspectedReport = JSON.parse(await readFile(new URL(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/trellis/report.json',
  import.meta.url,
), 'utf8'));
assert.equal(inspectedReport.schema, 'kaminos.lirm-branching-trellis-adjudication.v0');
assert.equal(inspectedReport.status, 'visually-inspected-three-spatial-hits');
assert.equal(inspectedReport.visualInspection.inspectedAtOriginalResolution, true);
assert.equal(inspectedReport.visualInspection.assets.length, 3);
assert.ok(inspectedReport.visualInspection.assets.every(asset => asset.spatialCoherence === 'confirmed'));
assert.ok(inspectedReport.visualInspection.assets.every(asset => asset.lineageSurvival !== 'failed'));
assert.equal(inspectedReport.findings.rareForkTopologySurvivedFullRoute, true);
assert.equal(inspectedReport.findings.priorAddedAnatomyBecameCoherent3d, true);
assert.equal(inspectedReport.nextAssay.status, 'selected');

console.log('LIRM branching Trellis promotion contracts passed');
