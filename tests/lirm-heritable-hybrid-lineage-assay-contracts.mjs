import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildHeritableHybridLineagePlan,
  buildHeritableHybridLineageSheetManifest,
  writeHeritableHybridLineageWitness,
} from '../artifacts/lirm-heritable-hybrid-lineage-v0/assay-contract.mjs';
import {
  HERITABLE_HYBRID_BRANCHES,
  HERITABLE_HYBRID_FOUNDER,
} from '../lirm-heritable-hybrid-lineage-program.mjs';

const plan = buildHeritableHybridLineagePlan();
assert.equal(plan.schema, 'kaminos.lirm-heritable-hybrid-lineage-plan.v0');
assert.equal(plan.founderId, HERITABLE_HYBRID_FOUNDER.id);
assert.equal(plan.candidates.length, 10);
assert.equal(plan.lineages.length, 3);
assert.equal(plan.edges.length, 9);
assert.equal(new Set(plan.candidates.map(item => item.id)).size, 10);
assert.deepEqual(
  plan.lineages.map(item => item.terminalId),
  HERITABLE_HYBRID_BRANCHES.map(branch => branch.generations.at(-1).id),
);
assert.equal(plan.evidencePredicate.minimumInheritedCommitments, 4);
assert.equal(plan.evidencePredicate.minimumDistinctTerminalLineages, 3);

assert.throws(
  () => buildHeritableHybridLineagePlan({
    founder: HERITABLE_HYBRID_FOUNDER,
    branches: [{
      ...HERITABLE_HYBRID_BRANCHES[0],
      generations: [{ ...HERITABLE_HYBRID_BRANCHES[0].generations[0], parentId: 'missing-parent' }],
    }],
  }),
  /missing or misordered lineage parent/,
);

const mockOutputs = plan.candidates.map(candidate => ({
  id: candidate.id,
  clayPath: `/durable/${candidate.id}.png`,
  claySha256: `sha256:${candidate.id.padEnd(64, '0').slice(0, 64)}`,
}));
const sheet = buildHeritableHybridLineageSheetManifest({ plan, outputs: mockOutputs });
assert.equal(sheet.columns, 4);
assert.equal(sheet.rows, 3);
assert.equal(sheet.cells.length, 12);
assert.equal(sheet.cells.filter(cell => cell.candidateId === plan.founderId).length, 3);
for (let row = 0; row < 3; row += 1) {
  assert.equal(sheet.cells[row * 4].generation, 0);
  assert.deepEqual(sheet.cells.slice(row * 4 + 1, row * 4 + 4).map(cell => cell.generation), [1, 2, 3]);
}

const root = await mkdtemp(join(tmpdir(), 'kaminos-heritable-lineage-test-'));
try {
  await assert.rejects(
    writeHeritableHybridLineageWitness({ outDir: root, candidates: [] }),
    /requires ten lineage candidates/,
  );
  const failure = JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'lineage-validation');
  assert.match(failure.lastTrustworthyEvidence, /invocation recorded/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('LIRM heritable hybrid lineage assay contracts passed');
