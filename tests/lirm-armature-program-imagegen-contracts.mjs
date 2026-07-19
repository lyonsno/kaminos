import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const {
  ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA,
  buildArmatureProgramImagegenMatrix,
  buildArmatureProgramTrellisPromotionPlan,
} = await import('../lirm-armature-program-imagegen-core.mjs');

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = await mkdtemp(join(tmpdir(), 'lirm-program-imagegen-'));
const conditioningRoot = join(root, 'conditioning');
const candidateId = 'bulbous-radial-fixture';
const candidateRoot = join(conditioningRoot, candidateId);
const promptRoot = join(root, 'prompts');
await Promise.all([mkdir(candidateRoot, { recursive: true }), mkdir(promptRoot, { recursive: true })]);

const sources = {
  clay: Buffer.from('clay-control'),
  depth: Buffer.from('depth-control'),
  normal: Buffer.from('normal-control'),
};
const relativePaths = {
  clay: `${candidateId}/clay-implicit.png`,
  depth: `${candidateId}/depth-implicit.png`,
  normal: `${candidateId}/normal-implicit.png`,
};
for (const role of Object.keys(sources)) {
  await writeFile(join(conditioningRoot, relativePaths[role]), sources[role]);
}
await writeFile(join(promptRoot, 'controlled-organism.txt'), 'finish a coherent fictional creature');
await writeFile(join(promptRoot, 'world-creature-invention.txt'), 'invent a compelling world creature');

const receipt = {
  schema: 'kaminos.lirm-armature-program-implicit-body-witness.v0',
  status: 'complete',
  effectiveRoute: 'kaminos/lirm-armature-program/implicit-body-v0',
  candidateId,
  armatureProgram: {
    id: 'fixture.program.v0',
    parameterVocabulary: 'fixture.vocabulary.v0',
  },
  parameters: { posteriorScale: 1.2 },
  effectiveConfig: { pixelWidth: 256, pixelHeight: 192, projection: 'orthographic' },
  outputInventory: {
    maps: Object.entries(relativePaths).map(([kind, rasterPath]) => ({ kind, rasterPath })),
  },
  outputEvidence: Object.entries(relativePaths).map(([role, path]) => ({
    path,
    byteSize: sources[role].length,
    sha256: sha256(sources[role]),
  })),
};

const plan = await buildArmatureProgramImagegenMatrix({
  conditioningReceipt: receipt,
  conditioningRoot,
  promptRoot,
  outputRoot: join(root, 'outputs'),
  seeds: [718021, 718113],
  stances: [
    { id: 'controlled-organism', file: 'controlled-organism.txt' },
    { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  ],
  referenceSets: [
    { id: 'clay-only', roles: ['clay'] },
    { id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] },
  ],
});

assert.equal(plan.schema, ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA);
assert.equal(plan.cells.length, 8);
assert.equal(new Set(plan.cells.map(cell => cell.cellId)).size, 8);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.referenceSet))], ['clay-only', 'clay-depth-normal']);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.stance))], ['controlled-organism', 'world-creature-invention']);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.seed))], [718021, 718113]);
assert.ok(plan.cells.filter(cell => cell.referenceSet === 'clay-only').every(cell => (
  cell.jobType === 'mflux_flux2_edit_promptfile' && cell.references.length === 0
)));
assert.ok(plan.cells.filter(cell => cell.referenceSet === 'clay-depth-normal').every(cell => (
  cell.jobType === 'mflux_flux2_edit_promptfile_3ref'
  && cell.input.role === 'clay'
  && cell.references.map(reference => reference.role).join(',') === 'depth,normal'
)));
assert.ok(plan.cells.every(cell => cell.armatureProgram.id === 'fixture.program.v0'));
assert.ok(plan.cells.every(cell => cell.input.sha256 === receipt.outputEvidence[0].sha256));

const driftedReceipt = structuredClone(receipt);
driftedReceipt.outputEvidence[1].sha256 = 'sha256:drifted';
await assert.rejects(
  () => buildArmatureProgramImagegenMatrix({
    conditioningReceipt: driftedReceipt,
    conditioningRoot,
    promptRoot,
    outputRoot: join(root, 'drifted'),
    seeds: [718021],
    stances: [{ id: 'controlled-organism', file: 'controlled-organism.txt' }],
    referenceSets: [{ id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] }],
  }),
  /conditioning evidence hash mismatch.*depth/,
);

await assert.rejects(
  () => buildArmatureProgramImagegenMatrix({
    conditioningReceipt: { ...receipt, status: 'running' },
    conditioningRoot,
    promptRoot,
    outputRoot: join(root, 'incomplete'),
  }),
  /conditioning witness is not complete/,
);

await assert.rejects(
  () => buildArmatureProgramImagegenMatrix({
    conditioningReceipt: receipt,
    conditioningRoot,
    promptRoot,
    outputRoot: join(root, 'bad-reference-set'),
    referenceSets: [{ id: 'unsupported', roles: ['depth'] }],
  }),
  /reference set must begin with clay/,
);

const planRoundTrip = JSON.parse(JSON.stringify(plan));
assert.deepEqual(planRoundTrip.comparisonContract.variedReferenceSets, ['clay-only', 'clay-depth-normal']);
assert.equal(resolve(plan.cells[0].input.path), resolve(conditioningRoot, relativePaths.clay));
assert.equal((await readFile(plan.cells[0].prompt.path)).length > 0, true);

const accepted = await Promise.all(plan.cells.map(async cell => ({
  schema: 'kaminos.lirm-speciation-gestalt-imagegen-completion.v0',
  status: 'accepted',
  cellId: cell.cellId,
  output: {
    path: cell.input.path,
    bytes: cell.input.bytes,
    sha256: cell.input.sha256,
  },
})));
const promotedCellIds = plan.cells
  .filter(cell => cell.stance === 'world-creature-invention')
  .map(cell => cell.cellId);
const trellisPlan = await buildArmatureProgramTrellisPromotionPlan({
  imagegenPlan: plan,
  imagegenCompletion: {
    schema: 'kaminos.lirm-armature-program-imagegen-collection.v0',
    status: 'complete',
    accepted,
  },
  promotedCellIds,
  outputRoot: join(root, 'trellis'),
  comparisonContract: {
    kind: 'armature-reference-seed-factorial',
    fixedStance: 'world-creature-invention',
    referenceSets: ['clay-only', 'clay-depth-normal'],
    imagegenSeeds: [718021, 718113],
  },
});
assert.equal(trellisPlan.schema, 'kaminos.lirm-speciation-gestalt-trellis-plan.v0');
assert.equal(trellisPlan.cells.length, 4);
assert.deepEqual(
  trellisPlan.cells.map(cell => `${cell.referenceSet}:${cell.imagegenSeed}`).sort(),
  [
    'clay-depth-normal:718021',
    'clay-depth-normal:718113',
    'clay-only:718021',
    'clay-only:718113',
  ],
);
assert.ok(trellisPlan.cells.every(cell => cell.stance === 'world-creature-invention'));
assert.ok(trellisPlan.cells.every(cell => cell.settings.steps === 6));
assert.ok(trellisPlan.cells.every(cell => cell.settings.targetFaces === 200000));
await assert.rejects(
  () => buildArmatureProgramTrellisPromotionPlan({
    imagegenPlan: plan,
    imagegenCompletion: {
      schema: 'kaminos.lirm-armature-program-imagegen-collection.v0',
      status: 'complete',
      accepted,
    },
    promotedCellIds: promotedCellIds.slice(0, 3),
    outputRoot: join(root, 'trellis-incomplete'),
    comparisonContract: {
      kind: 'armature-reference-seed-factorial',
      fixedStance: 'world-creature-invention',
      referenceSets: ['clay-only', 'clay-depth-normal'],
      imagegenSeeds: [718021, 718113],
    },
  }),
  /factorial cell coverage mismatch/,
);

console.log('lirm armature program imagegen contracts passed');
