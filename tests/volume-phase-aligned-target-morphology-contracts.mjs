#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const assembler = join(root, 'volume-phase-aligned-target-morphology-witness.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-target-morphology-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => {
  const path = join(fixture, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, payload) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([header, typeBytes, payload, checksum]);
};
const png = (name, { uniform = false } = {}) => {
  const path = join(fixture, `${name}.png`);
  const seed = createHash('sha256').update(name).digest();
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixel = uniform ? Buffer.from([0, 0, 0, 255]) : Buffer.from([seed[0], seed[1], seed[2], 255]);
  const alternate = uniform ? pixel : Buffer.from([seed[3] ^ 0xff, seed[4], seed[5], 255]);
  const scanlines = Buffer.concat([
    Buffer.from([0]), pixel, alternate,
    Buffer.from([0]), alternate, pixel,
  ]);
  const bytes = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, bytes);
  return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
};

const basinSha = 'b'.repeat(64);
const highFluidSha = '1'.repeat(64);
const lowFluidSha = '2'.repeat(64);
const pair = writeJson('pair.json', {
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'phase-aligned-exact-basin-field-pair-v0',
  status: 'captured',
  failurePhase: null,
  authority: 'downsampled-same-high-history-input-to-exact-high-target',
  lowGrid: 96,
  highGrid: 160,
  source: { exactBasinSourceCaptureSha256: basinSha },
  low: { fluid: { sha256: lowFluidSha }, front: { sha256: '3'.repeat(64) } },
  high: { fluid: { sha256: highFluidSha }, front: { sha256: '4'.repeat(64) } },
});
const pairSha = sha256(readFileSync(pair));

function held(name, role, grid, runtimeTruthAvailable, fluidSha) {
  return writeJson(`${name}.held.json`, {
    schema: 'kaminos.volume.phase-aligned-held-field.v0',
    identity: 'phase-aligned-held-field-render-role-v0',
    status: 'captured',
    failurePhase: null,
    role,
    runtimeTruthAvailable,
    renderOnly: true,
    source: {
      exactBasinSourceCaptureSha256: basinSha,
      pairManifestPath: pair,
      pairManifestSha256: pairSha,
    },
    receiver: { grid, fluid: { sha256: fluidSha }, front: { sha256: role === 'truthHigh' ? '4'.repeat(64) : '3'.repeat(64) } },
  });
}

function application(name, scale, channels = ['fuel', 'fireLick', 'visibleFireCarrier', 'frontTopology']) {
  return writeJson(`${name}.application.json`, {
    schema: 'kaminos.volume.exact-basin-selective-composition.v0',
    identity: 'dense-topology-plus-support-aware-sparse-carriers-v0',
    status: 'captured',
    failurePhase: null,
    compositionAuthority: 'learned-selective-head-composition-not-filtered-high-truth-v0',
    runtimeTruthAvailable: false,
    source: {
      pairManifestPath: pair,
      pairManifestSha256: pairSha,
      exactBasinSourceCaptureSha256: basinSha,
      supportProbeManifestSha256: '5'.repeat(64),
    },
    relationship: { authority: 'downsampled-same-high-history-input-to-exact-high-target', lowGrid: 96, highGrid: 160 },
    applicationHeads: {
      identity: 'explicit-deployed-head-selection-v0',
      channels,
      trainedChannels: ['fuel', 'fireLick', 'visibleFireCarrier', 'flame', 'frontTopology'],
      authority: 'caller-selected-application-heads-v0',
      diagnosticOnlyExcluded: ['flame'],
    },
    channelPolicies: Object.fromEntries(channels.map(channel => [channel, { identity: `${channel}-policy` }])),
    residualBlend: { identity: 'low-plus-scaled-learned-residual-v0', scale, appliesTo: channels },
    receiver: { grid: 160 },
  });
}

function render(name, sourceManifest, grid) {
  return writeJson(`${name}.render.json`, {
    schema: 'kaminos.volume.held-field-render.v0',
    identity: 'held-imported-field-neural-splat-render-v0',
    status: 'captured',
    failurePhase: null,
    sourceCapture: {
      payloadSha256: basinSha,
      actualPayloadSha256: basinSha,
      hashMatches: true,
    },
    viewportContract: {
      identity: 'cdp-emulation-fixed-device-metrics-v0',
      requested: { width: 1100, height: 1100, deviceScaleFactor: 2 },
      effective: { width: 1100, height: 1100, deviceScaleFactor: 2 },
    },
    renderCanvasContract: {
      identity: 'explicit-pre-render-canvas-css-geometry-v0',
      requested: { width: 1000, height: 1000 },
      effective: { cssWidth: 1000, cssHeight: 1000 },
    },
    initialFieldImport: {
      requested: { manifestPath: sourceManifest, manifestSha256: sha256(readFileSync(sourceManifest)), grid, advanceImportedSteps: 0 },
      effective: { grid, routeIdentity: 'native-3d-compute-fluid-raymarch-v0', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:apple' },
    },
    importedRender: {
      path: png(name).path,
      byteLength: null,
      sha256: null,
      imageAuthority: 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state',
      boundarySplatCompositionRequestedRaw: 'raymarch-only-v0',
      boundarySplatCompositionRequested: 'raymarch-only-v0',
      boundarySplatCompositionEffective: 'raymarch-only-v0',
      raymarchApplied: true,
      splatEncoded: false,
      splatApplied: false,
      backend: 'WebGPU:apple',
      fallbackReason: null,
      importedFieldManifestPath: sourceManifest,
      importedFieldManifestSha256: sha256(readFileSync(sourceManifest)),
    },
  });
}

function finishRender(path) {
  const value = JSON.parse(readFileSync(path));
  const bytes = readFileSync(value.importedRender.path);
  value.importedRender.byteLength = bytes.byteLength;
  value.importedRender.sha256 = sha256(bytes);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

const truthHeld = held('truth', 'truthHigh', 160, true, highFluidSha);
const lowHeld = held('low', 'lowPhaseAligned', 96, false, lowFluidSha);
const deterministic = application('deterministic', 0);
const learned = application('learned', 1);
const truthRender = finishRender(render('truth', truthHeld, 160));
const lowRender = finishRender(render('low', lowHeld, 96));
const deterministicRender = finishRender(render('deterministic', deterministic, 160));
const learnedRender = finishRender(render('learned', learned, 160));

const out = join(fixture, 'out');
const args = [
  assembler,
  '--pair-manifest', pair,
  '--truth-manifest', truthHeld,
  '--truth-render-manifest', truthRender,
  '--low-manifest', lowHeld,
  '--low-render-manifest', lowRender,
  '--deterministic-manifest', deterministic,
  '--deterministic-render-manifest', deterministicRender,
  '--learned-manifest', learned,
  '--learned-render-manifest', learnedRender,
  '--out-dir', out,
];
const pass = spawnSync(process.execPath, args, { encoding: 'utf8' });
assert.equal(pass.status, 0, pass.stderr || pass.stdout);
const report = JSON.parse(readFileSync(join(out, 'manifest.json')));
assert.equal(report.status, 'captured');
assert.deepEqual(Object.keys(report.roles), ['truthHigh160', 'filteredLow96Native', 'deterministic96to160', 'learned96to160']);
assert.equal(report.roles.truthHigh160.targetAuthority, true);
assert.equal(report.roles.deterministic96to160.residualScale, 0);
assert.equal(report.roles.learned96to160.residualScale, 1);
assert.equal(report.renderer.effectiveForAllRoles, 'raymarch-only-v0');
assert.deepEqual(report.checkpoint.applicationHeads, ['fuel', 'fireLick', 'visibleFireCarrier', 'frontTopology']);
assert.equal(report.pair.manifestSha256, pairSha);
assert.ok(existsSync(join(out, 'index.html')));

const lyingLearned = application('lying-learned', 0);
const lyingRender = finishRender(render('lying-learned', lyingLearned, 160));
const failedOut = join(fixture, 'failed');
const failed = spawnSync(process.execPath, [
  ...args.slice(0, -1), failedOut,
  '--learned-manifest', lyingLearned,
  '--learned-render-manifest', lyingRender,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'zero-residual learned role must fail closed');
const failure = JSON.parse(readFileSync(join(failedOut, 'manifest.json')));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'input-validation');
assert.match(failure.error, /learned.*scale/i);

function expectFailure(name, overrides, messagePattern) {
  const failedOutPath = join(fixture, `failed-${name}`);
  const invocation = [...args.slice(0, -1), failedOutPath];
  for (const [flag, value] of Object.entries(overrides)) invocation.push(flag, value);
  const result = spawnSync(process.execPath, invocation, { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} must fail closed`);
  const failedReport = JSON.parse(readFileSync(join(failedOutPath, 'manifest.json')));
  assert.equal(failedReport.status, 'failed');
  assert.match(failedReport.error, messagePattern);
}

const hybridRenderValue = JSON.parse(readFileSync(learnedRender));
hybridRenderValue.importedRender.boundarySplatCompositionRequestedRaw = 'raymarch-under-splats-v0';
hybridRenderValue.importedRender.boundarySplatCompositionRequested = 'raymarch-under-splats-v0';
hybridRenderValue.importedRender.boundarySplatCompositionEffective = 'raymarch-under-splats-v0';
const hybridRender = writeJson('learned-hybrid.render.json', hybridRenderValue);
expectFailure('hybrid-route', { '--learned-render-manifest': hybridRender }, /learned96to160.*raymarch-only/i);

const mismatchedHeads = application('mismatched-heads', 1, ['fuel', 'frontTopology']);
const mismatchedHeadsRender = finishRender(render('mismatched-heads', mismatchedHeads, 160));
expectFailure('head-mismatch', {
  '--learned-manifest': mismatchedHeads,
  '--learned-render-manifest': mismatchedHeadsRender,
}, /application heads.*match/i);

const cameraRenderValue = JSON.parse(readFileSync(learnedRender));
cameraRenderValue.sourceCapture.actualPayloadSha256 = 'c'.repeat(64);
cameraRenderValue.viewportContract.effective.width = 1099;
const cameraRender = writeJson('learned-camera-mismatch.render.json', cameraRenderValue);
expectFailure('camera-mismatch', { '--learned-render-manifest': cameraRender }, /source capture|viewport/i);

const blankRenderValue = JSON.parse(readFileSync(learnedRender));
const blankImage = png('learned-blank', { uniform: true });
blankRenderValue.importedRender.path = blankImage.path;
blankRenderValue.importedRender.byteLength = blankImage.byteLength;
blankRenderValue.importedRender.sha256 = blankImage.sha256;
const blankRender = writeJson('learned-blank.render.json', blankRenderValue);
expectFailure('blank-image', { '--learned-render-manifest': blankRender }, /blank|pixel activity/i);

console.log('phase-aligned target morphology contracts passed');
