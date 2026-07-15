#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const witnessPath = join(root, 'volume-native-low-transfer-long-sequence-witness.mjs');

assert.ok(existsSync(witnessPath), 'native-low two-model long sequence witness exists');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos\.volume\.native-low-transfer-long-sequence-witness\.v0/);
assert.match(witness, /native96Control[\s\S]*baseline128Trained[\s\S]*candidate96Trained/);
assert.match(witness, /frame-locked-consecutive-native-96-simulation-steps-v0/);
assert.match(witness, /setCapturePaused\(true\)/);
assert.match(witness, /stepCaptureFrame\(\)/);
assert.match(witness, /assertConsecutiveSteps/);
assert.match(witness, /sameNativeStateIdentity/);
assert.match(witness, /sourceStepIdentity/);
assert.match(witness, /dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9/);
assert.match(witness, /baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8/);
assert.match(witness, /requestedRoute[\s\S]*effectiveRoute/);
assert.match(witness, /requestedBackend[\s\S]*effectiveBackend/);
assert.match(witness, /requestedComposition[\s\S]*effectiveComposition/);
assert.match(witness, /candidateCount[\s\S]*instanceCount[\s\S]*overflowCount/);
assert.match(witness, /fallbackReason/);
assert.match(witness, /staleFrameReason/);
assert.match(witness, /capturedFrameCount[\s\S]*requestedFrameCount/);
assert.match(witness, /playbackSeconds/);
assert.match(witness, /failurePhase/);
assert.match(witness, /lastTrustworthyEvidence/);
assert.match(witness, /Page\.captureScreenshot/);
assert.match(witness, /ffmpeg/);
assert.doesNotMatch(witness, /Math\.min\([^\n]*requestedFrameCount/, 'caller frame count must not be silently capped');

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-native-low-long-sequence-contract-'));
const failureReportPath = join(failureRoot, 'missing-url-report.json');
const missingUrl = spawnSync(process.execPath, [witnessPath, '--report', failureReportPath], { encoding: 'utf8' });
assert.notEqual(missingUrl.status, 0, 'missing URL must fail');
assert.ok(existsSync(failureReportPath), 'argument failure must still write a durable report');
const failure = JSON.parse(readFileSync(failureReportPath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'argument-validation');

console.log('native-low transfer long sequence witness contracts passed');
