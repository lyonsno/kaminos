#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const producer = join(root, 'volume-native-low-selective-motion-produce.mjs');
assert.ok(existsSync(producer), 'native-low selective temporal producer exists');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-native-low-motion-contract-'));
const sourceCapturePath = join(fixtureRoot, 'native-128-capture.json');
const sourceCapture = {
  schema: 'kaminos.operator-exact-live-splat-basin-capture.v1',
  identity: 'contract-native-low-capture',
  payloadSha256: 'a'.repeat(64),
  controls: { volume_resolution: 128 },
  replayRoute: 'http://127.0.0.1:18100/?kaminos_volume_smoke=1&volume_resolution=128',
};
writeFileSync(sourceCapturePath, `${JSON.stringify(sourceCapture, null, 2)}\n`);

function run(extra = [], name = 'out') {
  const outDir = join(fixtureRoot, name);
  const result = spawnSync(process.execPath, [
    producer,
    '--source-capture', sourceCapturePath,
    '--target-origin', 'http://127.0.0.1:18100',
    '--out-dir', outDir,
    '--start-step', '96',
    '--frame-count', '3',
    '--plan-only',
    ...extra,
  ], { encoding: 'utf8' });
  return { result, outDir };
}

const planned = run();
assert.equal(planned.result.status, 0, planned.result.stderr || planned.result.stdout);
const manifest = JSON.parse(readFileSync(join(planned.outDir, 'producer-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.native-low-selective-motion-producer.v0');
assert.equal(manifest.status, 'planned');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.inputAuthority, 'native-low-simulator-state-no-synthetic-downsample-v0');
assert.equal(manifest.temporalAuthority, 'consecutive-native-low-simulator-states-frozen-model-application-v0');
assert.equal(manifest.runtimeTruthAvailable, false);
assert.equal(manifest.renderCompositionRequested, 'splat-only-v0');
assert.deepEqual(manifest.roles, ['nativeLowControl', 'nativeLowSelectivePredicted']);
assert.deepEqual(manifest.simulationSteps, [96, 97, 98]);
assert.equal(manifest.nativeGrid, 128);
assert.equal(manifest.predictedGrid, 160);
assert.match(manifest.model.identity, /exact-basin-selective-carrier-heads-160-to-128-v0/);
assert.match(manifest.model.modelSha256, /^[a-f0-9]{64}$/);
assert.equal(manifest.retention.ephemeralFieldArtifactsDeletedAfterFrameReceipt, true);
assert.equal(manifest.retention.retainedArtifacts, 'paired-images-frame-receipts-and-sequence-witness');
assert.equal(manifest.frames.length, 3);
assert.match(manifest.frames[0].commands.nativeExport, /--deterministic-replay-steps 96/);
assert.match(manifest.frames[1].commands.nativeExport, /--deterministic-replay-steps 97/);
assert.match(manifest.frames[0].commands.nativeExport, /--reuse-browser/);
assert.match(manifest.frames[0].commands.nativeExport, /--keep-browser-open/);
assert.match(manifest.frames[0].commands.nativeExport, /--debug-port \d+/);
assert.match(manifest.frames[0].commands.render, /--reuse-browser/);
assert.match(manifest.frames[0].commands.render, /--keep-browser-open/);
assert.match(manifest.frames[0].commands.compose, /volume-native-low-selective-compose\.py/);
assert.match(manifest.frames[0].commands.render, /volume-native-low-selective-witness\.mjs/);
assert.doesNotMatch(JSON.stringify(manifest.frames), /truthHigh|synthetic-downsample|phase-aligned-pair/);

const source = readFileSync(producer, 'utf8');
const nativeWitnessSource = readFileSync(join(root, 'volume-native-low-selective-witness.mjs'), 'utf8');
const exporterSource = readFileSync(join(root, 'volume-full-grid-field-export.mjs'), 'utf8');
assert.match(source, /sameNativeStateIdentity/, 'frame receipt binds control and treatment to one native state');
assert.match(source, /raymarchExcludedFromDiscriminant/, 'frame validation requires raymarch exclusion');
assert.match(source, /frameManifestSha256[\s\S]*rmSync/, 'scratch deletion follows a durable per-frame receipt');
assert.match(source, /failurePhase/, 'producer preserves a durable failure phase');
assert.match(source, /modelSha256/, 'producer preserves frozen model checksum identity');
assert.match(source, /process\.kill\(sharedBrowserPid/, 'producer owns and terminates only its recorded shared browser');
assert.match(nativeWitnessSource, /--reuse-browser/, 'native still witness forwards shared-browser reuse to both held renders');
assert.match(nativeWitnessSource, /--keep-browser-open/, 'native still witness does not tear down the producer-owned browser');
assert.match(exporterSource, /async function waitForPageTarget/, 'shared-browser launch waits for a page target, not only the CDP version endpoint');
assert.match(exporterSource, /closeBrowserSession\(browserSession, \{ failed: !completed \}\)/, 'a failed shared-browser launch cannot strand its producer-owned Chrome process');

const badCapturePath = join(fixtureRoot, 'bad-160-capture.json');
writeFileSync(badCapturePath, `${JSON.stringify({
  ...sourceCapture,
  controls: { volume_resolution: 160 },
  replayRoute: sourceCapture.replayRoute.replace('volume_resolution=128', 'volume_resolution=160'),
}, null, 2)}\n`);
const bad = run(['--source-capture', badCapturePath], 'bad-grid');
assert.notEqual(bad.result.status, 0, 'a non-native-128 source capture must fail');
const badManifest = JSON.parse(readFileSync(join(bad.outDir, 'producer-manifest.json'), 'utf8'));
assert.equal(badManifest.status, 'failed');
assert.equal(badManifest.failurePhase, 'source-capture-validation');

console.log('native-low selective motion producer contracts passed');
