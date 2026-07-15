export const VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA = 'kaminos.native-low.vivisector-candidate-head-width32-package.v0';
export const VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY = 'native-low-vivisector-candidate-head-package-receiver-v0';
export const VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER = Object.freeze([
  'currentSource[0..16]',
  'sourceDelta[0..16]',
  'normalizedPosition[xyz]',
  'subcell[xyz]',
  'coarseLatent[0..7]',
]);

const HEX_64 = /^[0-9a-f]{64}$/i;

export async function sha256HexFromText(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateVivisectorCandidateHeadPackage(rawPackage, options = {}) {
  const failurePhase = 'vivisector-candidate-package-validation';
  const observedPackageSha256 = options.observedPackageSha256 || null;
  const requestedUrl = options.requestedUrl || null;
  let packageObject = rawPackage;
  if (typeof rawPackage === 'string') {
    try {
      packageObject = JSON.parse(rawPackage);
    } catch (error) {
      return failed(`invalid JSON package: ${error?.message || String(error)}`);
    }
  }
  const pkg = packageObject && typeof packageObject === 'object' ? packageObject : null;
  if (!pkg) return failed('missing Vivisector candidate-head package object');

  const checks = [
    [pkg.schema === VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA, `schema must be ${VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA}`],
    [pkg.authority !== 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0', 'synthetic benchmark weights are rejected for trained route'],
    [pkg.syntheticBenchmarkWeights === false, 'synthetic benchmark weights are rejected for trained route'],
    [pkg.trainedWeights === true, 'trainedWeights must be true'],
    [pkg.vivisectorTrainedWeights === true, 'vivisectorTrainedWeights must be true'],
    [pkg.learnedWeightsUsed === true, 'learnedWeightsUsed must be true for a trained package'],
    [pkg.fidelityClaim === false, 'package must not claim fidelity before runtime witness'],
    [pkg.visualClaim === false, 'package must not claim visual benefit before runtime witness'],
    [pkg.grid?.sourceLowGrid === 128, 'sourceLowGrid must be 128'],
    [pkg.grid?.receiverHighGrid === 160, 'receiverHighGrid must be 160'],
    [pkg.grid?.candidateGrid === 160, 'candidateGrid must be 160'],
    [pkg.grid?.sourceChannels === 17, 'sourceChannels must be 17'],
    [pkg.grid?.sourceDeltaChannels === 17, 'sourceDeltaChannels must be 17'],
    [pkg.runtimeShape?.candidateHeadWidth === 32, 'candidateHeadWidth must be 32'],
    [pkg.runtimeShape?.workgroupSize === 64, 'workgroupSize must be 64'],
    [pkg.runtimeShape?.inputCount === 48, 'inputCount must be 48'],
    [pkg.runtimeShape?.candidateListSource === 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0', 'candidateListSource must be real uncapped fixed-gate sourceHistoryCandidates'],
    [pkg.runtimeShape?.dispatchMode === 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0', 'dispatchMode must be dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0'],
    [pkg.inputSchema?.currentSourceChannels === 17, 'currentSourceChannels must be 17'],
    [pkg.inputSchema?.sourceDeltaChannels === 17, 'sourceDeltaChannels must be 17'],
    [pkg.inputSchema?.normalizedPositionAndSubcell === true, 'normalizedPositionAndSubcell must be true'],
    [pkg.inputSchema?.coarseLatentChannels === 8, 'coarseLatentChannels must be 8'],
    [pkg.inputSchema?.coarseLatentAuthority !== 'deterministic-synthetic-coarse-latent-v0', 'synthetic benchmark latent is rejected for trained route'],
    [sameArray(pkg.inputSchema?.featureOrder, VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER), `featureOrder must be ${VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER.join(' -> ')}`],
    [pkg.outputSchema?.identity === 'compact-renderer-facing-cue-record-v0', 'outputSchema.identity must be compact-renderer-facing-cue-record-v0'],
    [pkg.outputSchema?.cueRecordStrideBytes === 32, 'cueRecordStrideBytes must be 32'],
    [pkg.outputSchema?.outputChannels === 8, 'outputChannels must be 8'],
    [pkg.outputSchema?.cueRecordVec4Count === 2, 'cueRecordVec4Count must be 2'],
    [HEX_64.test(pkg.checksums?.weightsSha256 || ''), 'checksums.weightsSha256 must be a sha256 hex string'],
    [HEX_64.test(pkg.model?.sha256 || ''), 'model.sha256 must be a sha256 hex string'],
  ];
  if (observedPackageSha256 && pkg.checksums?.packageSha256) {
    checks.push([pkg.checksums.packageSha256 === observedPackageSha256, 'checksums.packageSha256 must match fetched package bytes']);
  }

  for (const [ok, message] of checks) {
    if (!ok) return failed(message);
  }

  const receiver = {
    identity: VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY,
    schema: VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA,
    trainedRouteRequested: true,
    packageIdentity: pkg.identity || null,
    packageUrl: requestedUrl,
    packageSha256: observedPackageSha256 || pkg.checksums?.packageSha256 || null,
    modelIdentity: pkg.model?.identity || null,
    modelSha256: pkg.model?.sha256 || null,
    weightsSha256: pkg.checksums.weightsSha256,
    sourceDiaulos: pkg.model?.sourceDiaulos || 'pyro-field-residual-vivisector',
    grid: { ...pkg.grid },
    width: 32,
    workgroupSize: 64,
    inputCount: 48,
    featureOrder: [...VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER],
    candidateListSource: pkg.runtimeShape.candidateListSource,
    dispatchMode: pkg.runtimeShape.dispatchMode,
    inputSchema: { ...pkg.inputSchema },
    outputSchema: { ...pkg.outputSchema },
    syntheticBenchmarkWeightsRejected: true,
    syntheticBenchmarkLatentRejected: true,
    realIndirectDispatchRequired: true,
    uncappedFixedGateAdmissionRequired: true,
    noJsCandidateList: true,
    noCpuReadbackProductionPath: true,
    noDense160ReceiverMaterialization: true,
    hiddenCandidateCap: false,
    visualClaim: false,
    fidelityClaim: false,
    activeTreatmentPath: false,
    packageValidationBeforeGpuWork: true,
    gpuWorkStarted: false,
    failurePhase: null,
  };
  return { ok: true, receiver };

  function failed(error) {
    return {
      ok: false,
      failurePhase,
      error,
      report: {
        schema: 'kaminos.volume.native-low-vivisector-candidate-head-package-failure.v0',
        identity: VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY,
        status: 'failed',
        failurePhase,
        error,
        requestedUrl,
        packageSha256: observedPackageSha256,
        trainedRouteRequested: true,
        gpuWorkStarted: false,
        durableFailureReportRequired: true,
        syntheticBenchmarkWeightsRejected: true,
        syntheticBenchmarkLatentRejected: true,
        realIndirectDispatchRequired: true,
        uncappedFixedGateAdmissionRequired: true,
      },
    };
  }
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
