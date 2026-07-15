#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const routePath = join(root, 'volume-native-low-selective-live.html');
const witnessPath = join(root, 'volume-native-low-selective-live-witness.mjs');
const modelManifestPath = join(root, 'models/selective-head-live/exact-basin-160-to-128-v0/manifest.json');
const modelGeneratedPath = join(root, 'models/selective-head-live/exact-basin-160-to-128-v0/model.generated.js');

assert.ok(existsSync(modelManifestPath), 'frozen selective model manifest exists');
assert.ok(existsSync(modelGeneratedPath), 'frozen selective model browser manifest exists');
const modelManifest = JSON.parse(readFileSync(modelManifestPath, 'utf8'));
assert.equal(modelManifest.identity, 'exact-basin-selective-carrier-heads-160-to-128-v0');
assert.equal(modelManifest.packed?.sha256, 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9');
assert.equal(modelManifest.features?.featureCount, 185);
assert.equal(modelManifest.source?.lowGrid, 128);
assert.equal(modelManifest.source?.highGrid, 160);

assert.ok(existsSync(routePath), 'native-low selective live browser route exists');
assert.ok(existsSync(witnessPath), 'native-low selective live witness exists');

const route = readFileSync(routePath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
const combined = `${route}\n${witness}`;

assert.match(route, /native-low-live-browser-webgpu-inference-v0/, 'route names browser/WebGPU frozen-model inference authority');
assert.match(route, /kaminos\.volume\.native-low-selective-live-comparison\.v0/, 'route publishes a stable live comparison report schema');
assert.match(route, /exact-basin-selective-carrier-heads-160-to-128-v0/, 'route binds the frozen model identity');
assert.match(route, /dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9/, 'route binds the frozen model checksum');
assert.match(route, /SELECTIVE_HEAD_LIVE_MODEL_URL/, 'route loads the packaged model bytes in browser');
assert.match(route, /modelChecksumMismatch/, 'route rejects missing or wrong model checksum');
assert.match(route, /native-low-simulator-state-no-synthetic-downsample-v0/, 'route names genuine native-low source authority');
assert.match(route, /runtimeTruthAvailable:\s*false/, 'route makes truth unavailable at runtime');
assert.match(route, /syntheticDownsampleApplied:\s*false/, 'route forbids synthetic downsample application');
assert.doesNotMatch(route, /truthHigh|phase-aligned-pair|filtered-high/, 'route cannot import truth or synthetic phase-aligned authority');
assert.match(route, /nativeLowControl/, 'route exposes untouched native 128 control');
assert.match(route, /nativeLowSelectivePredicted/, 'route exposes same-state frozen-model treatment');
assert.match(route, /sameNativeStateIdentity/, 'route binds control and treatment to the same native state');
assert.match(route, /sourceStepDrift/, 'route detects source-step drift');
assert.match(route, /controlTreatmentCausalDivergence/, 'route detects control/treatment causal divergence');
assert.match(route, /requestedComposition/, 'route records requested renderer composition');
assert.match(route, /effectiveComposition/, 'route records effective renderer composition');
assert.match(route, /splat-only-v0/, 'first live discriminant uses splat-only-v0 attribution');
assert.match(route, /compositionMismatch/, 'route rejects requested/effective composition mismatch');
assert.match(route, /effectiveBackend/, 'route records the effective backend');
assert.match(route, /fallbackBackend/, 'route rejects fallback backend evidence');
assert.match(route, /effectiveFeatureCount/, 'route records the full effective feature count');
assert.match(route, /noHiddenCaps/, 'route rejects hidden caps instead of silently dropping input channels or support');
assert.match(route, /inferenceGpuMs/, 'route measures inference-only GPU time');
assert.match(route, /uploadDispatchMs/, 'route measures upload/dispatch overhead');
assert.match(route, /endToEndFrameMs/, 'route measures end-to-end frame impact');
assert.match(route, /durationSeconds/, 'route reports continuous comparison duration');
assert.match(route, /blankFrameRejection/, 'route refuses blank frames as evidence');
assert.match(route, /frameCacheKey/, 'route distinguishes live frames from cached screenshots');
assert.match(route, /failurePhase/, 'route writes a failure phase');
assert.match(route, /lastTrustworthyEvidence/, 'route preserves a durable report even when primary output fails');

assert.match(witness, /native-low-live-witness-v0/, 'witness names live route evidence authority');
assert.match(witness, /requestedComposition[\s\S]*effectiveComposition/, 'witness validates requested/effective composition identity');
assert.match(witness, /requestedBackend[\s\S]*effectiveBackend/, 'witness validates requested/effective backend identity');
assert.match(witness, /blankFrameRejection/, 'witness rejects blank frame evidence');
assert.match(witness, /cachedFrameRejection/, 'witness rejects cached-frame false closure');
assert.match(witness, /failurePhase/, 'witness writes a failure-phase report on error');

console.log('native-low selective live route contracts passed');
