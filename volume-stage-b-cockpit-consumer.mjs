const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const MANIFEST_SCHEMA = 'kaminos.pyro-cockpit-manifest.v0';
const ACCEPTANCE_SCHEMA = 'kaminos.pyro-cockpit-manifest-acceptance.v0';
const TREATMENT_IDENTITY = 'matched-optical-recurrence-v0';
const MISSING_REASON = 'stage-b-resources-missing';
const INCOMPLETE_REASON = 'stage-b-resources-incomplete';
const PROVISIONAL_AUTHORITY = 'producer-evidence-unverified';
const PROVISIONAL_SCOPE = 'operator-exploration-only';
const ACCEPTED_AUTHORITY = 'producer-evidence-accepted';
const ACCEPTED_SCOPE = 'operator-exploration-pending';
const PRESENTATION_BASELINE = '0859abf8d5b06359e4d2708f5b597c327b43c4af';
const WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
const RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const REQUIRED_LOCKED_AXES = Object.freeze([
  'support',
  'candidate-membership',
  'candidate-count',
  'positions',
  'covariance',
  'radius',
  'sharpness',
  'coefficients',
  'learned-attributes',
  'authored-layers',
  'simulator-state',
  'raymarch-target',
  'camera-orbit',
]);
const REQUIRED_VIEW_SOCKETS = Object.freeze([
  'target',
  'treatment',
  'difference',
  'ridge',
  'nonRidge',
  'combined',
  'debug',
]);

export const STAGE_B_COCKPIT_CONSUMER = Object.freeze({
  schema: MANIFEST_SCHEMA,
  identity: TREATMENT_IDENTITY,
  disabledReason: MISSING_REASON,
  provisionalAuthority: PROVISIONAL_AUTHORITY,
  provisionalScope: PROVISIONAL_SCOPE,
  acceptedAuthority: ACCEPTED_AUTHORITY,
  acceptedScope: ACCEPTED_SCOPE,
  producerContractCommit: '2a229b80',
  accumulationIdentity: 'depth-binned-emission-optical-depth-v0',
  transportIdentity: 'depth-binned-exponential-self-transmittance-v0',
  presentationIdentity: 'raymarch-matched-exponential-power-grade-v0',
  depthBins: 16,
  requiredLockedAxes: REQUIRED_LOCKED_AXES,
  requiredViewSockets: REQUIRED_VIEW_SOCKETS,
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function check(failures, condition, identity) {
  if (!condition) failures.push(identity);
}

function validateSource(source, failures) {
  check(failures, isObject(source), 'source-identity-missing');
  if (!isObject(source)) return;
  check(failures, GIT_COMMIT.test(source.commit || ''), 'source-commit-invalid');
  check(failures, source.presentationBaselineCommit === PRESENTATION_BASELINE, 'presentation-baseline-substitution');
  check(failures, /^filament-orbit-f\d+-s\d+$/.test(source.sameStateCaptureId || ''), 'same-state-capture-invalid');
  for (const field of [
    'controlsSha256',
    'candidatePayloadSha256',
    'supportSha256',
    'coefficientSha256',
    'covarianceSha256',
    'fluidSha256',
    'frontSha256',
  ]) check(failures, SHA256.test(source[field] || ''), `source-hash-invalid:${field}`);
  check(failures, Number.isInteger(source.candidateCount) && source.candidateCount > 0, 'source-candidate-count-invalid');
}

function validateArtifact(artifact, failures) {
  check(failures, isObject(artifact), 'artifact-invalid');
  if (!isObject(artifact)) return;
  check(failures, typeof artifact.id === 'string' && artifact.id.length > 0, 'artifact-id-missing');
  check(failures, typeof artifact.path === 'string' && artifact.path.length > 0, `artifact-path-missing:${artifact.id || 'unknown'}`);
  check(failures, Number.isInteger(artifact.bytes) && artifact.bytes > 0, `artifact-bytes-invalid:${artifact.id || 'unknown'}`);
  check(failures, SHA256.test(artifact.sha256 || ''), `artifact-hash-invalid:${artifact.id || 'unknown'}`);
  check(failures, typeof artifact.mediaType === 'string' && artifact.mediaType.length > 0, `artifact-media-type-missing:${artifact.id || 'unknown'}`);
  check(failures, typeof artifact.loadRoute === 'string' && artifact.loadRoute.length > 0, `artifact-load-route-missing:${artifact.id || 'unknown'}`);
}

function validateManifest(manifest) {
  const failures = [];
  check(failures, isObject(manifest), 'manifest-missing');
  if (!isObject(manifest)) return failures;
  check(failures, manifest.schema === MANIFEST_SCHEMA, 'manifest-schema-mismatch');
  check(failures, manifest.status === 'complete', 'manifest-partial');
  check(failures, manifest.evidenceState === 'produced', 'producer-evidence-state-invalid');
  check(failures, manifest.visualQuality === 'operator-unseen', 'visual-quality-overclaim');
  check(failures, manifest.experiment?.identity === 'matched-splat-optical-recurrence-parity-v0', 'experiment-identity-mismatch');
  check(failures, manifest.experiment?.originalWitnessImmutable === true, 'experiment-original-witness-mutable');
  check(failures, manifest.producer?.identity === 'radiance-transfer-producer-v0', 'producer-identity-mismatch');
  validateSource(manifest.source, failures);

  check(failures, manifest.identities?.treatment === TREATMENT_IDENTITY, 'treatment-identity-mismatch');
  check(failures, manifest.identities?.accumulation === STAGE_B_COCKPIT_CONSUMER.accumulationIdentity, 'accumulation-identity-mismatch');
  check(failures, manifest.identities?.transport === STAGE_B_COCKPIT_CONSUMER.transportIdentity, 'transport-identity-mismatch');
  check(failures, manifest.identities?.presentation === STAGE_B_COCKPIT_CONSUMER.presentationIdentity, 'presentation-identity-mismatch');
  check(failures, manifest.identities?.support === `sha256:${manifest.source?.supportSha256}`, 'support-identity-substitution');
  check(failures, manifest.identities?.coefficient === `sha256:${manifest.source?.coefficientSha256}`, 'coefficient-identity-substitution');
  check(failures, manifest.identities?.covariance === `sha256:${manifest.source?.covarianceSha256}`, 'covariance-identity-substitution');

  check(failures, Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 2, 'artifacts-incomplete');
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  artifacts.forEach(artifact => validateArtifact(artifact, failures));
  const artifactMap = new Map(artifacts.map(artifact => [artifact?.id, artifact]));
  check(failures, artifactMap.size === artifacts.length, 'artifact-role-duplicate');
  check(failures, artifactMap.has('original-presentation'), 'artifact-role-missing:original-presentation');
  check(failures, artifactMap.has('matched-optical'), 'artifact-role-missing:matched-optical');
  check(failures, artifactMap.get('original-presentation')?.loadRoute === 'matched-presentation-v0', 'artifact-route-substitution:original-presentation');
  check(failures, artifactMap.get('matched-optical')?.loadRoute === TREATMENT_IDENTITY, 'artifact-route-substitution:matched-optical');

  check(failures, manifest.routes?.requested === '/volume-selective-head-live.html', 'requested-renderer-route-substitution');
  check(failures, manifest.routes?.effectiveWrapper === WRAPPER_ROUTE, 'effective-wrapper-route-substitution');
  check(failures, manifest.routes?.effectiveRenderer === RENDERER_ROUTE, 'effective-renderer-route-substitution');
  check(failures, manifest.routes?.loadAction === 'load-cockpit-manifest-v0', 'manifest-load-action-substitution');
  check(failures, manifest.renderer?.fallbackReason === null, 'renderer-fallback');
  check(failures, /^WebGPU/.test(manifest.renderer?.backend || ''), 'renderer-backend-substitution');
  check(failures, manifest.renderer?.composition === 'splat-only-v0', 'renderer-composition-substitution');
  check(failures, manifest.renderer?.targetFormat === 'rgba16float-array', 'renderer-target-format-substitution');
  check(failures, manifest.renderer?.layerFormat === 'rgba16float', 'renderer-layer-format-substitution');
  check(failures, manifest.renderer?.depthBins?.requested === 16, 'requested-depth-bins-substitution');
  check(failures, manifest.renderer?.depthBins?.effective === 16, 'effective-depth-bins-substitution');
  check(failures, manifest.renderer?.depthBins?.intervalIdentity === 'projected-ndc-zero-to-one-depth-interval-v0', 'depth-interval-substitution');
  check(failures, manifest.renderer?.depthBins?.orderingIdentity === 'far-to-near-alpha-over-v0', 'depth-ordering-substitution');
  check(failures, manifest.renderer?.depthBins?.alphaIdentity === 'one-minus-exp-negative-summed-optical-depth-v0', 'depth-alpha-substitution');

  check(failures, manifest.capacity?.candidateCount === manifest.source?.candidateCount, 'capacity-candidate-count-substitution');
  check(failures, Number.isInteger(manifest.capacity?.capacity) && manifest.capacity.capacity >= manifest.source?.candidateCount, 'capacity-insufficient');
  check(failures, manifest.capacity?.overflowCount === 0, 'capacity-overflow');
  check(failures, SHA256.test(manifest.controls?.requestedSha256 || ''), 'requested-controls-hash-invalid');
  check(failures, manifest.controls?.effectiveSha256 === manifest.controls?.requestedSha256, 'controls-substitution');
  check(failures, manifest.controls?.requestedSha256 === manifest.source?.controlsSha256, 'source-controls-substitution');
  check(failures, Array.isArray(manifest.controls?.locked), 'locked-axes-invalid');
  for (const axis of REQUIRED_LOCKED_AXES) {
    check(failures, Array.isArray(manifest.controls?.locked) && manifest.controls.locked.includes(axis), `locked-axis-missing:${axis}`);
  }
  check(failures, Array.isArray(manifest.controls?.mutable), 'mutable-axes-missing');

  check(failures, manifest.camera?.orbitIdentity === 'filament-orbit-21-camera-v0', 'camera-orbit-substitution');
  check(failures, manifest.camera?.cameraCount === 21, 'camera-count-substitution');
  check(failures, manifest.camera?.poseHashes?.length === 21, 'camera-pose-cohort-incomplete');
  for (const poseHash of manifest.camera?.poseHashes || []) check(failures, SHA256.test(poseHash || ''), 'camera-pose-hash-invalid');
  check(failures, manifest.state?.sameStateCaptureId === manifest.source?.sameStateCaptureId, 'state-identity-substitution');
  check(failures, manifest.state?.fluidSha256 === manifest.source?.fluidSha256, 'fluid-state-substitution');
  check(failures, manifest.state?.frontSha256 === manifest.source?.frontSha256, 'front-state-substitution');
  check(failures, manifest.state?.historyIdentity === 'frozen-no-history-advance-v0', 'history-authority-substitution');
  check(failures, Boolean(manifest.timing?.authority), 'timing-authority-missing');
  check(failures, Boolean(manifest.timing?.status), 'timing-status-missing');
  for (const socket of REQUIRED_VIEW_SOCKETS) check(failures, Boolean(manifest.viewSockets?.[socket]), `view-socket-missing:${socket}`);
  check(failures, manifest.authoredFork?.originalWitnessImmutable === true, 'original-witness-mutable');
  check(failures, manifest.authoredFork?.writeMode === 'create-new', 'authored-fork-write-mode-invalid');
  check(failures, typeof manifest.authoredFork?.outputPath === 'string' && manifest.authoredFork.outputPath.length > 0, 'authored-fork-output-missing');
  return failures;
}

function emptyPassReceipt() {
  return {
    requested: ['manifest-validation', 'resource-binding', 'resource-load-verification'],
    applied: [],
    rendererRequested: false,
    rendererEncoded: false,
    rendererApplied: false,
    producerMediaRequested: false,
    producerMediaApplied: false,
  };
}

function validateAcceptance(input, manifest) {
  const supplied = Boolean(
    input.requestedAcceptanceUrl
    || input.requestedAcceptanceSha256
    || input.effectiveAcceptanceUrl
    || input.effectiveAcceptanceSha256
    || input.acceptanceReceipt
  );
  if (!supplied) return { supplied: false, failures: [] };

  const failures = [];
  check(failures, typeof input.requestedAcceptanceUrl === 'string' && input.requestedAcceptanceUrl.length > 0, 'requested-acceptance-url-missing');
  check(failures, SHA256.test(input.requestedAcceptanceSha256 || ''), 'requested-acceptance-hash-invalid');
  check(failures, input.effectiveAcceptanceUrl === input.requestedAcceptanceUrl, 'acceptance-route-substitution');
  check(failures, input.effectiveAcceptanceSha256 === input.requestedAcceptanceSha256, 'acceptance-hash-substitution');
  const receipt = input.acceptanceReceipt;
  check(failures, isObject(receipt), 'acceptance-receipt-missing');
  if (isObject(receipt)) {
    check(failures, receipt.schema === ACCEPTANCE_SCHEMA, 'acceptance-schema-mismatch');
    check(failures, receipt.status === 'accepted', 'acceptance-status-invalid');
    check(failures, receipt.manifestSha256 === input.effectiveManifestSha256, 'acceptance-manifest-hash-substitution');
    check(failures, receipt.manifestSourceCommit === manifest?.source?.commit, 'acceptance-source-commit-substitution');
    check(failures, receipt.acceptedBy === 'pyro-radiance-transfer-bailiff', 'acceptance-custodian-substitution');
    check(failures, GIT_COMMIT.test(receipt.acceptanceHead || ''), 'acceptance-head-invalid');
    check(failures, SHA256.test(receipt.acceptanceReportSha256 || ''), 'acceptance-report-hash-invalid');
    check(failures, receipt.evidenceAuthority === ACCEPTED_AUTHORITY, 'acceptance-authority-substitution');
    check(failures, receipt.visualQuality === 'operator-unseen', 'acceptance-visual-quality-overclaim');
    check(failures, receipt.operatorScope === ACCEPTED_SCOPE, 'acceptance-scope-substitution');
    check(failures, receipt.decisionBearing === false, 'acceptance-decision-bearing-overclaim');
    check(failures, receipt.presentationAuthority === 'producer-capture-media-v0', 'acceptance-presentation-authority-substitution');
    check(failures, receipt.producerCaptureArtifactId === 'matched-optical', 'acceptance-producer-capture-substitution');
    check(failures, receipt.sameStateCaptureId === 'filament-orbit-f96-s96', 'acceptance-state-not-restored-state96');
    check(failures, receipt.sameStateCaptureId === manifest?.state?.sameStateCaptureId, 'acceptance-state-identity-substitution');
    const producerCapture = manifest?.artifacts?.find(artifact => artifact?.id === receipt.producerCaptureArtifactId);
    check(failures, producerCapture?.mediaType === 'video/mp4', 'acceptance-producer-capture-media-type-invalid');
    check(failures, producerCapture?.frameCount === 21, 'acceptance-producer-capture-frame-count-invalid');
  }
  return { supplied: true, failures, receipt };
}

function baseReceipt(input) {
  return {
    schema: 'kaminos.pyro.stage-b-cockpit-consumer-receipt.v0',
    status: 'failed',
    disabledReason: null,
    requestedTreatment: input.requestedTreatment ?? null,
    effectiveTreatment: null,
    requestedManifestUrl: input.requestedManifestUrl ?? null,
    effectiveManifestUrl: null,
    requestedManifestSha256: input.requestedManifestSha256 ?? null,
    effectiveManifestSha256: null,
    acceptanceState: 'unaccepted',
    presentationAuthority: 'live-analytical-renderer-v0',
    producerCapture: null,
    requestedAcceptanceUrl: input.requestedAcceptanceUrl ?? null,
    effectiveAcceptanceUrl: null,
    requestedAcceptanceSha256: input.requestedAcceptanceSha256 ?? null,
    effectiveAcceptanceSha256: null,
    fallbackUsed: false,
    resourceState: 'missing',
    authority: null,
    viewSockets: null,
    authoredFork: null,
    resources: [],
    passes: emptyPassReceipt(),
    failures: [],
  };
}

export function admitStageBCockpitManifest(input = {}) {
  const receipt = baseReceipt(input);
  if (!input.requestedManifestUrl && !input.manifest) {
    receipt.status = 'disabled';
    receipt.disabledReason = MISSING_REASON;
    receipt.failures = [MISSING_REASON];
    return receipt;
  }

  const failures = [];
  check(failures, input.requestedTreatment === TREATMENT_IDENTITY, 'unsupported-treatment-request');
  check(failures, typeof input.requestedManifestUrl === 'string' && input.requestedManifestUrl.length > 0, 'requested-manifest-url-missing');
  check(failures, SHA256.test(input.requestedManifestSha256 || ''), 'requested-manifest-hash-invalid');
  check(failures, input.effectiveManifestUrl === input.requestedManifestUrl, 'manifest-route-substitution');
  check(failures, input.effectiveManifestSha256 === input.requestedManifestSha256, 'manifest-hash-substitution');
  failures.push(...validateManifest(input.manifest));
  if (failures.length > 0) {
    receipt.failures = [...new Set(failures)];
    if (receipt.failures.some(failure => [
      'manifest-missing',
      'manifest-partial',
      'artifacts-incomplete',
      'artifact-role-missing:original-presentation',
      'artifact-role-missing:matched-optical',
    ].includes(failure))) {
      receipt.status = 'disabled';
      receipt.disabledReason = INCOMPLETE_REASON;
      receipt.resourceState = 'incomplete';
    }
    return receipt;
  }

  const manifestUrl = new URL(input.effectiveManifestUrl);
  const loadMap = new Map((Array.isArray(input.resourceLoadReceipts) ? input.resourceLoadReceipts : [])
    .map(load => [load?.id, load]));
  check(failures, loadMap.size === input.manifest.artifacts.length, 'stage-b-resource-load-incomplete');
  const resources = input.manifest.artifacts.map(artifact => {
    const effectiveUrl = new URL(artifact.path, manifestUrl);
    check(failures, effectiveUrl.origin === manifestUrl.origin, `cross-origin-artifact-route:${artifact.id}`);
    const load = loadMap.get(artifact.id);
    check(failures, Boolean(load), `stage-b-resource-load-missing:${artifact.id}`);
    check(failures, load?.status === 'loaded', `stage-b-resource-load-failed:${artifact.id}`);
    check(failures, load?.requestedUrl === effectiveUrl.href && load?.effectiveUrl === effectiveUrl.href, `stage-b-resource-route-substitution:${artifact.id}`);
    check(failures, load?.requestedSha256 === artifact.sha256 && load?.effectiveSha256 === artifact.sha256, `stage-b-resource-hash-substitution:${artifact.id}`);
    check(failures, load?.requestedBytes === artifact.bytes && load?.effectiveBytes === artifact.bytes, `stage-b-resource-byte-length-substitution:${artifact.id}`);
    check(failures, load?.fallbackUsed === false, `stage-b-resource-fallback:${artifact.id}`);
    return {
      id: artifact.id,
      path: artifact.path,
      mediaType: artifact.mediaType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      requestedUrl: effectiveUrl.href,
      effectiveUrl: effectiveUrl.href,
      requestedRoute: artifact.loadRoute,
      effectiveRoute: artifact.loadRoute,
      loadStatus: load?.status || 'missing',
      loadFallbackUsed: load?.fallbackUsed ?? null,
    };
  });

  if (failures.length > 0) {
    receipt.failures = [...new Set(failures)];
    receipt.resourceState = 'incomplete';
    const incomplete = receipt.failures.some(failure => failure === 'stage-b-resource-load-incomplete'
      || failure.startsWith('stage-b-resource-load-missing:')
      || failure.startsWith('stage-b-resource-load-failed:'));
    if (incomplete) {
      receipt.status = 'disabled';
      receipt.disabledReason = INCOMPLETE_REASON;
    }
    return receipt;
  }

  const acceptance = validateAcceptance(input, input.manifest);
  if (acceptance.failures.length > 0) {
    receipt.failures = [...new Set(acceptance.failures)];
    return receipt;
  }

  receipt.status = 'effective';
  receipt.resourceState = 'complete';
  receipt.effectiveTreatment = TREATMENT_IDENTITY;
  receipt.effectiveManifestUrl = input.effectiveManifestUrl;
  receipt.effectiveManifestSha256 = input.effectiveManifestSha256;
  receipt.authority = {
    producer: input.manifest.producer.identity,
    sourceCommit: input.manifest.source.commit,
    requestedRoute: input.manifest.routes.requested,
    effectiveWrapperRoute: input.manifest.routes.effectiveWrapper,
    effectiveRendererRoute: input.manifest.routes.effectiveRenderer,
    backend: input.manifest.renderer.backend,
    fallbackReason: input.manifest.renderer.fallbackReason,
    candidateCount: input.manifest.capacity.candidateCount,
    capacity: input.manifest.capacity.capacity,
    overflowCount: input.manifest.capacity.overflowCount,
    lockedAxes: [...input.manifest.controls.locked],
    mutableAxes: [...input.manifest.controls.mutable],
    evidenceAuthority: acceptance.supplied ? ACCEPTED_AUTHORITY : PROVISIONAL_AUTHORITY,
    visualQuality: input.manifest.visualQuality,
    operatorScope: acceptance.supplied ? ACCEPTED_SCOPE : PROVISIONAL_SCOPE,
    decisionBearing: false,
    acceptanceCustodian: 'pyro-radiance-transfer-bailiff',
    acceptanceHead: acceptance.receipt?.acceptanceHead ?? null,
    acceptanceReportSha256: acceptance.receipt?.acceptanceReportSha256 ?? null,
  };
  receipt.viewSockets = structuredClone(input.manifest.viewSockets);
  receipt.authoredFork = structuredClone(input.manifest.authoredFork);
  receipt.resources = resources;
  receipt.passes.applied = ['manifest-validation', 'resource-binding', 'resource-load-verification'];
  if (acceptance.supplied) {
    receipt.acceptanceState = 'accepted';
    receipt.presentationAuthority = acceptance.receipt.presentationAuthority;
    receipt.producerCapture = structuredClone(
      receipt.resources.find(resource => resource.id === acceptance.receipt.producerCaptureArtifactId),
    );
    receipt.effectiveAcceptanceUrl = input.effectiveAcceptanceUrl;
    receipt.effectiveAcceptanceSha256 = input.effectiveAcceptanceSha256;
    receipt.passes.applied.push('acceptance-validation');
  }
  return receipt;
}

export function buildStageBAuthoredFork({ name, sourceReceipt, outputPath, controls, activeView } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('authored fork name is required');
  if (sourceReceipt?.status !== 'effective') throw new Error('effective Stage B source receipt is required');
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('caller-provided output path is required');
  if (sourceReceipt.resources.some(resource => resource.path === outputPath || resource.effectiveUrl === outputPath)) {
    throw new Error('producer artifact cannot be overwritten');
  }
  if (outputPath !== sourceReceipt.authoredFork?.outputPath) throw new Error('authored fork output path substituted');
  if (!isObject(controls)) throw new Error('authored controls are required');
  if (!REQUIRED_VIEW_SOCKETS.includes(activeView) || !sourceReceipt.viewSockets?.[activeView]) {
    throw new Error('active authored view is not a producer-declared socket');
  }
  return {
    schema: 'kaminos.pyro.stage-b-authored-fork.v0',
    name: name.trim(),
    outputPath,
    writeMode: 'create-new',
    originalEvidenceImmutable: true,
    sourceManifestUrl: sourceReceipt.effectiveManifestUrl,
    sourceManifestSha256: sourceReceipt.effectiveManifestSha256,
    sourceCommit: sourceReceipt.authority.sourceCommit,
    requestedTreatment: sourceReceipt.requestedTreatment,
    effectiveTreatment: sourceReceipt.effectiveTreatment,
    activeView,
    viewSocket: sourceReceipt.viewSockets[activeView],
    controls: structuredClone(controls),
    resources: structuredClone(sourceReceipt.resources),
  };
}
