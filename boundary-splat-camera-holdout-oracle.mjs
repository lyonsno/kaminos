import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const SCHEMA = 'kaminos.boundary-splat-camera-holdout-oracle.v0';
const PRESET_ID = 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2';
const FAMILY_AUTHORITIES = Object.freeze({
  'analytic-billboard': 'camera-facing-billboard-v0',
  'learned-billboard': 'learned-camera-facing-billboard-v0',
  'world-tangent-covariance': 'world-gradient-tangent-covariance-v0',
});
const CONSERVATION_AUTHORITY = 'rendered-gaussian-integrated-alpha-conserved-v0';
const ATTRIBUTE_PAYLOAD_AUTHORITY = 'gpu-compacted-boundary-splat-effective-attributes-v0';
const TARGET_AUTHORITY = 'smoke-off-complete-flame-local-emission-extinction-v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

async function verifyArtifact(artifact, label) {
  if (!artifact || typeof artifact.path !== 'string' || !artifact.path) throw new Error(`${label} artifact path is missing`);
  const path = isAbsolute(artifact.path) ? artifact.path : resolve(artifact.path);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`${label} artifact is blank`);
  if (artifact.bytes !== bytes.length) throw new Error(`${label} artifact byte length mismatch`);
  const digest = sha256(bytes);
  if (artifact.sha256 !== digest) throw new Error(`${label} artifact sha256 mismatch`);
  return { path, bytes: bytes.length, sha256: digest };
}

function exactIndexSet(actual, expected, label) {
  if (!Array.isArray(actual) || actual.some(value => !Number.isInteger(value))) {
    throw new Error(`${label} must contain integer camera indices`);
  }
  const normalized = [...new Set(actual)].sort((left, right) => left - right);
  if (normalized.length !== expected.length || normalized.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} does not cover the effective camera set`);
  }
}

export async function validateCameraHoldoutReport(report, options = {}) {
  if (!report || report.schema !== SCHEMA) throw new Error(`camera holdout report schema must be ${SCHEMA}`);
  if (report.status !== 'completed') throw new Error(`camera holdout report is incomplete: ${report.status || 'missing'}`);
  if (report.requestedRoute !== '/volume-selective-head-live.html') throw new Error('requested camera holdout route is wrong');
  if (report.effectiveWrapperRoute !== 'exact-basin-selective-head-live-v0'
    || report.effectiveRendererRoute !== 'native-3d-compute-fluid-raymarch-v0') {
    throw new Error('requested/effective route disagreement');
  }
  if (typeof report.backend !== 'string' || !report.backend.startsWith('WebGPU:')) throw new Error('effective WebGPU backend is missing');
  if (report.fallbackReason != null) throw new Error(`renderer fallback: ${report.fallbackReason}`);
  if (report.sourceSettingsPreset?.presetId !== PRESET_ID
    || report.sourceSettingsPreset?.authority !== 'shared-volume-settings-preset-v2') {
    throw new Error('stale or default Full Flame preset replaced the requested source');
  }
  if (!report.frozenState?.sameStateCaptureId
    || !Number.isInteger(report.frozenState.frameCount)
    || !Number.isInteger(report.frozenState.simStepCount)
    || typeof report.frozenState.controlsHash !== 'string') {
    throw new Error('effective frozen simulator state identity is incomplete');
  }
  const candidatePayload = report.candidatePayload || {};
  if (candidatePayload.authority !== 'gpu-compacted-boundary-splat-candidates-frozen-state-v0'
    || !Number.isInteger(candidatePayload.count) || candidatePayload.count <= 0
    || !Number.isInteger(candidatePayload.strideFloats) || candidatePayload.strideFloats < 4
    || !/^[0-9a-f]{64}$/.test(candidatePayload.sha256 || '')) {
    throw new Error('candidate payload identity is missing or partial');
  }
  if (!Array.isArray(report.cameraRows) || report.cameraRows.length === 0) throw new Error('camera holdout rows are missing');

  const cameraIndices = [...new Set(report.cameraRows.map(row => row.cameraIndex))].sort((left, right) => left - right);
  if (cameraIndices.length < 3) throw new Error('camera holdout requires at least one training and two held-out cameras');
  if (options.expectedCameraCount != null && cameraIndices.length !== Number(options.expectedCameraCount)) {
    throw new Error(`camera holdout expected ${options.expectedCameraCount} cameras, received ${cameraIndices.length}`);
  }
  const trainIndices = [...new Set(report.trainCameraIndices || [])].sort((left, right) => left - right);
  const heldOutIndices = [...new Set(report.heldOutCameraIndices || [])].sort((left, right) => left - right);
  if (trainIndices.length === 0 || heldOutIndices.length < 2) throw new Error('camera holdout split is incomplete');
  if (trainIndices.some(index => heldOutIndices.includes(index))) throw new Error('training and held-out camera sets overlap');
  exactIndexSet([...trainIndices, ...heldOutIndices], cameraIndices, 'camera split');

  const rowKeys = new Set();
  const rowsByFamily = new Map(Object.keys(FAMILY_AUTHORITIES).map(family => [family, []]));
  const targetHashByCamera = new Map();
  for (const [rowIndex, row] of report.cameraRows.entries()) {
    const label = `camera row ${rowIndex}`;
    if (!cameraIndices.includes(row.cameraIndex) || typeof row.cameraPoseHash !== 'string') throw new Error(`${label} camera identity is incomplete`);
    const expectedFamilyAuthority = FAMILY_AUTHORITIES[row.family];
    if (!Object.hasOwn(FAMILY_AUTHORITIES, row.family)
      || row.familyAuthority !== expectedFamilyAuthority
      || row.rendererFootprintAuthority !== expectedFamilyAuthority
      || row.auditFootprintAuthority !== expectedFamilyAuthority) {
      throw new Error(`${label} effective footprint authority is wrong`);
    }
    const key = `${row.cameraIndex}:${row.family}`;
    if (rowKeys.has(key)) throw new Error(`${label} duplicates ${key}`);
    rowKeys.add(key);
    if (typeof row.attributeSetId !== 'string' || !row.attributeSetId) throw new Error(`${label} attribute set identity is missing`);
    if (row.attributePayloadAuthority !== ATTRIBUTE_PAYLOAD_AUTHORITY
      || !/^[0-9a-f]{64}$/.test(row.attributePayloadSha256 || '')) {
      throw new Error(`${label} effective attribute payload identity is missing`);
    }
    if (row.candidateCount !== candidatePayload.count || row.instanceCount !== candidatePayload.count || row.overflowCount !== 0) {
      throw new Error(`${label} candidate count is missing, partial, or overflowed`);
    }
    if (row.candidatePayloadSha256 !== candidatePayload.sha256) throw new Error(`${label} candidate payload changed across cameras or families`);
    if (row.fallbackReason != null) throw new Error(`${label} renderer fallback: ${row.fallbackReason}`);
    if (row.targetAuthority !== TARGET_AUTHORITY) throw new Error(`${label} Full Flame target authority is wrong`);
    const conservation = row.conservation || {};
    const base = finite(conservation.baseIntegratedAlphaSum, `${label} base integrated alpha`);
    const effective = finite(conservation.effectiveIntegratedAlphaSum, `${label} effective integrated alpha`);
    const relativeError = finite(conservation.relativeError, `${label} integrated alpha relative error`);
    const recomputedError = Math.abs(effective - base) / Math.max(Math.abs(base), 1e-12);
    if (conservation.authority !== CONSERVATION_AUTHORITY || relativeError > 1e-5 || recomputedError > 1e-5) {
      throw new Error(`${label} integrated alpha conservation failed`);
    }
    const target = await verifyArtifact(row.target, `${label} target`);
    const image = await verifyArtifact(row.image, `${label} image`);
    if (targetHashByCamera.has(row.cameraIndex) && targetHashByCamera.get(row.cameraIndex) !== target.sha256) {
      throw new Error(`${label} target changed between footprint families`);
    }
    targetHashByCamera.set(row.cameraIndex, target.sha256);
    rowsByFamily.get(row.family).push({ ...row, image });
  }

  for (const [family, rows] of rowsByFamily) {
    if (rows.length !== cameraIndices.length) throw new Error(`${family} is missing candidate rows for one or more cameras`);
    const attributeSetIds = new Set(rows.map(row => row.attributeSetId));
    if (attributeSetIds.size !== 1) throw new Error(`${family} attribute set was not reused across held-out cameras`);
    const attributePayloadHashes = new Set(rows.map(row => row.attributePayloadSha256));
    if (attributePayloadHashes.size !== 1) throw new Error(`${family} attribute payload was not reused across held-out cameras`);
    const imageHashes = new Set(rows.map(row => row.image.sha256));
    if (imageHashes.size !== rows.length) throw new Error(`${family} cached or static output pretending to be a camera orbit`);
  }
  const learnedAttributeSet = rowsByFamily.get('learned-billboard')[0].attributeSetId;
  const worldAttributeSet = rowsByFamily.get('world-tangent-covariance')[0].attributeSetId;
  if (learnedAttributeSet !== worldAttributeSet) {
    throw new Error('learned billboard attribute set was not reused by world covariance');
  }
  const learnedAttributePayload = rowsByFamily.get('learned-billboard')[0].attributePayloadSha256;
  const worldAttributePayload = rowsByFamily.get('world-tangent-covariance')[0].attributePayloadSha256;
  if (learnedAttributePayload !== worldAttributePayload) {
    throw new Error('learned billboard effective attribute payload was not reused by world covariance');
  }

  return {
    schema: SCHEMA,
    cameraCount: cameraIndices.length,
    familyCount: rowsByFamily.size,
    candidateCount: candidatePayload.count,
    trainCameraIndices: trainIndices,
    heldOutCameraIndices: heldOutIndices,
  };
}
