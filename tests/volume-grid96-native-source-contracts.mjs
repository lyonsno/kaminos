import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildGrid96NativeSource } from '../volume-grid96-native-source-preflight.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const exporter = readFileSync(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');
const sourcePreflight = new URL('../volume-grid96-native-source-preflight.mjs', import.meta.url);

const materializeStart = core.indexOf('async function materializeFullFieldDerivedBuffersForDebugExport');
const materializeEnd = core.indexOf('async function copyFullFieldBuffersForDebugExport', materializeStart);
const materializeSource = core.slice(materializeStart, materializeEnd);
const copyStart = materializeEnd;
const copyEnd = core.indexOf('function fullFieldExportDescriptorFor', copyStart);
const copySource = core.slice(copyStart, copyEnd);
const publicStart = core.indexOf('function fullFieldExportPublicSession');
const publicEnd = core.indexOf('function encodeFloat32ChunkBase64', publicStart);
const publicSource = core.slice(publicStart, publicEnd);

assert.ok(materializeStart >= 0 && materializeEnd > materializeStart, 'full-field derived materialization is inspectable');
assert.match(
  materializeSource,
  /encodeMajorant\(encoder,\s*\{\s*force:\s*true\s*\}\)/,
  'the frozen source session must materialize the conservative majorant at the exact captured state',
);
assert.match(copySource, /majorantReadback/, 'the full-field export must allocate a majorant readback');
assert.match(
  copySource,
  /copyBufferToBuffer\(majorantBuffer,\s*0,\s*majorantReadback,\s*0,\s*majorantBytes\)/,
  'the full-field export must copy the effective majorant buffer in the same readback session',
);
assert.match(publicSource, /majorantGrid:\s*session\.majorantGrid/, 'the public source receipt must name the effective majorant grid');
assert.match(publicSource, /majorant:\s*session\.majorantDescriptor/, 'the public source receipt must expose the majorant descriptor');
assert.match(exporter, /phase = 'drain-majorant'/, 'the exporter must report a distinct majorant drain failure phase');
assert.match(exporter, /drainSidecar\([\s\S]{0,180}'majorant'/, 'the exporter must drain the browser majorant artifact directly');
assert.match(exporter, /sidecars:\s*\{\s*fluid,\s*front,\s*majorant\s*\}/, 'the manifest must bind majorant to the native source sidecar set');
assert.ok(existsSync(sourcePreflight), 'the native Grid96 source preflight must exist before GPU capture can be accepted');

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-grid96-native-source-contract-'));
const root = resolve(import.meta.dirname, '..');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifact(name, shape, channelOrder) {
  const path = join(scratch, name);
  const floatCount = shape.reduce((product, value) => product * value, 1);
  writeFileSync(path, Buffer.alloc(0));
  truncateSync(path, floatCount * 4);
  const bytes = readFileSync(path);
  return {
    kind: name.replace('.f32', ''),
    dtype: 'float32',
    byteOrder: 'little-endian',
    floatCount,
    byteLength: bytes.length,
    shape,
    channelOrder,
    path,
    sha256: sha256(bytes),
  };
}

const url = 'http://127.0.0.1:19096/?kaminos_volume_smoke=1&volume_resolution=96';
const exportManifest = {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  identity: 'full-grid-fluid-front-boundary-sidecars-v0',
  status: 'captured',
  failurePhase: null,
  completeFieldCoverage: true,
  exportScope: 'full-field-with-boundary-v0',
  derivedBoundaryCoverage: 'included-v0',
  url,
  sourceCapture: {
    schema: 'kaminos.operator-exact-live-splat-basin-capture.v1',
    identity: 'operator-live-splat-basin-capture-v1',
    payloadSha256: 'a'.repeat(64),
    hashMatches: true,
    effectiveReplayRoute: url,
    routeRebind: { queryPreserved: true },
  },
  initialFieldImport: null,
  importedAdvance: null,
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'kaminos-volume-prototype-v0',
  backend: 'WebGPU:apple',
  grid: 96,
  majorantGrid: 24,
  cellCount: 96 ** 3,
  sessionId: 'full-field-grid96-test',
  deterministicReplay: {
    identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
    authority: 'same-route-controls-fixed-step-replay',
    resetReason: 'deterministic-replay-reset',
    requestedSteps: 120,
    completedSteps: 120,
    simStepCount: 120,
    timeStepMs: 1000 / 60,
    startTimeMs: 1000,
    finalTimeMs: 2983.333333333333,
    controlsSignature: 'grid96-exact-full-flame-controls-v0',
    grid: 96,
    majorantGrid: 24,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
  },
  sidecars: {
    fluid: artifact('fluid.f32', [96, 96, 96, 16], [
      'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
      'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
    ]),
    front: artifact('front.f32', [96, 96, 96, 1], ['frontTopology']),
    majorant: artifact('majorant.f32', [24, 24, 24, 4], ['density', 'fire', 'extinction', 'importance']),
  },
  boundarySidecar: {
    sidecars: {
      boundary: artifact('boundary.f32', [96, 96, 96, 4], ['support', 'coverage', 'ridge', 'footprint']),
    },
  },
};
const sourceExportManifestPath = join(scratch, 'source-export.json');
writeFileSync(sourceExportManifestPath, `${JSON.stringify(exportManifest, null, 2)}\n`);
const sourceExportManifestSha256 = sha256(readFileSync(sourceExportManifestPath));
const buildOptions = {
  sourceExportManifestPath,
  sourceExportManifestSha256,
  sameStateCaptureId: 'grid96-full-flame-state120',
};

const source = buildGrid96NativeSource(exportManifest, buildOptions);
assert.equal(source.grid, 96);
assert.equal(source.majorantGrid, 24);
assert.equal(source.fullGridCellCount, 96 ** 3);
assert.equal(source.sameStateCaptureId, 'grid96-full-flame-state120');
assert.equal(source.simStepCount, 120);
assert.equal(source.requestedControlIdentity, source.effectiveControlIdentity);
assert.equal(source.route.fallbackReason, null);
assert.equal(source.sidecars.majorant.shape[0], 24);
assert.equal(source.claimBoundary.cheaperDemoClaim, false);
assert.equal(source.claimBoundary.learnerCampaign, false);

assert.throws(
  () => buildGrid96NativeSource({ ...exportManifest, grid: 160 }, buildOptions),
  /native Grid96/,
  'Grid160 evidence cannot be relabeled or resized into this companion',
);
assert.throws(
  () => buildGrid96NativeSource({ ...exportManifest, initialFieldImport: { initializationAuthority: 'receiver-initialized-from-filtered-high-t-v0' } }, buildOptions),
  /initialized from another grid/,
  'imported or downsampled source state cannot impersonate native Grid96',
);
assert.throws(
  () => buildGrid96NativeSource({ ...exportManifest, effectiveRoute: 'fallback-2d-v0' }, buildOptions),
  /fell back/,
  'a fallback route cannot produce causal evidence',
);
assert.throws(
  () => buildGrid96NativeSource({ ...exportManifest, sidecars: { ...exportManifest.sidecars, majorant: null } }, buildOptions),
  /majorant artifact is missing/,
  'a source without the shared conservative majorant cannot close',
);

const badManifestPath = join(scratch, 'bad-source-export.json');
writeFileSync(badManifestPath, `${JSON.stringify({ ...exportManifest, grid: 160 }, null, 2)}\n`);
const outPath = join(scratch, 'source.json');
const reportPath = join(scratch, 'report.json');
writeFileSync(outPath, '{"status":"complete","stale":true}\n');
const failed = spawnSync(process.execPath, [
  new URL('../volume-grid96-native-source-preflight.mjs', import.meta.url).pathname,
  '--source-export-manifest', badManifestPath,
  '--same-state-capture-id', 'grid96-full-flame-state120',
  '--out', outPath,
  '--report', reportPath,
], { cwd: root, encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'wrong-grid preflight must fail');
assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).failurePhase, 'native-source-validation');
assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).status, 'failed', 'failed preflight must overwrite stale success output');

rmSync(scratch, { recursive: true, force: true });

console.log('grid96 native source contracts passed');
