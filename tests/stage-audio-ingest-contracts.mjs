import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = mkdtempSync(join(tmpdir(), 'kaminos-stage-audio-'));
const audioPath = join(fixtureDir, 'two-pulse.wav');
const reportPath = join(fixtureDir, 'decoded-report.json');

execFileSync('ffmpeg', [
  '-v', 'error',
  '-f', 'lavfi',
  '-i', 'anullsrc=r=16000:cl=mono:d=1.5',
  '-f', 'lavfi',
  '-i', 'sine=frequency=440:sample_rate=16000:duration=0.5',
  '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
  '-map', '[out]',
  '-ac', '1',
  '-c:a', 'pcm_s16le',
  audioPath,
]);

const decodedRun = spawnSync(process.execPath, [
  'stage-atoms-witness.mjs',
  '--fixture', 'ccmixter-geppetto',
  '--audio-file', audioPath,
  '--feature-rate', '20',
  '--output', reportPath,
], { cwd: root, encoding: 'utf8' });

assert.equal(decodedRun.status, 0, decodedRun.stderr || decodedRun.stdout);
const decodedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(decodedReport.status, 'passed');
assert.ok(
  decodedReport.lastTrustworthyEvidence.audioInput,
  'witness must record the effective decoded audio input instead of reusing fixture features',
);
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.effectivePath, audioPath);
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.authority, 'decoded-local-audio-file');
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.decode.codec, 'pcm_s16le');
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.decode.sampleRate, 16000);
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.decode.channels, 1);
assert.ok(decodedReport.lastTrustworthyEvidence.audioInput.decode.durationSeconds >= 1.99);
assert.equal(decodedReport.lastTrustworthyEvidence.audioInput.featureClock.rateHz, 20);
assert.ok(decodedReport.lastTrustworthyEvidence.audioInput.featureClock.frameCount >= 39);
assert.ok(decodedReport.lastTrustworthyEvidence.audioInput.featureSummary.maxOnsetStrength > 0);
assert.ok(
  decodedReport.lastTrustworthyEvidence.featureSelection,
  'decoded witness must name how its representative audio frame was selected',
);
assert.equal(decodedReport.lastTrustworthyEvidence.featureSelection.authority, 'strongest-onset-frame');
assert.ok(decodedReport.lastTrustworthyEvidence.featureSelection.effectiveTimeSeconds >= 1.45);
assert.equal(decodedReport.witness.materialFrame.featureAuthority, 'decoded-audio-clock-frame-v0');
assert.ok(decodedReport.witness.materialFrame.audioFeatures.energy > 0);

const impostorPath = join(fixtureDir, 'not-audio.mp3');
const failurePath = join(fixtureDir, 'decode-failure.json');
writeFileSync(impostorPath, '<!doctype html><title>forbidden</title>');
const failureRun = spawnSync(process.execPath, [
  'stage-atoms-witness.mjs',
  '--fixture', 'ccmixter-geppetto',
  '--audio-file', impostorPath,
  '--output', failurePath,
], { cwd: root, encoding: 'utf8' });

assert.notEqual(failureRun.status, 0, 'HTML masquerading as audio must fail');
const failureReport = JSON.parse(readFileSync(failurePath, 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'audio_decode');
assert.equal(failureReport.lastTrustworthyEvidence.audioInput.effectivePath, impostorPath);
assert.equal(failureReport.lastTrustworthyEvidence.audioInput.decode, null);

console.log('stage audio ingest contracts passed');
