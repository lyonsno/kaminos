#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID96_NATIVE_SOURCE_SCHEMA = 'kaminos.volume.grid96-source.v0';
export const GRID96_NATIVE_SOURCE_AUTHORITY = 'native-grid96-full-field-export-v0';
export const GRID96_SOURCE_PREFLIGHT_IDENTITY = 'native-grid96-same-state-source-preflight-v0';

const GRID = 96;
const MAJORANT_GRID = 24;
const CELL_COUNT = GRID ** 3;
const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const EXPORT_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
const EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const EXPORT_SCOPE = 'full-field-with-boundary-v0';
const REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const REPLAY_AUTHORITY = 'same-route-controls-fixed-step-replay';
const BASIN_SCHEMA = 'kaminos.operator-exact-live-splat-basin-capture.v1';
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_LINEAGE = /(?:resize|resampl|upsampl|downsampl|receiver-initial|selective-composition|phase-aligned-held)/i;
const FLUID_CHANNELS = Object.freeze([
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
]);

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertNonblank(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must be nonblank`);
}

function assertHash(value, label) {
  assert.match(value || '', HEX_SHA256, `${label} must be a SHA-256`);
}

function validateArtifact(artifact, { label, shape, channelOrder, semanticRole }) {
  assert.ok(artifact && typeof artifact === 'object', `${label} artifact is missing`);
  assert.equal(artifact.dtype, 'float32', `${label} dtype must be float32`);
  assert.equal(artifact.byteOrder, 'little-endian', `${label} byte order must be little-endian`);
  assert.deepEqual(artifact.shape, shape, `${label} shape drifted`);
  assert.deepEqual(artifact.channelOrder, channelOrder, `${label} channel order drifted`);
  const expectedFloats = shape.reduce((product, value) => product * value, 1);
  assert.equal(artifact.floatCount, expectedFloats, `${label} float count drifted`);
  assert.equal(artifact.byteLength, expectedFloats * Float32Array.BYTES_PER_ELEMENT, `${label} byte length drifted`);
  const path = resolve(String(artifact.path || ''));
  assert.ok(statSync(path).isFile(), `${label} path is not a file`);
  assert.equal(statSync(path).size, artifact.byteLength, `${label} file byte length drifted`);
  assertHash(artifact.sha256, `${label} manifest hash`);
  const actualSha256 = sha256File(path);
  assert.equal(actualSha256, artifact.sha256, `${label} file hash drifted`);
  return {
    path,
    bytes: artifact.byteLength,
    sha256: actualSha256,
    dtype: 'float32-le',
    shape,
    semanticRole,
    channelOrder,
  };
}

export function buildGrid96NativeSource(exportManifest, {
  sourceExportManifestPath,
  sourceExportManifestSha256,
  sameStateCaptureId,
} = {}) {
  assert.ok(exportManifest && typeof exportManifest === 'object', 'source export manifest is missing');
  assert.equal(exportManifest.schema, EXPORT_SCHEMA, 'source export schema drifted');
  assert.equal(exportManifest.identity, EXPORT_IDENTITY, 'source export identity drifted');
  assert.equal(exportManifest.status, 'captured', 'source export is not captured');
  assert.equal(exportManifest.failurePhase ?? null, null, 'source export carries a failure phase');
  assert.equal(exportManifest.completeFieldCoverage, true, 'source export is partial');
  assert.equal(exportManifest.exportScope, EXPORT_SCOPE, 'source export omitted Full Flame boundary support');
  assert.equal(exportManifest.derivedBoundaryCoverage, 'included-v0', 'source export boundary coverage drifted');
  assert.equal(exportManifest.grid, GRID, 'source export must be native Grid96');
  assert.equal(exportManifest.cellCount, CELL_COUNT, 'source export cell count is incomplete');
  assert.equal(exportManifest.majorantGrid, MAJORANT_GRID, 'source export majorant grid must remain 24');
  assert.equal(exportManifest.routeIdentity, ROUTE_IDENTITY, 'source route identity drifted');
  assert.equal(exportManifest.effectiveRoute, ROUTE_IDENTITY, 'source fell back from the native route');
  assert.match(exportManifest.backend || '', /^WebGPU:/, 'source backend is not WebGPU');
  assertNonblank(exportManifest.prototypeIdentity, 'source prototype identity');
  assert.equal(exportManifest.initialFieldImport ?? null, null, 'source was initialized from another grid');
  assert.equal(exportManifest.importedAdvance ?? null, null, 'source carries imported-state advancement');
  assert.equal(exportManifest.renderOnly ?? false, false, 'source is a render-only artifact');
  if (FORBIDDEN_LINEAGE.test(stableJson({
    initialFieldImport: exportManifest.initialFieldImport,
    importedAdvance: exportManifest.importedAdvance,
    initializationAuthority: exportManifest.initializationAuthority,
    filterIdentity: exportManifest.filterIdentity,
  }))) throw new Error('source export contains resized, resampled, or imported lineage');

  const basin = exportManifest.sourceCapture;
  assert.equal(basin?.schema, BASIN_SCHEMA, 'source export is not bound to an exact operator basin capture');
  assertHash(basin.payloadSha256, 'source basin payload');
  assert.equal(basin.hashMatches, true, 'source basin payload hash was not verified');
  assert.equal(basin.effectiveReplayRoute, exportManifest.url, 'source basin replay route differs from the captured URL');
  if (basin.routeRebind) assert.equal(basin.routeRebind.queryPreserved, true, 'source basin route rebind did not preserve controls');

  const replay = exportManifest.deterministicReplay;
  assert.equal(replay?.identity, REPLAY_IDENTITY, 'source replay identity drifted');
  assert.equal(replay.authority, REPLAY_AUTHORITY, 'source replay authority drifted');
  assert.equal(replay.resetReason, 'deterministic-replay-reset', 'source replay was not reset natively');
  assert.ok(Number.isInteger(replay.requestedSteps) && replay.requestedSteps > 0, 'source replay step request is invalid');
  assert.equal(replay.completedSteps, replay.requestedSteps, 'source replay did not complete exactly');
  assert.equal(replay.simStepCount, replay.requestedSteps, 'source simulator step does not equal replay request');
  assert.equal(replay.grid, GRID, 'source replay grid drifted');
  assert.equal(replay.majorantGrid, MAJORANT_GRID, 'source replay majorant grid drifted');
  assert.equal(replay.effectiveRoute, ROUTE_IDENTITY, 'source replay route fell back');
  assert.equal(replay.prototypeIdentity, exportManifest.prototypeIdentity, 'source replay prototype drifted');
  assert.equal(replay.backend, exportManifest.backend, 'source replay backend drifted');
  assertNonblank(replay.controlsSignature, 'source replay controls signature');
  assertNonblank(sameStateCaptureId, 'same-state capture identity');
  assertHash(sourceExportManifestSha256, 'source export manifest');
  assertNonblank(sourceExportManifestPath, 'source export manifest path');

  const fluid = validateArtifact(exportManifest.sidecars?.fluid, {
    label: 'source fluid', shape: [GRID, GRID, GRID, 16], channelOrder: FLUID_CHANNELS, semanticRole: 'full-field-fluid',
  });
  const front = validateArtifact(exportManifest.sidecars?.front, {
    label: 'source front', shape: [GRID, GRID, GRID, 1], channelOrder: ['frontTopology'], semanticRole: 'full-field-front',
  });
  const majorant = validateArtifact(exportManifest.sidecars?.majorant, {
    label: 'source majorant', shape: [MAJORANT_GRID, MAJORANT_GRID, MAJORANT_GRID, 4],
    channelOrder: ['density', 'fire', 'extinction', 'importance'], semanticRole: 'full-field-majorant',
  });
  const boundary = validateArtifact(exportManifest.boundarySidecar?.sidecars?.boundary, {
    label: 'source boundary', shape: [GRID, GRID, GRID, 4],
    channelOrder: ['support', 'coverage', 'ridge', 'footprint'], semanticRole: 'full-field-boundary',
  });

  const controlIdentity = `sha256:${sha256(Buffer.from(replay.controlsSignature))}`;
  const payload = {
    schema: GRID96_NATIVE_SOURCE_SCHEMA,
    status: 'complete',
    failurePhase: null,
    role: 'source',
    authority: GRID96_NATIVE_SOURCE_AUTHORITY,
    preflightIdentity: GRID96_SOURCE_PREFLIGHT_IDENTITY,
    grid: GRID,
    majorantGrid: MAJORANT_GRID,
    completeFieldCoverage: true,
    fullGridCellCount: CELL_COUNT,
    sameStateCaptureId,
    simStepCount: replay.simStepCount,
    requestedControlIdentity: controlIdentity,
    effectiveControlIdentity: controlIdentity,
    route: {
      requested: exportManifest.url,
      effective: exportManifest.effectiveRoute,
      backend: exportManifest.backend,
      fallbackReason: null,
    },
    sourceBasin: {
      schema: basin.schema,
      identity: basin.identity || null,
      payloadSha256: basin.payloadSha256,
      replayRoute: basin.effectiveReplayRoute,
    },
    sourceExport: {
      path: resolve(sourceExportManifestPath),
      sha256: sourceExportManifestSha256,
      schema: exportManifest.schema,
      identity: exportManifest.identity,
      sessionId: exportManifest.sessionId,
      prototypeIdentity: exportManifest.prototypeIdentity,
    },
    replay: {
      identity: replay.identity,
      authority: replay.authority,
      requestedSteps: replay.requestedSteps,
      completedSteps: replay.completedSteps,
      timeStepMs: replay.timeStepMs,
      startTimeMs: replay.startTimeMs,
      finalTimeMs: replay.finalTimeMs,
      controlsSignature: replay.controlsSignature,
    },
    sidecars: { fluid, front, boundary, majorant },
    claimBoundary: {
      causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
      cheaperDemoClaim: false,
      resizedGrid160Evidence: false,
      learnerCampaign: false,
      depositionAdjudication: false,
    },
  };
  return { ...payload, identity: `sha256:${sha256(Buffer.from(stableJson(payload)))}` };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) throw new Error(`invalid argument pair at ${key || '<end>'}`);
    if (args.has(key)) throw new Error(`duplicate argument ${key}`);
    args.set(key, value);
  }
  return args;
}

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`missing required argument ${name}`);
  return value;
}

function rawArg(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? resolve(value) : null;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

async function main() {
  const argv = process.argv.slice(2);
  let failurePhase = 'argument-validation';
  let outPath = rawArg(argv, '--out');
  let reportPath = rawArg(argv, '--report');
  let lastTrustworthyEvidence = { argv: [...argv] };
  try {
    const args = parseArgs(argv);
    const sourceExportManifestPath = resolve(required(args, '--source-export-manifest'));
    const sameStateCaptureId = required(args, '--same-state-capture-id');
    outPath = resolve(required(args, '--out'));
    reportPath = resolve(required(args, '--report'));
    assert.notEqual(outPath, reportPath, '--out and --report must be different paths');
    lastTrustworthyEvidence = { sourceExportManifestPath, sameStateCaptureId, outPath, reportPath };

    failurePhase = 'source-export-read';
    const sourceExportBytes = readFileSync(sourceExportManifestPath);
    assert.ok(sourceExportBytes.length > 0, 'source export manifest is blank');
    const sourceExportManifestSha256 = sha256(sourceExportBytes);
    const sourceExportManifest = JSON.parse(sourceExportBytes.toString('utf8'));
    lastTrustworthyEvidence.sourceExportManifestSha256 = sourceExportManifestSha256;

    failurePhase = 'native-source-validation';
    const source = buildGrid96NativeSource(sourceExportManifest, {
      sourceExportManifestPath,
      sourceExportManifestSha256,
      sameStateCaptureId,
    });

    failurePhase = 'source-manifest-write';
    writeJsonAtomic(outPath, source);
    const outputBytes = readFileSync(outPath);
    const report = {
      identity: 'kaminos.volume.grid96-source-preflight-report.v0',
      status: 'complete',
      failurePhase: null,
      source: { path: outPath, bytes: outputBytes.length, sha256: sha256(outputBytes), identity: source.identity },
      input: { path: sourceExportManifestPath, bytes: sourceExportBytes.length, sha256: sourceExportManifestSha256 },
      route: source.route,
      sameStateCaptureId: source.sameStateCaptureId,
      simStepCount: source.simStepCount,
      claimBoundary: source.claimBoundary,
    };
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const failure = {
      identity: 'kaminos.volume.grid96-source-preflight-report.v0',
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    if (outPath) writeJsonAtomic(outPath, failure);
    if (reportPath && reportPath !== outPath) writeJsonAtomic(reportPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (isCli) await main();
