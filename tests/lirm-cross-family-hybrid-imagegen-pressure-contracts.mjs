import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeCrossFamilyHybridPressureWitness,
} from '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/assay-contract.mjs';
import {
  buildCrossFamilyHybridImagegenPlan,
} from '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/imagegen-contract.mjs';

const outDir = await mkdtemp(join(tmpdir(), 'lirm-cross-family-hybrid-imagegen-'));
const witness = await writeCrossFamilyHybridPressureWitness({
  outDir,
  pixelWidth: 160,
  pixelHeight: 144,
});
const inspectedWitness = {
  ...witness,
  status: 'complete-inspected',
  visualInspectionClaim: 'inspected',
};
const promptRoot = new URL(
  '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/prompts/',
  import.meta.url,
).pathname;
const plan = await buildCrossFamilyHybridImagegenPlan({
  witnessReceipt: inspectedWitness,
  witnessRoot: outDir,
  promptRoot,
  outputRoot: join(outDir, 'runtime'),
  seeds: [718401],
});

assert.equal(plan.schema, 'kaminos.lirm-cross-family-hybrid-imagegen-pressure-plan.v0');
assert.equal(plan.cells.length, 6);
assert.equal(new Set(plan.cells.map(cell => cell.cellId)).size, 6);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.stance))].sort(), [
  'anatomical-completion',
  'prior-led-invention',
]);
assert.equal(new Set(plan.cells.map(cell => cell.candidateId)).size, 3);
assert.ok(plan.cells.every(cell => cell.requestedRoute === 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref'));
assert.ok(plan.cells.every(cell => cell.settings.model === 'flux2-klein-9b'));
assert.ok(plan.cells.every(cell => cell.settings.steps === 8));
assert.ok(plan.cells.every(cell => cell.settings.guidance === 1));
assert.equal(plan.comparisonContract.minimumSurvivingCommitments, 2);
assert.equal(plan.falseClosureGuards.parentReversionCountsAsSuccess, false);
assert.equal(plan.falseClosureGuards.singleCommitmentSurvivalCountsAsSuccess, false);
await assert.rejects(
  buildCrossFamilyHybridImagegenPlan({
    witnessReceipt: witness,
    witnessRoot: outDir,
    promptRoot,
    outputRoot: join(outDir, 'invalid-runtime'),
  }),
  /visually inspected hybrid witness/,
);
await assert.rejects(
  buildCrossFamilyHybridImagegenPlan({
    witnessReceipt: {
      ...inspectedWitness,
      visualInspectionClaim: 'not-yet-inspected',
    },
    witnessRoot: outDir,
    promptRoot,
    outputRoot: join(outDir, 'sentinel-bypass-runtime'),
  }),
  /visually inspected hybrid witness/,
);

const runner = await readFile(new URL(
  '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/run-imagegen.mjs',
  import.meta.url,
), 'utf8');
assert.match(runner, /buildCrossFamilyHybridImagegenPlan/);
assert.match(runner, /validateGestaltImagegenCompletion/);
assert.match(runner, /lastTrustworthyEvidence/);
assert.match(runner, /failurePhase/);

console.log('LIRM cross-family hybrid imagegen pressure contracts passed');
