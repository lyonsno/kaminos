export const PROCEDURAL_GROOM_OBSERVATION_SCHEMA = 'kaminos.procedural-groom-observation.v0';
export const PROCEDURAL_GROOM_PROPOSAL_SCHEMA = 'kaminos.procedural-groom-proposal.v0';
export const PROCEDURAL_GROOM_TRUTH_REFERENCE_SCHEMA = 'kaminos.procedural-groom-truth-reference.v0';
export const PROCEDURAL_GROOM_ESTIMATION_REPORT_SCHEMA = 'kaminos.procedural-groom-estimation-report.v0';

const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED_REGIONS = [
  'short-coat',
  'puffy-coat',
  'ruff',
  'mystacial-pad-left',
  'mystacial-pad-right',
];
const FORBIDDEN_PROPOSAL_KEYS = new Set([
  'truth',
  'truthManifest',
  'groundTruth',
  'guideIds',
  'displayColor',
  'carrierTriangle',
  'barycentric',
]);

function report(state, failures = []) {
  return {
    schema: PROCEDURAL_GROOM_ESTIMATION_REPORT_SCHEMA,
    state,
    failures,
    visualAdmission: false,
    scientificAdmission: false,
  };
}

function unit(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function direction2d(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) return false;
  const length = Math.hypot(...value);
  return length >= 0.5 && length <= 1.5;
}

function collectForbiddenKeys(value, path = 'proposal', failures = []) {
  if (!value || typeof value !== 'object') return failures;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, failures));
    return failures;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROPOSAL_KEYS.has(key)) failures.push(`${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, failures);
  }
  return failures;
}

export function evaluateProceduralGroomEstimationAssay({ observation, proposal, truthReference } = {}) {
  const observationFailures = [];
  if (observation?.schema !== PROCEDURAL_GROOM_OBSERVATION_SCHEMA) {
    observationFailures.push(`expected observation schema ${PROCEDURAL_GROOM_OBSERVATION_SCHEMA}`);
  }
  if (typeof observation?.observationId !== 'string' || !observation.observationId) {
    observationFailures.push('observationId must be nonempty');
  }
  if (!SHA256.test(observation?.digest ?? '')) observationFailures.push('observation digest must be sha256');
  if (observation?.truthExposure !== 'withheld') observationFailures.push('truthExposure must remain withheld');
  if (!observation?.requestedRoute || observation.requestedRoute !== observation.effectiveRoute) {
    observationFailures.push('requested and effective observation routes must match');
  }
  if (!Array.isArray(observation?.views) || observation.views.length === 0) {
    observationFailures.push('observation requires at least one rendered view');
  } else {
    const viewIds = new Set();
    for (const [index, view] of observation.views.entries()) {
      const label = view?.id || `view[${index}]`;
      if (!view?.id || viewIds.has(view.id)) observationFailures.push(`${label}: view id must be nonempty and unique`);
      viewIds.add(view?.id);
      if (typeof view?.path !== 'string' || !view.path) observationFailures.push(`${label}: missing image path`);
      if (!SHA256.test(view?.sha256 ?? '')) observationFailures.push(`${label}: missing image sha256`);
      if (!positive(view?.byteLength)) observationFailures.push(`${label}: image is blank`);
      for (const field of ['membershipColorsVisible', 'labelsVisible', 'gizmoVisible']) {
        if (view?.[field] !== false) observationFailures.push(`${label}: ${field} must be false`);
      }
    }
  }
  if (observationFailures.length) return report('invalid_observation', observationFailures);

  const leakedPaths = collectForbiddenKeys(proposal);
  if (leakedPaths.length) {
    return report('proposal_truth_leakage', leakedPaths.map(path => `${path} is forbidden estimator input`));
  }

  if (!proposal?.requestedRoute || proposal.requestedRoute !== proposal.effectiveRoute) {
    return report('invalid_proposal_route', ['requested and effective proposal routes must match']);
  }

  const proposalFailures = [];
  if (proposal?.schema !== PROCEDURAL_GROOM_PROPOSAL_SCHEMA) {
    proposalFailures.push(`expected proposal schema ${PROCEDURAL_GROOM_PROPOSAL_SCHEMA}`);
  }
  if (!SHA256.test(proposal?.proposalDigest ?? '')) proposalFailures.push('proposalDigest must be sha256');
  if (proposal?.observationId !== observation.observationId) proposalFailures.push('proposal observationId mismatch');
  if (proposal?.observationDigest !== observation.digest) proposalFailures.push('proposal observationDigest mismatch');
  if (proposal?.visualAdmission !== false || proposal?.scientificAdmission !== false) {
    proposalFailures.push('proposal cannot grant visual or scientific admission');
  }
  const regions = Array.isArray(proposal?.regions) ? proposal.regions : [];
  const regionIds = new Set(regions.map(region => region.id));
  for (const id of REQUIRED_REGIONS) {
    if (!regionIds.has(id)) proposalFailures.push(`missing target region ${id}`);
  }
  for (const region of regions) {
    const label = region?.id || 'unnamed-region';
    if (!unit(region?.presenceProbability)) proposalFailures.push(`${label}: invalid presenceProbability`);
    if (typeof region?.mask?.path !== 'string' || !region.mask.path) proposalFailures.push(`${label}: missing mask path`);
    if (!SHA256.test(region?.mask?.sha256 ?? '')) proposalFailures.push(`${label}: missing mask sha256`);
    if (!positive(region?.mask?.byteLength)) proposalFailures.push(`${label}: mask is blank`);
    if (!direction2d(region?.flow2d)) proposalFailures.push(`${label}: flow2d must be a finite direction`);
    for (const field of ['lengthToCarrierScale', 'density', 'puff', 'confidence']) {
      if (!unit(region?.[field])) proposalFailures.push(`${label}: ${field} must be in [0, 1]`);
    }
  }
  const whiskers = proposal?.whiskers;
  if (whiskers?.detectionTarget !== 'whisker-presence') {
    proposalFailures.push('whisker detection target must be whisker-presence');
  }
  if (whiskers?.segmentationTarget !== 'mystacial-pad') {
    proposalFailures.push('whisker segmentation target must be mystacial-pad');
  }
  for (const field of ['presenceProbability', 'sparseness', 'confidence']) {
    if (!unit(whiskers?.[field])) proposalFailures.push(`whiskers: ${field} must be in [0, 1]`);
  }
  if (!positive(whiskers?.lengthToMuzzleWidth)) {
    proposalFailures.push('whiskers: lengthToMuzzleWidth must be positive');
  }
  if (proposalFailures.length) return report('invalid_proposal', proposalFailures);

  const truthFailures = [];
  if (proposal.sealed !== true) truthFailures.push('proposal must be sealed before truth release');
  if (truthReference?.schema !== PROCEDURAL_GROOM_TRUTH_REFERENCE_SCHEMA) {
    truthFailures.push(`expected truth reference schema ${PROCEDURAL_GROOM_TRUTH_REFERENCE_SCHEMA}`);
  }
  if (truthReference?.fixtureId !== observation.fixtureId) truthFailures.push('truth fixtureId mismatch');
  if (typeof truthReference?.manifestPath !== 'string' || !truthReference.manifestPath) {
    truthFailures.push('truth manifestPath must be nonempty');
  }
  if (!SHA256.test(truthReference?.manifestSha256 ?? '')) truthFailures.push('truth manifestSha256 must be sha256');
  if (truthReference?.releasedAfterProposalDigest !== proposal.proposalDigest) {
    truthFailures.push('truth release is not bound to the sealed proposal digest');
  }
  if (truthFailures.length) return report('premature_truth_release', truthFailures);

  return report('estimation_ready_for_comparison');
}
