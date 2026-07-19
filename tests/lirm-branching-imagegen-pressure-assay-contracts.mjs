import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { buildBranchingImagegenPressurePlan } = await import(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/assay-contract.mjs'
);

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = await mkdtemp(join(tmpdir(), 'lirm-branching-imagegen-pressure-'));
const promptRoot = join(root, 'prompts');
const outputRoot = join(root, 'outputs');
await mkdir(promptRoot, { recursive: true });

const stanceFiles = [
  ['anatomical-completion', 'anatomical-completion.txt'],
  ['prior-led-invention', 'prior-led-invention.txt'],
  ['semantic-role-interpretation', 'semantic-role-interpretation.txt'],
];
for (const [, file] of stanceFiles) await writeFile(join(promptRoot, file), `prompt:${file}`);

const makeCandidate = async candidateId => {
  const candidateRoot = join(root, candidateId);
  await mkdir(candidateRoot, { recursive: true });
  const maps = [];
  const outputEvidence = [];
  for (const kind of ['clay', 'depth', 'normal']) {
    const bytes = Buffer.from(`${candidateId}:${kind}`);
    const rasterPath = `${kind}.png`;
    await writeFile(join(candidateRoot, rasterPath), bytes);
    maps.push({ kind, rasterPath });
    outputEvidence.push({ path: rasterPath, byteSize: bytes.length, sha256: sha256(bytes) });
  }
  return {
    receipt: {
      schema: 'kaminos.lirm-armature-program-implicit-body-witness.v0',
      status: 'complete',
      effectiveRoute: 'kaminos/lirm-armature-program/implicit-body-v0',
      candidateId,
      armatureProgram: {
        id: `fixture.${candidateId}.v0`,
        parameterVocabulary: `fixture.${candidateId}.parameters.v0`,
      },
      parameters: { bodyScale: 1 },
      effectiveConfig: { projection: 'orthographic' },
      outputInventory: { maps },
      outputEvidence,
    },
    conditioningRoot: candidateRoot,
  };
};

const candidates = await Promise.all([
  makeCandidate('forked-saddle-lirm02'),
  makeCandidate('asymmetric-bead-chain-lirm07'),
]);
const plan = await buildBranchingImagegenPressurePlan({
  candidates,
  promptRoot,
  outputRoot,
  seeds: [718201, 718202],
});

assert.equal(plan.schema, 'kaminos.lirm-branching-imagegen-pressure-plan.v0');
assert.equal(plan.status, 'planned');
assert.equal(plan.cells.length, 12);
assert.deepEqual(plan.comparisonContract.candidateIds, [
  'forked-saddle-lirm02',
  'asymmetric-bead-chain-lirm07',
]);
assert.deepEqual(plan.comparisonContract.stances, stanceFiles.map(([id]) => id));
assert.deepEqual(plan.comparisonContract.seeds, [718201, 718202]);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.referenceSet))], ['clay-depth-normal']);
assert.ok(plan.cells.every(cell => cell.jobType === 'mflux_flux2_edit_promptfile_3ref'));
assert.ok(plan.cells.every(cell => cell.references.map(item => item.role).join(',') === 'depth,normal'));
assert.ok(plan.cells.every(cell => cell.settings.steps === 8 && cell.settings.width === 512));
assert.equal(new Set(plan.cells.map(cell => cell.cellId)).size, 12);
assert.equal(plan.falseClosureGuards.directInferenceForbidden, true);
assert.equal(plan.falseClosureGuards.everyConditioningInputMustMatchWitnessHash, true);
assert.equal(plan.falseClosureGuards.visuallyDistinctOutputWithoutLineage, 'does_not_satisfy');

const runnerSource = await readFile(new URL(
  '../artifacts/lirm-branching-imagegen-pressure-assay-v0/run-assay.mjs',
  import.meta.url,
), 'utf8');
assert.match(runnerSource, /spawnSync\(greenroomCli, \['status', jobId\]/);
assert.doesNotMatch(runnerSource, /\['status', jobId, '--json'\]/);

console.log('LIRM branching imagegen pressure assay contracts passed');
