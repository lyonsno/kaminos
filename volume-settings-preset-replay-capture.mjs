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

const args = parseArgs(process.argv.slice(2));
const reportPath = optionalPath('--report');
let outPath = null;
let phase = 'argument-validation';
let lastTrustworthyEvidence = {};
try {
  const presetPath = requiredPath('--preset');
  outPath = requiredPath('--out');
  if (!reportPath) throw new Error('missing --report');
  const expectedPresetId = required('--expected-preset-id');
  const provenancePath = optionalPath('--provenance');
  const expectedSourceCommit = optional('--expected-source-commit');
  const targetOriginRaw = required('--target-origin');
  const overrides = args.has('--control-overrides-json')
    ? JSON.parse(String(args.get('--control-overrides-json')))
    : {};

  if (existsSync(outPath)) unlinkSync(outPath);
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
  const semanticIdentity = await validateVolumeSettingsPresetSemanticIdentity(artifact, expectedPresetId);
  const { domControlCount, routeControlCount: requestedRouteControlCount } = semanticIdentity;
  const sourceRoute = new URL(semanticIdentity.sourceRoute);
  let sourceProvenance = null;
  if (provenancePath) {
    const provenanceBytes = readFileSync(provenancePath);
    const provenance = JSON.parse(provenanceBytes.toString('utf8'));
    sourceProvenance = {
      ...validateVolumeSettingsPresetProvenance(provenance, semanticIdentity, expectedSourceCommit),
      path: provenancePath,
      artifactFileSha256: sha256(provenanceBytes),
      artifactFileSha256Authority: VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY,
    };
  }
  const sourceCommit = sourceProvenance?.sourceCommit || artifact?.source?.commit || null;
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
  if (reportPath) writeJson(reportPath, failureReport);
  process.stderr.write(`${JSON.stringify({ ok: false, report: reportPath, failurePhase: phase, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
