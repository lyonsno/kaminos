import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('artifacts/direct-three-legged-creature-basin-v0/reptilian-basin-probe-v1');
const contractPath = path.join(root, 'campaign-contract.json');
const cellsPath = path.join(root, 'cells.json');
const classificationPath = path.join(root, 'classification.json');
const launchDiagnosisPath = path.join(root, 'launch-diagnosis.json');
const operatorSheetPath = path.join(root, 'operator-selected.html');

function argvValue(argv, flag) {
  const index = argv.indexOf(flag);
  assert.ok(index >= 0, `effective argv must contain ${flag}`);
  assert.ok(index + 1 < argv.length, `${flag} must have a value`);
  return argv[index + 1];
}

assert.ok(fs.existsSync(contractPath), 'campaign contract must exist before launch');
assert.ok(fs.existsSync(cellsPath), 'cell registry must exist before launch');
assert.ok(fs.existsSync(classificationPath), 'classification must exist after inspection');
assert.ok(fs.existsSync(launchDiagnosisPath), 'failed launch diagnosis must be preserved');
assert.ok(fs.existsSync(operatorSheetPath), 'selected operator sheet must exist');

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const cells = JSON.parse(fs.readFileSync(cellsPath, 'utf8'));
const classification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));
const launchDiagnosis = JSON.parse(fs.readFileSync(launchDiagnosisPath, 'utf8'));

assert.equal(contract.schema, 'kaminos.exact-three-reptilian-basin-probe.v1');
assert.equal(contract.effectiveRoute.jobType, 'mflux_flux2_t2i');
assert.equal(contract.effectiveRoute.model, 'flux2-klein-9b');
assert.equal(contract.effectiveRoute.guidance, 1.0);
assert.equal(contract.effectiveRoute.steps, 4);
assert.equal(cells.length, 8, 'probe must contain exactly the eight preregistered cells');

const fixedSeed = cells.filter((cell) => cell.arm === 'fixed-seed-prompt-perturbation');
const hitRate = cells.filter((cell) => cell.arm === 'neutral-prompt-hit-rate');
assert.equal(fixedSeed.length, 5);
assert.ok(fixedSeed.every((cell) => cell.seed === 80301));
assert.equal(hitRate.length, 3);
assert.ok(hitRate.every((cell) => cell.promptId === 'control-neutral'));
assert.equal(new Set(hitRate.map((cell) => cell.seed)).size, 3);

for (const cell of cells) {
  assert.ok(cell.id);
  assert.ok(cell.promptId);
  assert.ok(Number.isInteger(cell.seed));
  assert.ok(cell.outputPath.endsWith('/output.png'));
  assert.ok(cell.jobId, `${cell.id} must name its valid replay job`);
  assert.ok(fs.existsSync(path.resolve(cell.promptPath)), `missing prompt for ${cell.id}`);
  assert.ok(fs.statSync(path.resolve(cell.outputPath)).size > 0, `missing output for ${cell.id}`);
  const receiptPath = path.join(path.dirname(path.resolve(cell.outputPath)), 'greenroom-receipt.json');
  assert.ok(fs.existsSync(receiptPath), `missing route receipt for ${cell.id}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.job_id, cell.jobId);
  assert.equal(receipt.status, 'done');
  assert.equal(receipt.exit_code, 0);
  assert.equal(receipt.requested_route, 'mflux_flux2_t2i');
  assert.equal(receipt.failure_phase, null);
  assert.equal(receipt.error_message, null);
  assert.equal(receipt.worker.capabilities.includes('structured-command.v1'), true);
  assert.match(receipt.effective_route, /mflux-generate-flux2/);
  assert.equal(argvValue(receipt.effective_argv, '--prompt-file'), path.resolve(cell.promptPath));
  assert.equal(argvValue(receipt.effective_argv, '--output'), path.resolve(cell.outputPath));
  assert.equal(argvValue(receipt.effective_argv, '--model'), contract.effectiveRoute.model);
  assert.equal(Number(argvValue(receipt.effective_argv, '--quantize')), contract.effectiveRoute.quantization);
  assert.equal(Number(argvValue(receipt.effective_argv, '--width')), contract.effectiveRoute.width);
  assert.equal(Number(argvValue(receipt.effective_argv, '--height')), contract.effectiveRoute.height);
  assert.equal(Number(argvValue(receipt.effective_argv, '--steps')), contract.effectiveRoute.steps);
  assert.equal(Number(argvValue(receipt.effective_argv, '--guidance')), contract.effectiveRoute.guidance);
  assert.equal(Number(argvValue(receipt.effective_argv, '--seed')), cell.seed);
  assert.equal(Number(argvValue(receipt.effective_argv, '--mlx-cache-limit-gb')), contract.effectiveRoute.mlxCacheLimitGb);
  const prompt = fs.readFileSync(path.resolve(cell.promptPath), 'utf8').trim();
  assert.ok(prompt.length > 0);
  assert.ok(prompt.split(/\s+/).length <= 16, `${cell.id} exceeds the concise-prompt ceiling`);
}

assert.deepEqual(contract.admission, {
  exactThreeContinuousLegs: true,
  visiblyInspectableThreeWayAttachment: true,
  noPlausibleHiddenFourthLeg: true,
  operatorUsableAesthetic: true,
  rapidEnvelopeAuthorability: true,
});

const classified = new Map(classification.cells.map((cell) => [cell.id, cell]));
assert.equal(classified.size, cells.length);
assert.ok(cells.every((cell) => classified.has(cell.id)));
const selected = classification.cells.filter((cell) => cell.disposition === 'select');
assert.equal(selected.length, 3);
assert.ok(selected.every((cell) => cell.safeForOperator));
assert.ok(selected.every((cell) => cell.isolatedBackground));
assert.ok(selected.every((cell) => cell.agentClassifiedAestheticallyUsable));
assert.ok(selected.every((cell) => cell.exactThreeContinuousLegs));
assert.ok(selected.every((cell) => cell.visiblyInspectableThreeWayAttachment));
assert.ok(selected.every((cell) => cell.noPlausibleHiddenFourthLeg));
assert.ok(selected.every((cell) => cell.rapidEnvelopeAuthorability));
assert.equal(classification.summary.operatorAestheticStatus, 'unreviewed');

const historicalPath = path.resolve(root, classification.summary.historicalNeutralPromptSource);
const historical = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
const historicalById = new Map(historical.cells.map((cell) => [cell.id, cell]));
assert.deepEqual(classification.summary.historicalNeutralPromptCells, [
  { id: 'd01-seed80301', exactThreeLegs: true },
  { id: 'd01-seed80302', exactThreeLegs: false },
  { id: 'd01-seed80413', exactThreeLegs: false },
]);
for (const cell of classification.summary.historicalNeutralPromptCells) {
  assert.equal(historicalById.get(cell.id)?.exactThreeLegs, cell.exactThreeLegs, `historical neutral classification drifted for ${cell.id}`);
}
const allNeutral = [
  ...classification.summary.historicalNeutralPromptCells.map((cell) => cell.exactThreeLegs),
  ...hitRate.map((cell) => classified.get(cell.id).exactThreeContinuousLegs),
];
assert.equal(allNeutral.length, 6);
assert.equal(allNeutral.filter(Boolean).length, 3);

assert.equal(launchDiagnosis.invalidLaunch.evidenceAuthority, 'none');
assert.match(launchDiagnosis.invalidLaunch.falseClosure, /exit code 0/);
assert.equal(launchDiagnosis.invalidLaunch.rawEvidenceRoot, 'failed-launch-runs');
for (const cell of cells) {
  const failedRoot = path.join(root, launchDiagnosis.invalidLaunch.rawEvidenceRoot, cell.id);
  const failedReceipt = JSON.parse(fs.readFileSync(path.join(failedRoot, 'greenroom-receipt.json'), 'utf8'));
  const failedStdout = fs.readFileSync(path.join(failedRoot, 'stdout.log'), 'utf8');
  assert.equal(failedReceipt.status, 'done');
  assert.equal(failedReceipt.exit_code, 0);
  assert.match(failedStdout, /Prompt file does not exist/);
  assert.equal(fs.existsSync(path.join(failedRoot, 'output.png')), false, `${cell.id} invalid launch must not have an output`);
}
assert.equal(launchDiagnosis.validReplay.transport, 'gpu-greenroom.command.v1');

const operatorSheet = fs.readFileSync(operatorSheetPath, 'utf8');
for (const cell of selected) {
  assert.match(operatorSheet, new RegExp(`data-cell="${cell.id}"`));
}
assert.doesNotMatch(operatorSheet, /p03-seed80301/);
assert.match(operatorSheet, /href="classification\.json"/);
assert.match(operatorSheet, /href="\.\.\/text-only-classification\.json"/);
for (const cell of classification.summary.historicalNeutralPromptCells) {
  assert.match(operatorSheet, new RegExp(cell.id));
}

console.log('exact-three reptilian basin probe contracts passed');
