import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'volume-settings-preset-replay-capture.mjs');
const preset = join(root, 'fixtures/volume/settings-presets/latest_happy_bowl/preset.json');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-settings-preset-replay-'));
const capturePath = join(fixture, 'capture.json');
const reportPath = join(fixture, 'report.json');

assert.ok(existsSync(script), 'settings-preset replay-capture adapter exists');

const run = spawnSync(process.execPath, [
  script,
  '--preset', preset,
  '--out', capturePath,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:18961',
  '--control-overrides-json', JSON.stringify({ volume_resolution: '160' }),
  '--expected-preset-id', 'vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8',
  '--expected-file-sha256', 'bf13e68b6904cfc5677b13af14afe4426f15f9649bfda22105eed8611c5d0967',
], { cwd: root, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);

const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(capture.schema, 'kaminos.operator-exact-live-splat-basin-capture.v1');
assert.equal(capture.identity, 'settings-preset-replay-capture-v0');
assert.equal(capture.controlCount, 188);
assert.equal(capture.sourcePreset.presetId, 'vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8');
assert.equal(capture.sourcePreset.fileSha256, 'bf13e68b6904cfc5677b13af14afe4426f15f9649bfda22105eed8611c5d0967');
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
assert.equal(report.requestedPreset.fileSha256, capture.sourcePreset.fileSha256);
assert.equal(report.requestedRouteControlCount, 188);
assert.equal(report.effectiveRouteControlCount, 188);

const rejectedCapturePath = join(fixture, 'rejected-capture.json');
const rejectedReportPath = join(fixture, 'rejected-report.json');
const rejected = spawnSync(process.execPath, [
  script,
  '--preset', preset,
  '--out', rejectedCapturePath,
  '--report', rejectedReportPath,
  '--target-origin', 'http://127.0.0.1:18961/path-is-not-origin-only',
  '--expected-preset-id', capture.sourcePreset.presetId,
  '--expected-file-sha256', capture.sourcePreset.fileSha256,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(rejected.status, 0, 'invalid target origin was accepted');
assert.equal(existsSync(rejectedCapturePath), false, 'failed conversion wrote a primary capture');
const rejectedReport = JSON.parse(readFileSync(rejectedReportPath, 'utf8'));
assert.equal(rejectedReport.status, 'failed');
assert.equal(rejectedReport.failurePhase, 'target-origin-validation');
assert.match(rejectedReport.error, /origin only/);
assert.equal(rejectedReport.lastTrustworthyEvidence.presetFileSha256, capture.sourcePreset.fileSha256);

const invocationReportPath = join(fixture, 'invocation-report.json');
const missingArgument = spawnSync(process.execPath, [
  script,
  '--report', invocationReportPath,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(missingArgument.status, 0, 'missing required arguments were accepted');
assert.ok(existsSync(invocationReportPath), 'invocation failure did not write its durable report');
const invocationReport = JSON.parse(readFileSync(invocationReportPath, 'utf8'));
assert.equal(invocationReport.status, 'failed');
assert.equal(invocationReport.failurePhase, 'argument-validation');
assert.match(invocationReport.error, /missing --preset/);
assert.deepEqual(invocationReport.lastTrustworthyEvidence, {});

console.log('settings-preset replay capture contracts passed');
