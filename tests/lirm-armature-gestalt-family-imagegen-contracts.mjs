import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const {
  ARMATURE_GESTALT_FAMILY_IMAGEGEN_PLAN_SCHEMA,
  buildArmatureGestaltFamilyImagegenMatrix,
  buildArmatureGestaltFamilyImagegenContactSheetManifest,
} = await import('../lirm-armature-program-imagegen-core.mjs');

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = await mkdtemp(join(tmpdir(), 'lirm-gestalt-family-imagegen-'));
const conditioningRoot = join(root, 'conditioning');
const promptRoot = join(root, 'prompts');
await Promise.all([mkdir(conditioningRoot, { recursive: true }), mkdir(promptRoot, { recursive: true })]);
await writeFile(join(promptRoot, 'world-creature-invention.txt'), 'invent a compelling fictional organism');

const candidateIds = [
  'crawler-basin22',
  'upright-basin03',
  'upright-basin10',
  'upright-basin22',
  'bulbous-radial-lirm02',
];
const familyCandidates = [];
for (const [index, candidateId] of candidateIds.entries()) {
  const candidateRoot = join(conditioningRoot, 'candidates', candidateId);
  await mkdir(candidateRoot, { recursive: true });
  const maps = {};
  for (const role of ['clay', 'depth', 'normal']) {
    const bytes = Buffer.from(`${candidateId}-${role}`);
    const rasterPath = `${role}.png`;
    await writeFile(join(candidateRoot, rasterPath), bytes);
    maps[role] = { bytes, rasterPath };
  }
  const receipt = {
    schema: 'kaminos.lirm-armature-program-implicit-body-witness.v0',
    status: 'complete',
    effectiveRoute: 'kaminos/lirm-armature-program/implicit-body-v0',
    candidateId,
    armatureProgram: {
      id: index === 0 ? 'fixture.crawler.v0' : index === 4 ? 'fixture.bulbous.v0' : 'fixture.upright.v0',
      parameterVocabulary: 'fixture.vocabulary.v0',
    },
    parameters: { bodyScale: index + 1 },
    effectiveConfig: { pixelWidth: 256, pixelHeight: 192, projection: 'orthographic' },
    outputInventory: {
      maps: Object.entries(maps).map(([kind, map]) => ({ kind, rasterPath: map.rasterPath })),
    },
    outputEvidence: Object.entries(maps).map(([role, map]) => ({
      path: map.rasterPath,
      byteSize: map.bytes.length,
      sha256: sha256(map.bytes),
    })),
  };
  const receiptPath = join(candidateRoot, 'receipt.json');
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(receiptPath, receiptBytes);
  familyCandidates.push({
    id: candidateId,
    receiptPath: `candidates/${candidateId}/receipt.json`,
    receiptEvidence: {
      path: `candidates/${candidateId}/receipt.json`,
      byteSize: receiptBytes.length,
      sha256: sha256(receiptBytes),
    },
  });
}

const familyReceipt = {
  schema: 'kaminos.lirm-armature-gestalt-family-witness.v0',
  status: 'complete',
  effectiveRoute: 'kaminos/lirm-armature-gestalt-family/source-anchored-conditioning-v0',
  requestedCandidateIds: candidateIds,
  candidates: familyCandidates,
};

const plan = await buildArmatureGestaltFamilyImagegenMatrix({
  familyReceipt,
  conditioningRoot,
  promptRoot,
  outputRoot: join(root, 'outputs'),
  seeds: [718021, 718113],
  stance: { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  referenceSets: [
    { id: 'clay-only', roles: ['clay'] },
    { id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] },
  ],
});

assert.equal(plan.schema, ARMATURE_GESTALT_FAMILY_IMAGEGEN_PLAN_SCHEMA);
assert.equal(plan.cells.length, 20);
assert.equal(new Set(plan.cells.map(cell => cell.cellId)).size, 20);
assert.deepEqual(plan.comparisonContract.fixedCandidateIds, candidateIds);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.candidateId))], candidateIds);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.referenceSet))], ['clay-only', 'clay-depth-normal']);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.seed))], [718021, 718113]);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.stance))], ['world-creature-invention']);
assert.equal(new Set(plan.cells.map(cell => cell.armatureProgram.id)).size, 3);
assert.ok(plan.cells.every(cell => cell.settings.steps === 8 && cell.settings.width === 512));

const accepted = [];
for (const cell of plan.cells) {
  const outputBytes = Buffer.from(`generated-${cell.cellId}`);
  await mkdir(dirname(cell.outputPath), { recursive: true });
  await writeFile(cell.outputPath, outputBytes);
  accepted.push({
    schema: 'kaminos.lirm-speciation-gestalt-imagegen-completion.v0',
    status: 'accepted',
    cellId: cell.cellId,
    output: { path: cell.outputPath, bytes: outputBytes.length, sha256: sha256(outputBytes) },
  });
}
const contactSheetManifest = await buildArmatureGestaltFamilyImagegenContactSheetManifest({
  plan,
  completion: {
    schema: 'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0',
    status: 'complete',
    accepted,
  },
});
assert.equal(contactSheetManifest.sheets.length, 2);
assert.deepEqual(contactSheetManifest.sheets.map(sheet => sheet.seed), [718021, 718113]);
assert.ok(contactSheetManifest.sheets.every(sheet => sheet.sheet.cells.length === 20));
assert.ok(contactSheetManifest.sheets.every(sheet => sheet.sheet.width === 2048));
assert.ok(contactSheetManifest.sheets.every(sheet => (
  sheet.sheet.cells.filter(cell => cell.viewLabel === 'ARMATURE').length === 5
)));
assert.deepEqual(
  contactSheetManifest.sheets[0].sheet.cells.slice(0, 4).map(cell => cell.viewLabel),
  ['ARMATURE', 'NORMAL', 'CLAY', '3REF'],
);

const driftedCompletion = {
  schema: 'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0',
  status: 'complete',
  accepted: structuredClone(accepted),
};
driftedCompletion.accepted[7].output.sha256 = 'sha256:drifted-output';
await assert.rejects(
  () => buildArmatureGestaltFamilyImagegenContactSheetManifest({ plan, completion: driftedCompletion }),
  /generated output hash drift/,
);

const driftedFamily = structuredClone(familyReceipt);
driftedFamily.candidates[2].receiptEvidence.sha256 = 'sha256:drifted';
await assert.rejects(
  () => buildArmatureGestaltFamilyImagegenMatrix({
    familyReceipt: driftedFamily,
    conditioningRoot,
    promptRoot,
    outputRoot: join(root, 'drifted'),
    stance: { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  }),
  /family candidate receipt hash mismatch: upright-basin10/,
);

const duplicateFamily = structuredClone(familyReceipt);
duplicateFamily.candidates[4].id = duplicateFamily.candidates[0].id;
await assert.rejects(
  () => buildArmatureGestaltFamilyImagegenMatrix({
    familyReceipt: duplicateFamily,
    conditioningRoot,
    promptRoot,
    outputRoot: join(root, 'duplicate'),
    stance: { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  }),
  /duplicate family candidate id/,
);

const roundTrip = JSON.parse(JSON.stringify(plan));
assert.equal((await readFile(roundTrip.cells[0].prompt.path)).length > 0, true);
console.log('lirm armature gestalt family imagegen contracts passed');
