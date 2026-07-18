#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID96_SOURCE_EQUIVALENCE_SCHEMA = 'kaminos.volume.grid96-source-equivalence.v0';
export const GRID96_SOURCE_EQUIVALENCE_IDENTITY = 'exact-four-payload-byte-identity-at-state-v0';

const GRID = 96;
const CELL_COUNT = GRID ** 3;
const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const SOURCE_SCHEMA = 'kaminos.volume.grid96-source.v0';
const SOURCE_AUTHORITY = 'native-grid96-full-field-export-v0';
const CANDIDATE_SCHEMA = 'kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0';
const CANDIDATE_AUTHORITY = 'single-browser-multi-state-exact-bilinear-motion-v0';
const REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const TRANSIENT_SOURCE_IDENTITY = 'transient-full-field-source-receipt-v0';
const DELETION_IDENTITY = 'checksum-bound-transient-full-field-deletion-v0';
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const FULL_FLAME_PRESET_ID = 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2';
const FULL_FLAME_SOURCE_COMMIT = '1dfd4ca96164860fd983f7267856bccd91e322db';
const FULL_FLAME_PRESET_FILE_SHA256 = '4928df29729e9316d059ccee6c46a946c07743d322363489d99518ecdd9a3172';

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSha256(value, label) {
  assert.match(value || '', HEX_SHA256, `${label} must be a SHA-256`);
}

function sourceHashesFromAuthority(source) {
  const hashes = {
    fluidSha256: source.sidecars?.fluid?.sha256,
    frontSha256: source.sidecars?.front?.sha256,
    boundarySidecarSha256: source.sidecars?.boundary?.sha256,
    majorantSha256: source.sidecars?.majorant?.sha256,
  };
  for (const [key, value] of Object.entries(hashes)) assertSha256(value, `authoritative ${key}`);
  return hashes;
}

function validateAuthoritativeSource(source) {
  assert.equal(source?.schema, SOURCE_SCHEMA, 'authoritative source schema drifted');
  assert.equal(source.status, 'complete', 'authoritative source is incomplete');
  assert.equal(source.failurePhase ?? null, null, 'authoritative source carries a failure phase');
  assert.equal(source.authority, SOURCE_AUTHORITY, 'authoritative source authority drifted');
  assert.equal(source.grid, GRID, 'authoritative source is not native Grid96');
  assert.equal(source.majorantGrid, 24, 'authoritative source majorant grid drifted');
  assert.equal(source.completeFieldCoverage, true, 'authoritative source is partial');
  assert.equal(source.fullGridCellCount, CELL_COUNT, 'authoritative source cell count is incomplete');
  assert.equal(source.simStepCount, 120, 'authoritative source is not state 120');
  assert.equal(source.route?.effective, ROUTE_IDENTITY, 'authoritative source did not use the native route');
  assert.match(source.route?.backend || '', /^WebGPU:/, 'authoritative source backend is not WebGPU');
  assert.equal(source.route?.fallbackReason ?? null, null, 'authoritative source used a fallback');
  assert.equal(source.replay?.identity, REPLAY_IDENTITY, 'authoritative source replay identity drifted');
  assert.equal(source.replay?.requestedSteps, 120, 'authoritative source replay request drifted');
  assert.equal(source.replay?.completedSteps, 120, 'authoritative source replay is incomplete');
  assert.equal(source.requestedControlIdentity, source.effectiveControlIdentity, 'authoritative source controls were substituted');
  assert.equal(source.sourceBasin?.presetId, FULL_FLAME_PRESET_ID, 'authoritative source preset identity drifted');
  assert.equal(source.sourceBasin?.sourceCommit, FULL_FLAME_SOURCE_COMMIT, 'authoritative source commit drifted');
  assert.equal(source.sourceBasin?.artifactFileSha256, FULL_FLAME_PRESET_FILE_SHA256, 'authoritative source preset bytes drifted');
  assert.equal(source.claimBoundary?.causalQuestion, 'source-lattice-subcell-vs-deposit-space-quadrature-v0', 'causal question drifted');
  assert.equal(source.claimBoundary?.cheaperDemoClaim, false, 'authoritative source carries a cheaper-demo claim');
  assert.equal(source.claimBoundary?.resizedGrid160Evidence, false, 'authoritative source resized Grid160 evidence');
  assert.equal(source.claimBoundary?.learnerCampaign, false, 'authoritative source absorbed a learner campaign');
  assert.equal(source.claimBoundary?.depositionAdjudication, false, 'authoritative source claimed deposition adjudication');
}

function assertSameBasinAuthority(source, candidate) {
  for (const field of ['presetId', 'contentHash', 'sourceCommit', 'artifactFileSha256', 'controlOverrideAuthority']) {
    assert.equal(candidate.sourceBasin?.[field], source.sourceBasin?.[field], `candidate source basin ${field} drifted`);
  }
  assert.equal(
    stableJson(candidate.sourceBasin?.controlOverrideRequired),
    stableJson(source.sourceBasin?.controlOverrideRequired),
    'candidate source basin control override contract drifted',
  );
  assert.equal(
    stableJson(candidate.sourceBasin?.controlOverrides),
    stableJson(source.sourceBasin?.controlOverrides),
    'candidate source basin effective overrides drifted',
  );
}

export function buildGrid96NativeSourcePairEquivalence(source, candidate, { stateId } = {}) {
  validateAuthoritativeSource(source);
  validateAuthoritativeSource(candidate);
  assert.equal(stateId, 'coefficient-state-120', 'native source-pair equivalence requires coefficient-state-120');
  assertSameBasinAuthority(source, candidate);

  const authoritativeHashes = sourceHashesFromAuthority(source);
  const candidateHashes = sourceHashesFromAuthority(candidate);
  for (const [key, expected] of Object.entries(authoritativeHashes)) {
    const field = key.replace(/Sha256$/, '').replace('boundarySidecar', 'boundary');
    assert.equal(candidateHashes[key], expected, `${field} checksum differs from authoritative native Grid96 source`);
  }

  const payload = {
    schema: GRID96_SOURCE_EQUIVALENCE_SCHEMA,
    status: 'equivalent',
    failurePhase: null,
    equivalenceIdentity: GRID96_SOURCE_EQUIVALENCE_IDENTITY,
    exactByteIdentity: true,
    candidateKind: 'normalized-native-grid96-source-v0',
    grid: GRID,
    stateId,
    simStepCount: 120,
    authoritativeSourceIdentity: source.identity,
    candidateSourceIdentity: candidate.identity,
    sourceHashes: authoritativeHashes,
    route: {
      authoritativeRequested: source.route.requested,
      candidateRequested: candidate.route.requested,
      authoritativeEffective: source.route.effective,
      candidateEffective: candidate.route.effective,
      authoritativeBackend: source.route.backend,
      candidateBackend: candidate.route.backend,
      fallbackUsed: false,
    },
    controls: {
      authoritativeRequested: source.requestedControlIdentity,
      authoritativeEffective: source.effectiveControlIdentity,
      candidateRequested: candidate.requestedControlIdentity,
      candidateEffective: candidate.effectiveControlIdentity,
      substitutionObserved: false,
      exactPresetAuthorityMatched: true,
    },
    reuseDecision: {
      tigerRuntimeSourceEquivalent: true,
      directCoefficientCaptureMayProceed: true,
      frozenFieldImportRequired: false,
      authority: 'four-native-grid96-payload-sha256-equality-v0',
      limitation: 'This admits direct coefficient capture; it does not claim coefficient, descriptor, teacher, target, or deposition closure.',
    },
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

function validateCandidate(candidate) {
  assert.equal(candidate?.schema, CANDIDATE_SCHEMA, 'candidate corpus schema drifted');
  assert.equal(candidate.status, 'complete', 'candidate corpus is incomplete');
  assert.equal(candidate.authority, CANDIDATE_AUTHORITY, 'candidate corpus authority drifted');
  assert.equal(candidate.route?.effective, ROUTE_IDENTITY, 'candidate corpus did not use the native route');
  assert.match(candidate.route?.backend || '', /^WebGPU:/, 'candidate corpus backend is not WebGPU');
  assert.equal(candidate.route?.fallbackReason ?? null, null, 'candidate corpus used a fallback');
  assert.equal(candidate.sequence?.sampleCap ?? null, null, 'candidate corpus installed a sample cap');
  assert.equal(candidate.sequence?.droppedRowCount ?? 0, 0, 'candidate corpus dropped admitted rows');
  assert.ok(Array.isArray(candidate.states), 'candidate corpus states are missing');
  assert.equal(candidate.sequence?.stateCount, candidate.states.length, 'candidate state count drifted');
}

export function buildGrid96SourceEquivalence(source, candidate, { stateId } = {}) {
  validateAuthoritativeSource(source);
  validateCandidate(candidate);
  assert.equal(typeof stateId, 'string', 'state identity is required');
  const state = candidate.states.find(value => value.id === stateId);
  assert.ok(state, `candidate state is missing: ${stateId}`);
  assert.equal(state.id, 'coefficient-state-120', 'candidate state must be exact coefficient-state-120');
  assert.equal(state.replay?.identity, REPLAY_IDENTITY, 'candidate replay identity drifted');
  assert.equal(state.replay?.requestedSteps, 120, 'candidate replay request is not state 120');
  assert.equal(state.replay?.completedSteps, 120, 'candidate replay did not complete state 120');
  assert.equal(state.replay?.grid, GRID, 'candidate replay is not native Grid96');
  assert.equal(state.replay?.effectiveRoute, ROUTE_IDENTITY, 'candidate replay did not use the native route');
  assert.match(state.replay?.backend || '', /^WebGPU:/, 'candidate replay backend is not WebGPU');
  assert.equal(state.requestedControlIdentity, state.effectiveControlIdentity, 'candidate causal controls were substituted');
  assert.ok(Number.isInteger(state.rows?.count) && state.rows.count > 0, 'candidate analytical admission retained zero rows');

  const sourceReceipt = state.sourceFieldManifest;
  assert.equal(sourceReceipt?.identity, TRANSIENT_SOURCE_IDENTITY, 'candidate source receipt identity drifted');
  assert.equal(sourceReceipt.retained, false, 'candidate equivalence probe unexpectedly retained duplicate full fields');
  assert.equal(state.sourceFieldRetention?.identity, DELETION_IDENTITY, 'candidate source deletion receipt drifted');
  assert.equal(state.sourceFieldRetention?.deleted, true, 'candidate transient source fields were not deleted');
  assert.equal(sourceReceipt.sha256, state.sourceFieldRetention?.sourceManifestSha256, 'candidate source manifest deletion receipt drifted');
  assert.deepEqual(sourceReceipt.sourceHashes, state.sourceFieldRetention?.sourceHashes, 'candidate source hash receipts disagree');

  const authoritativeHashes = sourceHashesFromAuthority(source);
  const candidateHashes = sourceReceipt.sourceHashes;
  for (const [key, expected] of Object.entries(authoritativeHashes)) {
    assertSha256(candidateHashes?.[key], `candidate ${key}`);
    const field = key.replace(/Sha256$/, '').replace('boundarySidecar', 'boundary');
    assert.equal(candidateHashes[key], expected, `${field} checksum differs from authoritative native Grid96 source`);
  }

  const payload = {
    schema: GRID96_SOURCE_EQUIVALENCE_SCHEMA,
    status: 'equivalent',
    failurePhase: null,
    equivalenceIdentity: GRID96_SOURCE_EQUIVALENCE_IDENTITY,
    exactByteIdentity: true,
    grid: GRID,
    stateId,
    simStepCount: 120,
    authoritativeSourceIdentity: source.identity,
    candidateCorpusIdentity: candidate.identity,
    sourceHashes: authoritativeHashes,
    route: {
      authoritativeRequested: source.route.requested,
      candidateRequested: candidate.route.requested,
      authoritativeEffective: source.route.effective,
      candidateEffective: candidate.route.effective,
      authoritativeBackend: source.route.backend,
      candidateBackend: candidate.route.backend,
      fallbackUsed: false,
    },
    controls: {
      authoritativeRequested: source.requestedControlIdentity,
      authoritativeEffective: source.effectiveControlIdentity,
      candidateRequested: state.requestedControlIdentity,
      candidateEffective: state.effectiveControlIdentity,
      substitutionObserved: false,
      note: 'Control identity algorithms differ by producer; exact frozen payload bytes are the equivalence authority.',
    },
    candidateAdmission: {
      retainedRowCount: state.rows.count,
      sampleCap: null,
      droppedRowCount: 0,
    },
    reuseDecision: {
      exactCoefficientProducerSourceEquivalent: true,
      frozenFieldImportRequired: false,
      authority: 'four-native-grid96-payload-sha256-equality-v0',
    },
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
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    assert.ok(next && !next.startsWith('--'), `${key} requires a value`);
    parsed.set(key, next);
    index += 1;
  }
  return parsed;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = resolve(String(args.get('--source-manifest') || ''));
  const candidatePath = resolve(String(args.get('--candidate-manifest') || ''));
  const stateId = String(args.get('--state-id') || '');
  const outPath = resolve(String(args.get('--out') || ''));
  const reportPath = resolve(String(args.get('--report') || ''));
  let failurePhase = 'argument-validation';
  try {
    assert.ok(args.get('--source-manifest'), '--source-manifest is required');
    assert.ok(args.get('--candidate-manifest'), '--candidate-manifest is required');
    assert.ok(args.get('--state-id'), '--state-id is required');
    assert.ok(args.get('--out'), '--out is required');
    assert.ok(args.get('--report'), '--report is required');
    failurePhase = 'source-equivalence-validation';
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
    const equivalence = candidate?.schema === SOURCE_SCHEMA
      ? buildGrid96NativeSourcePairEquivalence(source, candidate, { stateId })
      : buildGrid96SourceEquivalence(source, candidate, { stateId });
    atomicWriteJson(outPath, equivalence);
    atomicWriteJson(reportPath, {
      schema: 'kaminos.volume.grid96-source-equivalence-report.v0',
      status: 'complete',
      failurePhase: null,
      sourceManifest: sourcePath,
      candidateManifest: candidatePath,
      stateId,
      equivalenceIdentity: equivalence.identity,
      exactByteIdentity: true,
    });
    console.log(JSON.stringify({ status: 'equivalent', outPath, reportPath, identity: equivalence.identity }, null, 2));
  } catch (error) {
    const failure = {
      schema: GRID96_SOURCE_EQUIVALENCE_SCHEMA,
      status: 'failed',
      failurePhase,
      reason: error?.message || String(error),
      exactByteIdentity: false,
      sourceManifest: sourcePath || null,
      candidateManifest: candidatePath || null,
      stateId: stateId || null,
    };
    if (outPath && outPath !== resolve('')) atomicWriteJson(outPath, failure);
    if (reportPath && reportPath !== resolve('')) {
      atomicWriteJson(reportPath, { ...failure, schema: 'kaminos.volume.grid96-source-equivalence-report.v0' });
    }
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
