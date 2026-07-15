#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const witnessPath = join(root, 'volume-native-low-transfer-long-sequence-witness.mjs');
const routePath = join(root, 'volume-native-low-selective-live.html');

assert.ok(existsSync(witnessPath), 'native-low two-model long sequence witness exists');
assert.ok(existsSync(routePath), 'native-low dual-model live route exists');

const witness = readFileSync(witnessPath, 'utf8');
const route = readFileSync(routePath, 'utf8');
assert.match(witness, /kaminos\.volume\.native-low-transfer-long-sequence-witness\.v0/);
assert.match(witness, /native\$\{expectedGrid\}Control[\s\S]*baseline128Trained[\s\S]*candidate96Trained/);
assert.match(witness, /frame-locked-consecutive-native-\$\{expectedGrid\}-simulation-steps-v0/);
assert.match(witness, /--expected-grid/, 'witness supports explicit native64 without changing the accepted native96 default');
assert.match(witness, /setCapturePaused\(true\)/);
assert.match(witness, /stepCaptureFrame\(\)/);
assert.match(witness, /\['running', 'paused'\][\s\S]*capturePaused/, 'an explicitly paused manual route counts as settled without auto-advancing');
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
assert.doesNotMatch(witness, /assert\.equal\(receipt\.requestedRoute, receipt\.effectiveRoute/, 'requested and effective route identities may be intentionally distinct');
assert.match(witness, /capturedFrameCount[\s\S]*requestedFrameCount/);
assert.match(witness, /playbackSeconds/);
assert.match(witness, /failurePhase/);
assert.match(witness, /lastTrustworthyEvidence/);
assert.match(witness, /Page\.captureScreenshot/);
assert.match(witness, /captureCallTimeoutMs/, 'capture-call timeout is explicit and reportable');
assert.match(witness, /captureScreenshotWithRetry/, 'a dropped CDP screenshot response is retried without advancing the simulation');
assert.match(witness, /captureSocket/, 'presentation capture uses a socket isolated from runtime control');
assert.match(witness, /reconnectCaptureSocket/, 'a timed-out presentation socket is replaced before retry');
assert.match(witness, /activeFramePhase/, 'failure receipts identify the exact blocked frame subphase');
assert.match(witness, /cdp-call-timeout/, 'a dropped CDP response fails loud instead of hanging forever');
assert.match(witness, /ffmpeg/);
assert.match(witness, /-movflags'[\s\S]*'\+faststart'/, 'MP4 encoder uses the valid faststart movflag');
assert.match(witness, /operatorPage/);
assert.match(witness, /Native \$\{expectedGrid\} control/);
assert.match(witness, /128-trained zero-shot/);
assert.match(witness, /96-trained zero-shot/);
assert.match(witness, /<video[\s\S]*autoplay[\s\S]*loop[\s\S]*controls/);
assert.doesNotMatch(witness, /Math\.min\([^\n]*requestedFrameCount/, 'caller frame count must not be silently capped');

assert.match(route, /nativeGrid:\s*manualSourceGrid/, 'manual route reports the effective native grid');
assert.match(route, /capturePaused/, 'manual route reports capture pause state');
assert.match(route, /simulationStep:\s*baseline128\.sourceStep/, 'manual receipt exposes the exact numeric simulation step');
assert.match(route, /roles:\s*\{[\s\S]*\[nativeControlRoleIdentity\][\s\S]*baseline128Trained[\s\S]*candidate96Trained/, 'manual receipt exposes normalized three-role identities');
assert.match(route, /models:\s*normalizedModelPackages\(\)/, 'manual receipt exposes normalized model package identities');
assert.match(route, /function normalizedModelPackages\(\)[\s\S]*baseline128Trained[\s\S]*candidate96Trained/, 'normalized packages bind both named model roles');
assert.match(route, /fallbackReason:\s*null[\s\S]*staleFrameReason:\s*null/, 'manual receipt exposes normalized no-fallback and no-stale fields');
assert.match(route, /requestedRoute:\s*NATIVE_LOW_SELECTIVE_LIVE_ROUTE[\s\S]*effectiveRoute:\s*NATIVE_LOW_SHARED_DEVICE_ROUTE/, 'manual route preserves requested and effective route identities');

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-native-low-long-sequence-contract-'));
const failureReportPath = join(failureRoot, 'missing-url-report.json');
const missingUrl = spawnSync(process.execPath, [witnessPath, '--report', failureReportPath], { encoding: 'utf8' });
assert.notEqual(missingUrl.status, 0, 'missing URL must fail');
assert.ok(existsSync(failureReportPath), 'argument failure must still write a durable report');
const failure = JSON.parse(readFileSync(failureReportPath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'argument-validation');

console.log('native-low transfer long sequence witness contracts passed');
