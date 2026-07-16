import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'volume-settings-preset-replay-capture.mjs');
const preset = join(root, 'fixtures/volume/settings-presets/latest_happy_bowl/preset.json');
const provenance = join(root, 'fixtures/volume/settings-presets/latest_happy_bowl/provenance.json');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-settings-preset-replay-'));
const capturePath = join(fixture, 'capture.json');
const reportPath = join(fixture, 'report.json');
const expectedPresetId = 'vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8';
const originalPresetFileSha256 = createHash('sha256').update(readFileSync(preset)).digest('hex');

assert.ok(existsSync(script), 'settings-preset replay-capture adapter exists');
assert.ok(existsSync(provenance), 'settings-preset detached provenance receipt exists');

function runAdapter(...adapterArgs) {
  return spawnSync(process.execPath, [script, ...adapterArgs], { cwd: root, encoding: 'utf8' });
}

const run = runAdapter(
  '--preset', preset,
  '--out', capturePath,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:18961',
  '--control-overrides-json', JSON.stringify({ volume_resolution: '160' }),
  '--expected-preset-id', expectedPresetId,
  '--provenance', provenance,
  '--expected-source-commit', '027bcaca138da6e545065b90c5607b5a4a1b2965',
);
assert.equal(run.status, 0, run.stderr || run.stdout);

const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(capture.schema, 'kaminos.operator-exact-live-splat-basin-capture.v1');
assert.equal(capture.identity, 'settings-preset-replay-capture-v0');
assert.equal(capture.controlCount, 188);
assert.equal(capture.sourcePreset.presetId, expectedPresetId);
assert.equal(capture.sourcePreset.artifactFileSha256, originalPresetFileSha256);
assert.equal(capture.sourcePreset.artifactFileSha256Authority, 'transport-receipt-only-v0');
assert.equal(capture.sourcePreset.semanticIdentityAuthority, 'canonical-schema-and-control-values-sha256-v0');
assert.equal(capture.sourcePreset.sourceCommit, '027bcaca138da6e545065b90c5607b5a4a1b2965');
assert.equal(capture.sourcePreset.sourceProvenance.identity, 'kaminos-volume-settings-preset-provenance-v1');
assert.deepEqual(capture.controlOverrides, {
  volume_resolution: { preset: '96', effective: '160' },
});
const replay = new URL(capture.replayRoute);
assert.equal(replay.origin, 'http://127.0.0.1:18961');
assert.equal(replay.searchParams.get('volume_resolution'), '160');
assert.equal([...replay.searchParams].length, 188);
const { payloadSha256, hashAuthority, ...payload } = capture;
const actualPayloadSha256 = createHash('sha256').update(JSON.stringify(payload, null, 2)).digest('hex');
assert.equal(payloadSha256, actualPayloadSha256);
assert.equal(hashAuthority, 'sha256-of-pre-hash-payload-json-utf8-pretty-printed-v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.capture.payloadSha256, capture.payloadSha256);
assert.equal(report.requestedPreset.artifactFileSha256, capture.sourcePreset.artifactFileSha256);
assert.equal(report.requestedPreset.artifactFileSha256Authority, 'transport-receipt-only-v0');
assert.equal(report.requestedRouteControlCount, 188);
assert.equal(report.effectiveRouteControlCount, 188);

const rejectedCapturePath = join(fixture, 'rejected-capture.json');
const rejectedReportPath = join(fixture, 'rejected-report.json');
const rejected = runAdapter(
  '--preset', preset,
  '--out', rejectedCapturePath,
  '--report', rejectedReportPath,
  '--target-origin', 'http://127.0.0.1:18961/path-is-not-origin-only',
  '--expected-preset-id', capture.sourcePreset.presetId,
  '--provenance', provenance,
);
assert.notEqual(rejected.status, 0, 'invalid target origin was accepted');
assert.equal(existsSync(rejectedCapturePath), false, 'failed conversion wrote a primary capture');
const rejectedReport = JSON.parse(readFileSync(rejectedReportPath, 'utf8'));
assert.equal(rejectedReport.status, 'failed');
assert.equal(rejectedReport.failurePhase, 'target-origin-validation');
assert.match(rejectedReport.error, /origin only/);
assert.equal(rejectedReport.lastTrustworthyEvidence.artifactFileSha256, capture.sourcePreset.artifactFileSha256);
assert.equal(rejectedReport.lastTrustworthyEvidence.artifactFileSha256Authority, 'transport-receipt-only-v0');

const relocatedPresetPath = join(fixture, 'relocated-preset.json');
const relocatedCapturePath = join(fixture, 'relocated-capture.json');
const relocatedReportPath = join(fixture, 'relocated-report.json');
const relocatedPreset = JSON.parse(readFileSync(preset, 'utf8'));
relocatedPreset.writtenAt = '2099-01-01T00:00:00Z';
relocatedPreset.source = {
  repoRoot: '/a/different/checkout',
  serverPort: 65530,
  branch: 'renamed-without-changing-the-flame',
  commit: '027bcaca138da6e545065b90c5607b5a4a1b2965',
};
writeFileSync(relocatedPresetPath, JSON.stringify(relocatedPreset));
const relocatedFileSha256 = createHash('sha256').update(readFileSync(relocatedPresetPath)).digest('hex');
assert.notEqual(relocatedFileSha256, originalPresetFileSha256, 'test fixture did not change transport bytes');

const relocated = runAdapter(
  '--preset', relocatedPresetPath,
  '--out', relocatedCapturePath,
  '--report', relocatedReportPath,
  '--target-origin', 'http://127.0.0.1:18961',
  '--expected-preset-id', expectedPresetId,
  '--provenance', provenance,
);
assert.equal(relocated.status, 0, relocated.stderr || relocated.stdout);
const relocatedCapture = JSON.parse(readFileSync(relocatedCapturePath, 'utf8'));
assert.equal(relocatedCapture.sourcePreset.presetId, expectedPresetId);
assert.equal(relocatedCapture.sourcePreset.artifactFileSha256, relocatedFileSha256);
assert.equal(relocatedCapture.sourcePreset.contentHash, capture.sourcePreset.contentHash);

const mutatedPresetPath = join(fixture, 'mutated-preset.json');
const mutatedCapturePath = join(fixture, 'mutated-capture.json');
const mutatedReportPath = join(fixture, 'mutated-report.json');
const mutatedPreset = JSON.parse(readFileSync(preset, 'utf8'));
const density = mutatedPreset.preset.domControls['volume-density'];
density.value = Number(density.value) + 0.125;
const mutatedRoute = new URL(mutatedPreset.preset.route);
mutatedRoute.searchParams.set(density.param, String(density.value));
mutatedPreset.preset.route = mutatedRoute.href;
writeFileSync(mutatedPresetPath, `${JSON.stringify(mutatedPreset, null, 2)}\n`);

const mutated = runAdapter(
  '--preset', mutatedPresetPath,
  '--out', mutatedCapturePath,
  '--report', mutatedReportPath,
  '--target-origin', 'http://127.0.0.1:18961',
  '--expected-preset-id', expectedPresetId,
  '--provenance', provenance,
);
assert.notEqual(mutated.status, 0, 'executable control mutation retained the old semantic preset identity');
assert.equal(existsSync(mutatedCapturePath), false, 'semantic identity failure wrote a primary capture');
const mutatedReport = JSON.parse(readFileSync(mutatedReportPath, 'utf8'));
assert.equal(mutatedReport.status, 'failed');
assert.equal(mutatedReport.failurePhase, 'preset-validation');
assert.match(mutatedReport.error, /semantic content hash mismatch/);

const wrongProvenancePath = join(fixture, 'wrong-provenance.json');
const wrongProvenanceCapturePath = join(fixture, 'wrong-provenance-capture.json');
const wrongProvenanceReportPath = join(fixture, 'wrong-provenance-report.json');
const wrongProvenance = JSON.parse(readFileSync(provenance, 'utf8'));
wrongProvenance.sourceCommit = '1111111111111111111111111111111111111111';
writeFileSync(wrongProvenancePath, `${JSON.stringify(wrongProvenance, null, 2)}\n`);
const rejectedProvenance = runAdapter(
  '--preset', preset,
  '--provenance', wrongProvenancePath,
  '--expected-source-commit', '027bcaca138da6e545065b90c5607b5a4a1b2965',
  '--expected-preset-id', expectedPresetId,
  '--target-origin', 'http://127.0.0.1:18961',
  '--out', wrongProvenanceCapturePath,
  '--report', wrongProvenanceReportPath,
);
assert.notEqual(rejectedProvenance.status, 0, 'wrong detached source provenance was accepted');
assert.equal(existsSync(wrongProvenanceCapturePath), false, 'provenance failure wrote a primary capture');
const wrongProvenanceReport = JSON.parse(readFileSync(wrongProvenanceReportPath, 'utf8'));
assert.equal(wrongProvenanceReport.status, 'failed');
assert.equal(wrongProvenanceReport.failurePhase, 'preset-validation');
assert.match(wrongProvenanceReport.error, /provenance source commit mismatch/);
assert.equal(wrongProvenanceReport.lastTrustworthyEvidence.declaredPresetId, expectedPresetId);
assert.match(wrongProvenanceReport.lastTrustworthyEvidence.artifactFileSha256, /^[0-9a-f]{64}$/);

const invocationReportPath = join(fixture, 'invocation-report.json');
const missingArgument = runAdapter(
  '--report', invocationReportPath,
);
assert.notEqual(missingArgument.status, 0, 'missing required arguments were accepted');
assert.ok(existsSync(invocationReportPath), 'invocation failure did not write its durable report');
const invocationReport = JSON.parse(readFileSync(invocationReportPath, 'utf8'));
assert.equal(invocationReport.status, 'failed');
assert.equal(invocationReport.failurePhase, 'argument-validation');
assert.match(invocationReport.error, /missing --preset/);
assert.deepEqual(invocationReport.lastTrustworthyEvidence, {});

console.log('settings-preset replay capture contracts passed');
