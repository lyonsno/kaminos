#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
  validateVolumeSettingsPresetProvenance,
  validateVolumeSettingsPresetSemanticIdentity,
} from './volume-settings-preset-semantic-identity.mjs';

const REPORT_SCHEMA = 'kaminos.volume.settings-preset-replay-capture-report.v0';
const REPORT_IDENTITY = 'settings-preset-replay-capture-adapter-v0';
const CAPTURE_SCHEMA = 'kaminos.operator-exact-live-splat-basin-capture.v1';
const CAPTURE_IDENTITY = 'settings-preset-replay-capture-v0';
const HASH_AUTHORITY = 'sha256-of-pre-hash-payload-json-utf8-pretty-printed-v0';
const CONTROL_OVERRIDE_AUTHORITY = 'exact-required-control-overrides-v0';
const REQUIRED_CONTROL_OVERRIDES = Object.freeze({
  volume_resolution: '96',
  volume_render_scale: '1',
});
const REQUIRED_STATE_EXCLUSIONS = Object.freeze([
  'fluidField',
  'frontField',
  'boundarySidecar',
  'splatInstances',
  'historyBuffers',
  'pressureState',
  'replayState',
]);

const args = parseArgs(process.argv.slice(2));
const reportPath = optionalPath('--report');
let failureReportPath = reportPath;
let outPath = null;
let phase = 'argument-validation';
let lastTrustworthyEvidence = {};
try {
  const presetPath = requiredPath('--preset');
  const requestedOutPath = requiredPath('--out');
  if (!reportPath) throw new Error('missing --report');
  const expectedPresetId = required('--expected-preset-id');
  const provenancePath = optionalPath('--provenance');
  if (!provenancePath) throw new Error('detached provenance is required for settings preset replay capture');
  const sourcePaths = new Set([presetPath, provenancePath]);
  const pathBindings = [
    ['--preset', presetPath],
    ['--provenance', provenancePath],
    ['--out', requestedOutPath],
    ['--report', reportPath],
  ];
  for (let left = 0; left < pathBindings.length; left += 1) {
    for (let right = left + 1; right < pathBindings.length; right += 1) {
      if (pathBindings[left][1] !== pathBindings[right][1]) continue;
      if (sourcePaths.has(reportPath)) failureReportPath = null;
      throw new Error(`${pathBindings[left][0]} and ${pathBindings[right][0]} must not resolve to the same path`);
    }
  }
  outPath = requestedOutPath;
  if (existsSync(outPath)) unlinkSync(outPath);
  const expectedSourceCommit = optional('--expected-source-commit');
  const targetOriginRaw = required('--target-origin');
  const overrides = args.has('--control-overrides-json')
    ? JSON.parse(String(args.get('--control-overrides-json')))
    : {};

  requireObject(overrides, '--control-overrides-json');
  phase = 'preset-load';
  const presetBytes = readFileSync(presetPath);
  const presetFileSha256 = sha256(presetBytes);
  const artifact = JSON.parse(presetBytes.toString('utf8'));
  lastTrustworthyEvidence = {
    presetPath,
    declaredPresetId: artifact?.presetId || null,
    declaredContentHash: artifact?.contentHash || null,
    artifactFileSha256: presetFileSha256,
    artifactFileSha256Authority: VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
  };
  phase = 'preset-validation';
  const provenanceBytes = readFileSync(provenancePath);
  const provenance = JSON.parse(provenanceBytes.toString('utf8'));
  const semanticIdentity = await validateVolumeSettingsPresetSemanticIdentity(
    artifact,
    expectedPresetId,
    provenance.routeAuthority,
  );
  const { domControlCount, routeControlCount: requestedRouteControlCount } = semanticIdentity;
  const sourceRoute = new URL(semanticIdentity.sourceRoute);
  const sourceProvenance = {
    ...validateVolumeSettingsPresetProvenance(provenance, semanticIdentity, expectedSourceCommit),
    path: provenancePath,
    artifactFileSha256: sha256(provenanceBytes),
    artifactFileSha256Authority: VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
  };
  const sourceCommit = sourceProvenance.sourceCommit;
  if (presetFileSha256 !== sourceProvenance.historicalArtifactFileSha256) {
    throw new Error('settings preset artifact bytes do not match detached provenance');
  }
  if (artifact?.source?.commit !== sourceCommit) {
    throw new Error('settings preset embedded source commit does not match detached provenance');
  }
  const stateExclusions = artifact?.preset?.stateExclusions;
  if (!stateExclusions || typeof stateExclusions !== 'object' || Array.isArray(stateExclusions)
    || Object.keys(stateExclusions).length !== REQUIRED_STATE_EXCLUSIONS.length
    || REQUIRED_STATE_EXCLUSIONS.some(key => stateExclusions[key] !== true)) {
    throw new Error('settings-only state exclusions are incomplete');
  }
  if (expectedSourceCommit && sourceCommit !== expectedSourceCommit) {
    throw new Error('settings preset source commit mismatch');
  }
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    presetId: artifact.presetId,
    contentHash: artifact.contentHash,
    semanticIdentityAuthority: semanticIdentity.semanticIdentityAuthority,
    sourceCommit,
    requestedDomControlCount: domControlCount,
    requestedRouteControlCount,
  };

  phase = 'target-origin-validation';
  const targetOrigin = new URL(targetOriginRaw);
  if (targetOrigin.pathname !== '/' || targetOrigin.search || targetOrigin.hash) {
    throw new Error('--target-origin must be an origin only');
  }
  sourceRoute.protocol = targetOrigin.protocol;
  sourceRoute.host = targetOrigin.host;

  phase = 'control-override-validation';
  if (canonicalJson(normalizeOverrideContract(overrides)) !== canonicalJson(REQUIRED_CONTROL_OVERRIDES)) {
    throw new Error('control overrides must exactly match the required control override contract');
  }
  const controlOverrides = {};
  for (const [key, rawValue] of Object.entries(overrides)) {
    if (!sourceRoute.searchParams.has(key)) throw new Error(`control override is absent from preset route: ${key}`);
    const presetValue = sourceRoute.searchParams.get(key);
    const effectiveValue = String(rawValue);
    sourceRoute.searchParams.set(key, effectiveValue);
    controlOverrides[key] = { preset: presetValue, effective: effectiveValue };
  }
  const effectiveRouteControlCount = [...sourceRoute.searchParams].length;
  if (effectiveRouteControlCount !== requestedRouteControlCount) {
    throw new Error('control override changed the executable route parameter count');
  }

  phase = 'capture-write';
  const payload = {
    schema: CAPTURE_SCHEMA,
    identity: CAPTURE_IDENTITY,
    savedAt: new Date().toISOString(),
    replayRoute: sourceRoute.href,
    controls: Object.fromEntries(sourceRoute.searchParams.entries()),
    controlCount: effectiveRouteControlCount,
    controlOverrides,
    controlOverrideContract: {
      authority: CONTROL_OVERRIDE_AUTHORITY,
      required: REQUIRED_CONTROL_OVERRIDES,
    },
    sourcePreset: {
      path: presetPath,
      presetId: artifact.presetId,
      contentHash: artifact.contentHash,
      schemaIdentity: artifact.schemaIdentity,
      semanticIdentityAuthority: semanticIdentity.semanticIdentityAuthority,
      artifactFileSha256: presetFileSha256,
      artifactFileSha256Authority: VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
      sourceCommit,
      sourceProvenance,
      domControlCount,
      routeControlCount: requestedRouteControlCount,
      stateExclusions: artifact.preset.stateExclusions,
    },
  };
  const payloadSha256 = sha256(Buffer.from(JSON.stringify(payload, null, 2)));
  const capture = {
    ...payload,
    payloadSha256,
    hashAuthority: HASH_AUTHORITY,
  };
  writeJson(outPath, capture);
  const captureFileSha256 = sha256(readFileSync(outPath));
  const report = {
    schema: REPORT_SCHEMA,
    identity: REPORT_IDENTITY,
    status: 'captured',
    failurePhase: null,
    requestedPreset: {
      path: presetPath,
      presetId: artifact.presetId,
      contentHash: artifact.contentHash,
      semanticIdentityAuthority: semanticIdentity.semanticIdentityAuthority,
      artifactFileSha256: presetFileSha256,
      artifactFileSha256Authority: VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
      sourceCommit,
    },
    requestedRouteControlCount,
    effectiveRouteControlCount,
    targetOrigin: targetOrigin.origin,
    controlOverrides,
    controlOverrideContract: capture.controlOverrideContract,
    capture: {
      path: outPath,
      schema: capture.schema,
      identity: capture.identity,
      payloadSha256,
      fileSha256: captureFileSha256,
      byteLength: readFileSync(outPath).byteLength,
    },
    lastTrustworthyEvidence: {
      ...lastTrustworthyEvidence,
      effectiveRoute: capture.replayRoute,
      controlOverrides,
      controlOverrideContract: capture.controlOverrideContract,
    },
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ ok: true, capture: outPath, report: reportPath, payloadSha256 }, null, 2)}\n`);
} catch (error) {
  if (outPath && existsSync(outPath)) unlinkSync(outPath);
  const failureReport = {
    schema: REPORT_SCHEMA,
    identity: REPORT_IDENTITY,
    status: 'failed',
    failurePhase: phase,
    error: error instanceof Error ? error.message : String(error),
    lastTrustworthyEvidence,
  };
  if (failureReportPath) writeJson(failureReportPath, failureReport);
  process.stderr.write(`${JSON.stringify({ ok: false, report: failureReportPath, failurePhase: phase, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function requiredPath(name) {
  return resolve(required(name));
}

function optional(name) {
  const value = args.get(name);
  return !value || value === true ? null : String(value);
}

function optionalPath(name) {
  const value = args.get(name);
  return !value || value === true ? null : resolve(String(value));
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must decode to an object`);
  }
}

function normalizeOverrideContract(value) {
  return Object.fromEntries(Object.entries(value).map(([key, rawValue]) => [key, String(rawValue)]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
