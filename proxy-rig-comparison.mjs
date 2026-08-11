export const PROXY_RIG_COMPARISON_SCHEMA = 'kaminos.proxy-rig-comparison.v0';

const SHA256 = /^[a-f0-9]{64}$/;

function requireText(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Proxy rig comparison ${label} must be a non-empty string`);
  }
  return value;
}

export function validateProxyRigComparisonManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Proxy rig comparison manifest must be an object');
  }
  if (input.schema !== PROXY_RIG_COMPARISON_SCHEMA) {
    throw new Error(`Proxy rig comparison schema ${String(input.schema)} is unsupported`);
  }
  requireText(input.claimCeiling, 'claim ceiling');
  requireText(input.defaultCandidate, 'default candidate');
  if (!Array.isArray(input.candidates) || input.candidates.length < 2) {
    throw new Error('Proxy rig comparison requires at least two candidates');
  }
  const ids = new Set();
  for (const [index, candidate] of input.candidates.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Proxy rig comparison candidate ${index} must be an object`);
    }
    const id = requireText(candidate.id, `candidate ${index} id`);
    if (ids.has(id)) throw new Error(`Proxy rig comparison candidate id ${id} is duplicated`);
    ids.add(id);
    requireText(candidate.label, `candidate ${id} label`);
    requireText(candidate.role, `candidate ${id} role`);
    requireText(candidate.cast, `candidate ${id} cast path`);
    requireText(candidate.registrationReceipt, `candidate ${id} registration receipt path`);
    requireText(candidate.package, `candidate ${id} package path`);
    if (!SHA256.test(candidate.castSha256)) {
      throw new Error(`Proxy rig comparison candidate ${id} castSha256 is malformed`);
    }
    if (typeof candidate.seriousVisibleChoice !== 'boolean') {
      throw new Error(`Proxy rig comparison candidate ${id} seriousVisibleChoice must be boolean`);
    }
    if (!candidate.provenance || typeof candidate.provenance !== 'object') {
      throw new Error(`Proxy rig comparison candidate ${id} provenance is required`);
    }
    requireText(candidate.provenance.sourceRef, `candidate ${id} provenance sourceRef`);
    requireText(candidate.provenance.sourceCommit, `candidate ${id} provenance sourceCommit`);
  }
  if (!ids.has(input.defaultCandidate)) {
    throw new Error(`Proxy rig comparison default candidate ${input.defaultCandidate} is unknown`);
  }
  return input;
}

export function resolveProxyRigComparisonCandidate(manifest, candidateId) {
  const validated = validateProxyRigComparisonManifest(manifest);
  const candidate = validated.candidates.find(item => item.id === candidateId);
  if (!candidate) throw new Error(`Unknown comparison candidate ${String(candidateId)}`);
  return candidate;
}

export function transferProxyRigComparisonPose(pose, targetControlNames) {
  if (!pose || typeof pose !== 'object' || Array.isArray(pose)) {
    throw new Error('Proxy rig comparison pose must be an object');
  }
  if (!Array.isArray(targetControlNames)) {
    throw new Error('Proxy rig comparison target controls must be an array');
  }
  const source = Object.keys(pose).sort();
  const target = [...targetControlNames].sort();
  const missing = source.filter(name => !target.includes(name));
  const added = target.filter(name => !source.includes(name));
  if (missing.length || added.length) {
    throw new Error(
      `Proxy rig comparison control contract mismatch: missing [${missing.join(', ')}], added [${added.join(', ')}]`,
    );
  }
  return structuredClone(pose);
}

export function createProxyRigComparisonCarryState({
  pose,
  selectedControl,
  cameraPosition,
  orbitTarget,
}) {
  if (!pose || typeof pose !== 'object' || Array.isArray(pose)) {
    throw new Error('Proxy rig comparison carry pose must be an object');
  }
  if (typeof selectedControl !== 'string' || !Object.hasOwn(pose, selectedControl)) {
    throw new Error(`Proxy rig comparison selected control ${String(selectedControl)} is not present in the pose`);
  }
  for (const [label, value] of Object.entries({ cameraPosition, orbitTarget })) {
    if (!Array.isArray(value) || value.length !== 3 || value.some(component => !Number.isFinite(component))) {
      throw new Error(`Proxy rig comparison ${label} must contain three finite numbers`);
    }
  }
  return structuredClone({ pose, selectedControl, cameraPosition, orbitTarget });
}

export function validateProxyRigComparisonLiveState({
  manifest,
  candidateId,
  expectedPackageId,
  liveState,
}) {
  const candidate = resolveProxyRigComparisonCandidate(manifest, candidateId);
  if (!liveState || liveState.status !== 'live') {
    throw new Error(`Proxy rig comparison candidate ${candidateId} is not live`);
  }
  if (liveState.requestedPackagePath !== candidate.package) {
    throw new Error(
      `Proxy rig comparison requested package path ${String(liveState.requestedPackagePath)} does not match ${candidate.package}`,
    );
  }
  if (typeof liveState.effectivePackagePath !== 'string'
    || !liveState.effectivePackagePath.endsWith(candidate.package)) {
    throw new Error(
      `Proxy rig comparison effective package path ${String(liveState.effectivePackagePath)} does not match ${candidate.package}`,
    );
  }
  if (liveState.packageId !== expectedPackageId) {
    throw new Error(
      `Proxy rig comparison package identity ${String(liveState.packageId)} does not match ${expectedPackageId}`,
    );
  }
  if (liveState.source?.comparisonCandidate?.id !== candidate.id) {
    throw new Error(
      `Proxy rig comparison embedded candidate ${String(liveState.source?.comparisonCandidate?.id)} does not match ${candidate.id}`,
    );
  }
  return candidate;
}
