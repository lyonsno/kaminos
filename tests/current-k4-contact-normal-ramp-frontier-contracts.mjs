import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-ring-cage-contact-normal-ramp-frontier.mjs',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-contact-normal-ramp-frontier-v0.json',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const CUSTODY_MARKER = '.kaminos-current-k4-contact-normal-ramp-frontier-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-contact-normal-ramp-frontier-output-custody.v0';

function run(output, { carrier = CARRIER, config = CONFIG } = {}) {
  return spawnSync(process.execPath, [
    TOOL,
    '--selected-carrier', carrier,
    '--source', SOURCE,
    '--config', config,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(output, relative) {
  return JSON.parse(await readFile(path.join(output, relative), 'utf8'));
}

test('the contact-normal ramp frontier preserves the full uncapped composition matrix', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-cn-frontier-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const report = await json(output, 'run-report.json');
  const frontier = await json(output, 'frontier-result.json');
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));

  const expectedIds = config.ramps.flatMap(ramp =>
    config.anisotropy.peakCompressionScales.map(scale =>
      `${ramp.id}-cn${String(Math.round(scale * 100)).padStart(3, '0')}`));
  assert.equal(report.status, 'completed');
  assert.equal(report.requestedCandidateCount, expectedIds.length);
  assert.equal(report.effectiveCandidateCount, expectedIds.length);
  assert.equal(report.candidateCapApplied, false);
  assert.deepEqual(frontier.requestedCandidateIds, expectedIds);
  assert.deepEqual(frontier.candidates.map(row => row.id), expectedIds);
  assert.equal(report.inputs.config.fallbackUsed, false);
  assert.deepEqual(report.inputs.config.requested, report.inputs.config.effective);
  assert.equal(report.lastTrustworthyEvidence.phase, 'frontier-result-written');
  assert.equal(frontier.visual.status, 'pending-agent-inspection');
  assert.equal(frontier.visual.requiredView, 'identity-bound-contact-region-close');

  const admissible = frontier.candidates.filter(row => row.status === 'admissible');
  assert.ok(admissible.length > 0, 'composition produced no admissible candidate');
  const admissibleIds = new Set(admissible.map(row => row.id));
  assert.ok(frontier.nondominatedCandidateIds.length > 0);
  assert.ok(frontier.nondominatedCandidateIds.every(id => admissibleIds.has(id)));

  for (const candidate of frontier.candidates) {
    assert.ok(expectedIds.includes(candidate.id));
    if (candidate.status === 'application-refused') {
      assert.equal(candidate.metrics, null);
      assert.ok(candidate.error);
      continue;
    }
    // Exact composition identity chain: selected carrier -> ramp -> anisotropy -> packed.
    const composition = await json(output, candidate.compositionApplication.path);
    assert.equal(
      composition.ramp.sourceCarrierSha256,
      frontier.selectedReference.carrierSha256,
    );
    assert.equal(
      composition.anisotropySelection.sourceCarrierSha256,
      composition.ramp.outputCarrierSha256,
    );
    assert.equal(
      composition.anisotropyApplication.sourceCarrierSha256,
      composition.ramp.outputCarrierSha256,
    );
    const packedCarrier = await json(output, candidate.packedCarrier.path);
    assert.equal(
      composition.anisotropyApplication.outputCarrierSha256,
      packedCarrier.identity.sha256,
    );
    const ledger = await json(output, candidate.residualLedger.path);
    assert.equal(ledger.sourceCarrierSha256, packedCarrier.identity.sha256);
    // The anisotropy is exactly two sections: full-strength peak, half-strength shoulder.
    const peak = candidate.requested.anisotropyPeakScale;
    const adjustments = composition.anisotropyApplication.effective;
    assert.equal(adjustments.length, 2);
    const bySection = new Map(adjustments.map(row => [row.sectionId, row]));
    const peakRow = bySection.get(config.anisotropy.peakSectionId);
    const shoulderRow = bySection.get(config.anisotropy.shoulderSectionId);
    assert.ok(peakRow && shoulderRow);
    assert.equal(peakRow.compressionScale, peak);
    assert.equal(shoulderRow.compressionScale, 1 - (1 - peak) / 2);
    // The pressure direction comes from the derived peak selection, not a hand-picked
    // axis; the contact-free shoulder inherits the same direction at half strength.
    const derived = composition.anisotropySelection.adjustments.find(
      selected => selected.sectionId === config.anisotropy.peakSectionId,
    );
    assert.ok(derived, 'selection lacks derived peak section');
    assert.deepEqual(peakRow.pressureDirection, derived.pressureDirection);
    assert.deepEqual(shoulderRow.pressureDirection, derived.pressureDirection);
  }
  for (const candidate of admissible) {
    assert.equal(candidate.metrics.fixedNodeMaximumDrift, 0);
    assert.equal(candidate.metrics.centerlineMaximumDrift, 0);
    assert.equal(candidate.metrics.nonPositiveCellCount, 0);
    assert.equal(candidate.metrics.compartmentMaximumEscape, 0);
    assert.ok(candidate.metrics.maximumSectionAreaRelativeError <=
      config.shared.maximumSectionAreaRelativeError);
    assert.ok(candidate.metrics.transferVolumeRelativeError <=
      config.shared.volumeRelativeTolerance);
    assert.ok(candidate.metrics.skeletalPenetrationIncrease <=
      config.shared.maximumSkeletalPenetrationIncrease);
    assert.deepEqual(candidate.refusalReasons, []);
  }
});

test('a contact-normal frontier parse failure clears only owned stale evidence and remains durable', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-cn-frontier-fail-'));
  await writeFile(path.join(output, CUSTODY_MARKER), `${CUSTODY_SCHEMA}\n`);
  await writeFile(path.join(output, 'frontier-result.json'), '{"status":"stale"}\n');
  await mkdir(path.join(output, 'candidates'), { recursive: true });
  await writeFile(path.join(output, 'candidates/stale.json'), '{}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputCustodyVerified, true);
  assert.equal(report.staleEvidenceCleared, true);
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(path.join(output, 'frontier-result.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(output, 'candidates/stale.json')), /ENOENT/);
});

test('a contact-normal frontier parse failure never clears a lookalike unowned directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-cn-frontier-unowned-'));
  await writeFile(path.join(output, 'frontier-result.json'), '{"owner":"other-tool"}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.outputCustodyVerified, false);
  assert.equal(report.staleEvidenceCleared, false);
  assert.equal(
    JSON.parse(await readFile(path.join(output, 'frontier-result.json'), 'utf8')).owner,
    'other-tool',
  );
});

test('an invalid peak compression scale fails loudly before any candidate work', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-cn-frontier-config-'));
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  config.anisotropy.peakCompressionScales = [1, 0.96];
  const configPath = path.join(output, 'input', 'invalid-config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config));
  const result = run(path.join(output, 'out'), { config: configPath });
  assert.notEqual(result.status, 0);
  const report = await json(path.join(output, 'out'), 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'validate-config');
  await assert.rejects(
    readFile(path.join(output, 'out', 'frontier-result.json')),
    /ENOENT/,
  );
});

test('a tampered selected-carrier identity cannot produce an admissible candidate', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-cn-frontier-tamper-'));
  const carrier = JSON.parse(await readFile(CARRIER, 'utf8'));
  carrier.cages[0].manifest.nodes[0].currentPosition[0] += 1e-6;
  const carrierPath = path.join(output, 'input', 'tampered-carrier.json');
  await mkdir(path.dirname(carrierPath), { recursive: true });
  await writeFile(carrierPath, JSON.stringify(carrier));
  const result = run(path.join(output, 'out'), { carrier: carrierPath });
  assert.notEqual(result.status, 0);
  const report = await json(path.join(output, 'out'), 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'measure-reference');
  assert.match(report.error, /identity mismatch/);
  await assert.rejects(
    readFile(path.join(output, 'out', 'frontier-result.json')),
    /ENOENT/,
  );
});
