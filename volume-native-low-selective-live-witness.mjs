#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-selective-live-witness.v0';
const IDENTITY = 'native-low-live-witness-v0';
const ROUTE = 'native-low-live-browser-webgpu-inference-v0';
const MODEL_128 = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const MODEL_128_SHA256 = 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9';
const MODEL_96 = 'exact-basin-selective-carrier-heads-160-to-96-v0';
const MODEL_96_SHA256 = 'baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8';
const TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';
const REQUIRED_RUNTIME_BUILD_IDENTITY = 'native-low-live-research-cockpit-v1';
const WITNESS_CONTRACT_MARKERS = Object.freeze({
  transportMode: 'shared-device-gpu-buffers-no-readback-import-v0',
  requestedCalibration: 'native-low-learned-splat-calibration-v0',
  effectiveCalibration: 'native-low-learned-splat-calibration-v0',
  modelOutputMutation: false,
  nativeLowFrontTopologyAblation: 'native-low-front-topology-ablation-v0',
  nativeLowSourceHistoryDetailCandidate: 'native-low-source-history-detail-candidate-v0',
  candidateCompactionRouteMeasured: 'candidateCompactionRouteMeasured',
  candidateCount: 'candidateCount',
  sourceHistoryAvailable: 'sourceHistoryAvailable',
  nativeLowFixedSourceDeltaAdmission: 'native-low-fixed-source-delta-admission-v0',
  fixedSourceDeltaCalibrationSha256: 'c1b0c1ada36317ee634f198cd90e1ce9be5fb38a421c7e500af3f465834c16d3',
  runtimeTopK: false,
  dynamicPercentile: false,
  hiddenCandidateCap: false,
  sameSourceStepIdentity: 'same-source-step-required',
  offlineImporterUsed: false,
  nativeLowTrainedPackageRoute: {
    requestedTransferRouteId: 'native-low-transfer-160-to-128-zero-shot-v0',
    effectiveTransferRouteId: 'native-low-transfer-160-to-128-zero-shot-v0',
    candidateInstanceEquality: {
      candidateCount: 0,
      instanceCount: 0,
      overflowCount: 0,
      hiddenCandidateCap: false,
    },
  },
});
const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const requestedUrl = new URL(url);
const cockpitRequested = requestedUrl.searchParams.get('cockpit') === '1';
const requestedCockpitRole = requestedUrl.searchParams.get('cockpit_role') || 'native96Control';
const cockpitLearnedRoleRequested = cockpitRequested && requestedCockpitRole === 'selectedLearnedPackage';
const requestedTransferRoute = requestedUrl.searchParams.get('native_low_transfer_route') || (cockpitRequested
  ? 'native-low-transfer-160-to-96-deployment-grid-v0'
  : 'native-low-transfer-160-to-128-zero-shot-v0');
const expectedModelIdentity = requestedTransferRoute === 'native-low-transfer-160-to-96-deployment-grid-v0' ? MODEL_96 : MODEL_128;
const expectedModelSha256 = requestedTransferRoute === 'native-low-transfer-160-to-96-deployment-grid-v0' ? MODEL_96_SHA256 : MODEL_128_SHA256;
const expectedRuntimeBuildIdentity = String(args.get('--expected-runtime-build') || REQUIRED_RUNTIME_BUILD_IDENTITY);
const frontTopologyAblationRequested = requestedUrl.searchParams.get('front_topology_ablation') === '1';
const fixedGateDiscontinuityAssayRequested = requestedUrl.searchParams.get('fixed_gate_discontinuity_assay') === '1';
const candidateHeadBenchmarkRequested = requestedUrl.searchParams.get('candidate_head_benchmark') === '1';
const cueBufferLifecycleStressRequested = requestedUrl.searchParams.get('cue_buffer_lifecycle_stress') === '1';
const coarseSourceHistorySupportFrontRequested = requestedUrl.searchParams.get('coarse_source_history_support_front') === '1';
const sparseFrontContinuityRequested = requestedUrl.searchParams.get('sparse_front_continuity') === '1'
  || (cockpitRequested && requestedUrl.searchParams.get('sparse_front_continuity') !== '0');
const directSparseCuesRequested = requestedUrl.searchParams.get('direct_sparse_cues') === '1';
const vivisectorCandidateHeadTrainedRouteRequested = Boolean(requestedUrl.searchParams.get('vivisector_candidate_head_package'))
  || requestedUrl.searchParams.get('candidate_head_trained_route') === 'vivisector-width32';
const out = resolve(String(args.get('--out') || '/tmp/kaminos-native-low-selective-live.png'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-native-low-selective-live.json'));
const minimumContinuousSeconds = Number(args.get('--minimum-seconds') || 5);
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
let failurePhase = 'argument-validation';
let browser = null;
let socket = null;
let browserProfileDir = null;
let lastTrustworthyEvidence = {};
const witnessGitHead = gitHead();
let servedSourceBundle = null;
let cockpitInteractionAssay = null;

class CdpSocket {
  constructor(socketUrl) {
    this.socketUrl = socketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.socketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  assert.ok(minimumContinuousSeconds >= 5 && minimumContinuousSeconds <= 30, '--minimum-seconds must be within 5-30');
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  failurePhase = 'browser-launch';
  browserProfileDir = mkdtempSync(`${tmpdir()}/kaminos-native-low-live-witness-`);
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    `--user-data-dir=${browserProfileDir}`,
    '--disable-application-cache',
    '--disk-cache-size=1',
    '--media-cache-size=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    '--window-size=1500,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitForTarget(port, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Network.enable');
  await socket.call('Network.setCacheDisabled', { cacheDisabled: true });
  let effectiveUrl = cacheBustUrl(url, expectedRuntimeBuildIdentity, witnessGitHead);
  failurePhase = 'served-source-bundle-fetch';
  servedSourceBundle = await fetchServedSourceBundle(effectiveUrl, [
    'volume-native-low-selective-live.html',
    'native-low-selective-live-runtime.mjs',
    'native-low-candidate-head-package.mjs',
    'volume-core.js',
  ]);
  assert.equal(servedSourceBundle.runtimeBuildIdentityPresent, true, 'served runtime source lacks expected runtime build identity');
  effectiveUrl = addServedSourceBundleIdentity(effectiveUrl, servedSourceBundle.sha256);
  failurePhase = 'browser-navigate';
  await socket.call('Page.navigate', { url: effectiveUrl });

  failurePhase = 'route-settle';
  const settleStarted = performance.now();
  let state = null;
  while (performance.now() - settleStarted < timeoutMs) {
    state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive?.debugState?.()');
    lastTrustworthyEvidence = { routeSettle: state };
    if (state?.status === 'failed') {
      failurePhase = state?.failurePhase || failurePhase;
      throw new Error(state?.lastTrustworthyEvidence?.error || state?.failurePhase || 'native-low live route failed');
    }
    const replacement = state?.nativeLowCoarseSourceHistorySupportFrontReplacement;
    const sparseFront = state?.native96SparseFrontContinuity;
    const directSparse = state?.nativeLowDirectSparseCues;
    const workProfileReady = sparseFrontContinuityRequested
      ? cockpitRequested && !cockpitLearnedRoleRequested
        ? sparseFront?.identity === 'native96-sparse-front-continuity-v0'
          && sparseFront?.packageResident === true
          && sparseFront?.sourceHistoryAdvanced === true
          && sparseFront?.modelEvaluationEnabled === false
          && sparseFront?.hiddenCandidateCap === false
        : sparseFront?.identity === 'native96-sparse-front-continuity-v0'
        && sparseFront?.hardZeroOutsideCandidateVisuallyRejected === true
        && sparseFront?.hardMaskTreatmentClaim === false
        && sparseFront?.hiddenCandidateCap === false
        && Number(sparseFront?.uncappedCandidateCount) >= 0
        && Number(sparseFront?.totalSparseFrontContinuityGpuMs) >= 0
        && sparseFront?.sparseContinuityTreatmentRendererConsumed === true
      : coarseSourceHistorySupportFrontRequested
      ? replacement?.denseSupportFrontBypassed === true
        && state?.nativeLowInferenceWorkProfile?.supportFrontReplacementActive === true
        && state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity === 'native-low-coarse-source-history-support-front-replacement-v0'
        && state?.nativeLowInferenceWorkProfile?.residualDispatchMode === 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0'
      : state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage === 'full-grid-160^3'
        && state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity === 'native-low-support-positive-residual-dispatch-v0'
        && state?.nativeLowInferenceWorkProfile?.residualDispatchMode === 'support-positive-indirect-dispatch-args-v0';
    const headProfileReady = sparseFrontContinuityRequested
      ? cockpitRequested && !cockpitLearnedRoleRequested
        ? state?.headCostTimingAuthority === 'webgpu-timestamp-query-source-delta-only-v0'
          && state?.nativeLowHeadCostProfile?.values?.length === 2
          && Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0
          && state?.currentSourceFrameConsumption?.modelEvaluationEnabled === false
        : state?.headCostTimingAuthority === 'webgpu-timestamp-query-native96-sparse-front-continuity-v0'
        && state?.nativeLowHeadCostProfile?.values?.length === 6
        && Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0
        && Number(state?.nativeLowHeadCostProfile?.exactFrontTeacherEvalGpuMs) >= 0
        && Number(state?.nativeLowHeadCostProfile?.continuityReconstructionGpuMs) >= 0
        && Number(sparseFront?.totalSparseFrontContinuityGpuMs) >= 0
      : coarseSourceHistorySupportFrontRequested
      ? state?.headCostTimingAuthority === 'webgpu-timestamp-query-source-delta-only-v0'
        && state?.nativeLowHeadCostProfile?.values?.length === 2
        && Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0
        && Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) === 0
        && Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) === 0
        && Number(replacement?.totalSupportFrontReplacementPlusReceiverGpuMs) >= 0
      : state?.headCostTimingAuthority === 'webgpu-timestamp-query-stage-split-v0'
        && Array.isArray(state?.nativeLowHeadCostProfile?.values)
        && state?.nativeLowHeadCostProfile?.values.length === 6
        && nativeLowInferenceSumMatches(state?.nativeLowHeadCostProfile);
    const diagnosticProfilesReady = state?.nativeLowSupportTileProfile?.identity === 'native-low-support-proximal-tile-profile-v0'
      && state?.nativeLowSourceTileCandidate?.identity === 'native-low-source-proximal-tile-candidate-v0'
      && state?.nativeLowSourceTileCandidate?.hiddenSupportCap === false;
    if (
      state?.routeIdentity === ROUTE
      && state?.runtimeBuildIdentity === expectedRuntimeBuildIdentity
      && state?.status === 'running'
      && state?.frameIndex >= 1
      && state?.modelIdentity === expectedModelIdentity
      && state?.modelSha256 === expectedModelSha256
      && state?.requestedComposition === 'splat-only-v0'
      && state?.effectiveComposition === 'splat-only-v0'
      && state?.requestedCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.effectiveCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.modelOutputMutation === false
      && state?.requestedBackend === 'WebGPU'
      && isWebGpuBackend(state?.effectiveBackend)
      && state?.fallbackBackend === null
      && state?.transportMode === TRANSPORT_MODE
      && (!directSparseCuesRequested || state?.simulationClockAuthority === 'fixed-one-sim-step-per-presented-frame-v0')
      && state?.runtimeTruthAvailable === false
      && state?.syntheticDownsampleApplied === false
      && state?.sameNativeStateIdentity
      && !state?.sourceStepDrift
      && !state?.controlTreatmentCausalDivergence
      && Number(state?.supportPositiveCount) >= 0
      && Number(state?.treatmentSplatInstanceCount) >= 0
      && Number(state?.calibrationGain) >= 0
      && Number(state?.treatmentSplatRadianceGain) >= 0
      && Number(state?.treatmentSplatOpacityGain) >= 0
      && state?.nativeLowMaterializationProfile?.hiddenSupportCap === false
      && Number(state?.nativeLowMaterializationProfile?.treatmentRebuildMs) >= 0
      && Number(state?.nativeLowMaterializationProfile?.restoreCopyMs) >= 0
      && workProfileReady
      && (sparseFrontContinuityRequested || (
        state?.nativeLowInferenceWorkProfile?.supportCompactionActive === true
        && state?.nativeLowInferenceWorkProfile?.residualDispatchArgsFinalized === true
        && state?.nativeLowInferenceWorkProfile?.residualDispatchIndirect === true
        && state?.nativeLowInferenceWorkProfile?.residualDispatchFullGridEarlyReturn === false
        && state?.nativeLowInferenceWorkProfile?.hiddenSupportCap === false
        && Number(state?.nativeLowInferenceWorkProfile?.modelEvaluatedCellCount) >= 0
        && Number(state?.nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount) >= 0
        && Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount) >= 0
        && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups) >= 1
        && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchThreadCount) >= Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount)
      ))
      && state?.nativeLowHeadCostProfile?.identity === 'native-low-head-cost-profile-v0'
      && headProfileReady
      && diagnosticProfilesReady
      && Number(state?.nativeLowSupportTileProfile?.activeTileCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.projectedSupportFrontCellCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.tileProfileReadbackMs) >= 0
      && Number(state?.nativeLowSourceTileCandidate?.candidateTileCount) >= 0
      && Number(state?.nativeLowSourceTileCandidate?.projectedCandidateCellCount) >= 0
      && Number(state?.nativeLowSourceTileCandidate?.supportMissRate) >= 0
      && state?.nativeLowProductionStageLedger?.identity === 'native-low-production-stage-ledger-v0'
      && state?.nativeLowProductionStageLedger?.frozenDenseRouteControl?.retained === true
      && Number(state?.nativeLowProductionStageLedger?.denseReceiverWriteBytes) > 0
      && state?.nativeLowProductionStageLedger?.debugManifestTransportExcluded?.excluded === true
      && state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status === (directSparseCuesRequested
        ? 'receiver-copy-bypass-implemented'
        : 'projection-not-implemented')
      && (!directSparseCuesRequested || (
        directSparse?.identity === 'native-low-gpu-resident-splat-materialization-bypass-v0'
        && directSparse?.directRendererConsumed === true
        && directSparse?.productionPathCpuReadback === false
        && typeof directSparse?.diagnosticTelemetryReadbackThisFrame === 'boolean'
        && directSparse?.diagnosticTelemetryAuthority === 'periodic-32-byte-count-readback-not-production-path-v0'
        && directSparse?.fullGridReceiverMaterialization === false
        && directSparse?.receiverCopyBytes === 0
        && directSparse?.fullGridSidecarIntermediary === true
        && directSparse?.directModelCueEmission === false
        && directSparse?.fusedSparseModelOutput === false
        && Number(directSparse?.directSparseCandidateCount) >= 0
        && Number(directSparse?.directSparseInstanceCount) >= 0
        && Number(directSparse?.directSparseOverflowCount) === 0
        && Number(directSparse?.directSparseCapacity) >= Number(directSparse?.directSparseInstanceCount)
      ))
      && state?.nativeLowBreakEvenBudgetLedger?.identity === 'native-low-learned-transfer-break-even-ledger-v0'
      && Number(state?.nativeLowBreakEvenBudgetLedger?.outerKillBoundaryMs) === 24
      && Number(state?.nativeLowBreakEvenBudgetLedger?.credibleBreakEvenTargetMs) === 15
      && Number(state?.nativeLowBreakEvenBudgetLedger?.profitableTargetMs) === 10
      && typeof state?.nativeLowBreakEvenBudgetLedger?.skeletonPlausibleUnder24ms === 'boolean'
      && state?.nativeLowCoarseFrontSparseDetailBand?.identity === 'native-low-coarse-front-sparse-detail-band-v0'
      && Number(state?.nativeLowCoarseFrontSparseDetailBand?.coarseFrontScaffold?.spatialCorrelation) === 0.9875
      && Number(state?.nativeLowCoarseFrontSparseDetailBand?.sparseTemporalDetailBand?.top5CellEnergy) === 0.9088
      && state?.nativeLowCoarseFrontSparseDetailBand?.trueCompactCarrierDispatch?.required === true
      && state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noFull160Materialization === true
      && state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noCpuReadback === true
      && state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noJsVisibleDenseArrays === true
      && state?.nativeLowSourceHistoryDetailCandidate?.identity === 'native-low-source-history-detail-candidate-v0'
      && state?.nativeLowSourceHistoryDetailCandidate?.sourceChannelCount === 17
      && Number(state?.nativeLowSourceHistoryDetailCandidate?.targetCoverage) >= 0.09
      && Number(state?.nativeLowSourceHistoryDetailCandidate?.candidateCount) > 0
      && state?.nativeLowSourceHistoryDetailCandidate?.sourceHistoryAvailable === true
      && state?.nativeLowSourceHistoryDetailCandidate?.supportProbabilityAdmission === false
      && state?.nativeLowSourceHistoryDetailCandidate?.detailAdmissionSwitches?.supportCarrierDispatchIndependent === true
      && state?.nativeLowFixedSourceDeltaAdmission?.identity === 'native-low-fixed-source-delta-admission-v0'
      && state?.nativeLowFixedSourceDeltaAdmission?.fixedSourceDeltaCalibrationSha256 === 'c1b0c1ada36317ee634f198cd90e1ce9be5fb38a421c7e500af3f465834c16d3'
      && Number(state?.nativeLowFixedSourceDeltaAdmission?.sourceDeltaThreshold) > 0.545
      && state?.nativeLowFixedSourceDeltaAdmission?.runtimeTopK === false
      && state?.nativeLowFixedSourceDeltaAdmission?.dynamicPercentile === false
      && state?.nativeLowFixedSourceDeltaAdmission?.hiddenCandidateCap === false
      && state?.nativeLowFixedSourceDeltaAdmission?.sourceHistoryStatsReadbackAuthority === 'diagnostic-only-not-production-candidate-path-v0'
      && state?.nativeLowFixedSourceDeltaAdmission?.productionCandidateNoCpuReadback === true
      && Number(state?.nativeLowFixedSourceDeltaAdmission?.uncappedCandidateCount) >= 0
      && (!frontTopologyAblationRequested
        || (
          state?.nativeLowFrontTopologyAblation?.identity === 'native-low-front-topology-ablation-v0'
          && state?.nativeLowFrontTopologyAblation?.sameSourceStepIdentity
          && state?.nativeLowFrontTopologyAblation?.offlineImporterUsed === false
          && state?.nativeLowFrontTopologyAblation?.fullFrozenTreatmentReference?.learnedFrontTopologyResidualApplied === true
          && state?.nativeLowFrontTopologyAblation?.frontTopologyAblatedTreatment?.learnedFrontTopologyResidualApplied === false
          && Number(state?.frontTopologyAblatedSplatInstanceCount) >= 0
        ))
      && state?.simulationSteppingReceipt?.simStepDelta === 1
      && state?.currentSourceFrameConsumption?.encodedFrameDelta === 1
      && state?.stalePredictionRejection?.repeatedStaticPrediction === false
      && Number(state?.inferenceGpuMs) >= 0
      && Number(state?.uploadDispatchMs) >= 0
      && Number(state?.endToEndFrameMs) >= 0
      && (!cockpitRequested || (
        state?.nativeLowLiveResearchCockpit?.identity === 'native-low-live-research-cockpit-v0'
        && state?.nativeLowLiveResearchCockpit?.runUntilExplicitPause === true
        && state?.nativeLowLiveResearchCockpit?.hiddenDurationLimit === false
        && state?.nativeLowLiveResearchCockpit?.hiddenFrameLimit === false
        && state?.nativeLowLiveResearchCockpit?.directCanvasPresentation === true
        && state?.nativeLowLiveResearchCockpit?.blobImageReplacement === false
        && state?.nativeLowLiveResearchCockpit?.residentPackageSlots?.requestedPackageIdentity
        && state?.nativeLowLiveResearchCockpit?.residentPackageSlots?.effectivePackageIdentity
        && state?.nativeLowLiveResearchCockpit?.unsmoothedTiming
      ))
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'live route did not reach running state');
  assert.equal(state?.modelIdentity, expectedModelIdentity, 'wrong model identity');
  assert.equal(state?.modelSha256, expectedModelSha256, 'wrong model checksum');
  assert.equal(state?.requestedComposition, 'splat-only-v0', 'wrong requested composition');
  assert.equal(state?.effectiveComposition, 'splat-only-v0', 'requested/effective composition drift');
  assert.equal(state?.requestedCalibration, 'native-low-learned-splat-calibration-v0', 'wrong requested calibration');
  assert.equal(state?.effectiveCalibration, 'native-low-learned-splat-calibration-v0', 'wrong effective calibration');
  assert.equal(state?.modelOutputMutation, false, 'calibration mutated model outputs');
  assert.equal(state?.requestedBackend, 'WebGPU', 'wrong requested backend');
  assert.ok(isWebGpuBackend(state?.effectiveBackend), `fallback backend used: ${state?.effectiveBackend}`);
  assert.equal(state?.fallbackBackend, null, 'fallback backend evidence is not admissible');
  assert.equal(state?.transportMode, TRANSPORT_MODE, 'wrong shared-device transport mode');
  if (directSparseCuesRequested) {
    assert.equal(state?.simulationClockAuthority, 'fixed-one-sim-step-per-presented-frame-v0', 'direct sparse route retained renderer-latency-driven simulation time');
    assert.ok(Number(state?.simulationStepDeltaMs) > 0, 'direct sparse fixed simulation step is missing');
  }
  assert.equal(state?.runtimeTruthAvailable, false, 'truth authority leaked into runtime');
  assert.equal(state?.syntheticDownsampleApplied, false, 'synthetic downsample leaked into runtime');
  assert.equal(state?.sourceStepDrift, null, 'source-step drift detected');
  assert.equal(state?.controlTreatmentCausalDivergence, null, 'control/treatment causal divergence detected');
  assert.ok(Number(state?.supportPositiveCount) >= 0, 'supportPositiveCount missing');
  assert.ok(Number(state?.treatmentSplatInstanceCount) >= 0, 'treatmentSplatInstanceCount missing');
  assert.ok(Number(state?.calibrationGain) >= 0, 'calibrationGain missing');
  assert.ok(Number(state?.treatmentSplatRadianceGain) >= 0, 'treatmentSplatRadianceGain missing');
  assert.ok(Number(state?.treatmentSplatOpacityGain) >= 0, 'treatmentSplatOpacityGain missing');
  assert.equal(state?.nativeLowMaterializationProfile?.hiddenSupportCap, false, 'hidden support cap used in materialization profile');
  assert.ok(Number(state?.nativeLowMaterializationProfile?.treatmentRebuildMs) >= 0, 'treatmentRebuildMs missing');
  assert.ok(Number(state?.nativeLowMaterializationProfile?.restoreCopyMs) >= 0, 'restoreCopyMs missing');
  if (directSparseCuesRequested) {
    const directSparse = state?.nativeLowDirectSparseCues;
    assert.equal(directSparse?.identity, 'native-low-gpu-resident-splat-materialization-bypass-v0', 'direct sparse route identity missing');
    assert.equal(directSparse?.directRendererConsumed, true, 'direct sparse renderer did not consume model buffers');
    assert.equal(directSparse?.productionPathCpuReadback, false, 'direct sparse route used CPU readback');
    assert.equal(typeof directSparse?.diagnosticTelemetryReadbackThisFrame, 'boolean', 'direct sparse telemetry cadence receipt missing');
    assert.equal(directSparse?.diagnosticTelemetryAuthority, 'periodic-32-byte-count-readback-not-production-path-v0', 'direct sparse telemetry authority drifted');
    assert.equal(directSparse?.fullGridReceiverMaterialization, false, 'direct sparse route materialized the full receiver');
    assert.equal(directSparse?.receiverCopyBytes, 0, 'direct sparse route copied receiver fields');
    assert.equal(directSparse?.fullGridSidecarIntermediary, true, 'direct sparse route hid its full-grid sidecar intermediary');
    assert.equal(directSparse?.directModelCueEmission, false, 'direct sparse route impersonated direct model cue emission');
    assert.equal(directSparse?.fusedSparseModelOutput, false, 'direct sparse route impersonated fused sparse model output');
    assert.equal(Number(directSparse?.directSparseOverflowCount), 0, 'direct sparse compaction overflowed');
    assert.ok(Number(directSparse?.directSparseCapacity) >= Number(directSparse?.directSparseInstanceCount), 'direct sparse capacity is smaller than instance count');
    assert.equal(state?.nativeLowMaterializationProfile?.fullGridReceiverMaterialization, false, 'direct sparse materialization profile allowed a full receiver');
    assert.equal(state?.nativeLowMaterializationProfile?.receiverCopyBytes, 0, 'direct sparse materialization profile recorded receiver copies');
    assert.equal(state?.nativeLowMaterializationProfile?.fullGridSidecarIntermediary, true, 'direct sparse materialization profile hid the sidecar intermediary');
  }
  if (coarseSourceHistorySupportFrontRequested) {
    assert.equal(
      state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage,
      'coarse-scaffold-plus-source-history-detail-candidates-not-full-grid-160^3',
      'replacement support classifier coverage mismatch',
    );
    assert.equal(
      state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity,
      'native-low-coarse-source-history-support-front-replacement-v0',
      'wrong replacement support compaction identity',
    );
    assert.equal(
      state?.nativeLowInferenceWorkProfile?.residualDispatchMode,
      'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
      'wrong replacement residual dispatch mode',
    );
  } else if (!sparseFrontContinuityRequested) {
    assert.equal(state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage, 'full-grid-160^3', 'support classifier coverage is not full grid');
    assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity, 'native-low-support-positive-residual-dispatch-v0', 'wrong support compaction identity');
    assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchMode, 'support-positive-indirect-dispatch-args-v0', 'wrong residual dispatch mode');
  }
  if (!sparseFrontContinuityRequested) {
    assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionActive, true, 'support compaction was not active');
    assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchArgsFinalized, true, 'residual dispatch args were not finalized');
    assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchIndirect, true, 'residual dispatch did not use indirect args');
    assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchFullGridEarlyReturn, false, 'residual dispatch still used full-grid early return');
    assert.equal(state?.nativeLowInferenceWorkProfile?.hiddenSupportCap, false, 'hidden support cap used in inference profile');
    assert.ok(Number(state?.nativeLowInferenceWorkProfile?.modelEvaluatedCellCount) >= 0, 'modelEvaluatedCellCount missing');
    assert.ok(Number(state?.nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount) >= 0, 'residualHeadEvaluatedCount missing');
    assert.ok(Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount) >= 0, 'supportCompactedCount missing');
    assert.ok(Number(state?.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups) >= 1, 'residualDispatchWorkgroups missing');
    assert.ok(
      Number(state?.nativeLowInferenceWorkProfile?.residualDispatchThreadCount) >= Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount),
      'residual dispatch thread count does not cover compacted support',
    );
  }
  assert.equal(state?.nativeLowHeadCostProfile?.identity, 'native-low-head-cost-profile-v0', 'head cost profile missing');
  if (coarseSourceHistorySupportFrontRequested) {
    const replacement = state?.nativeLowCoarseSourceHistorySupportFrontReplacement;
    assert.equal(state?.headCostTimingAuthority, 'webgpu-timestamp-query-source-delta-only-v0', 'wrong replacement timing authority');
    assert.equal(replacement?.identity, 'native-low-coarse-source-history-support-front-replacement-v0', 'support/front replacement receipt missing');
    assert.equal(replacement?.denseSupportFrontBypassed, true, 'dense support/front was not bypassed');
    assert.equal(replacement?.denseRouteRetainedAsControl, true, 'dense route control was not retained');
    assert.equal(replacement?.hiddenCandidateCap, false, 'replacement hid a candidate cap');
    assert.equal(replacement?.fullGridReceiverMaterialization, false, 'replacement materialized a full-grid receiver');
    assert.equal(replacement?.productionPathCpuReadback, false, 'replacement production path used CPU readback');
    assert.equal(replacement?.candidateInstanceEquality, true, 'replacement candidate/instance equality failed');
    assert.equal(replacement?.overflowCount, 0, 'replacement overflowed compact cue records');
    assert.equal(replacement?.syntheticBenchmarkWeights, false, 'replacement used synthetic benchmark weights as authority');
    assert.equal(replacement?.syntheticBenchmarkAuthorityRejected, true, 'replacement did not reject synthetic benchmark authority');
    assert.equal(replacement?.learnedVisualClaim, false, 'replacement made a visual claim before renderer consumption');
    assert.equal(replacement?.wrongPackageRouteBackendRejected, true, 'replacement package/route/backend rejection receipt missing');
    assert.ok(Number(replacement?.sourceDeltaAdmissionGpuMs) >= 0, 'replacement source-delta timing missing');
    assert.ok(Number(replacement?.vivisectorWidth32ReceiverGpuMs) >= 0, 'replacement receiver timing missing');
    assert.ok(Number(replacement?.totalSupportFrontReplacementPlusReceiverGpuMs) >= 0, 'replacement total timing missing');
    assert.equal(Number(replacement?.denseSupportFrontControlGpuMs), 660.834167, 'dense support/front control timing missing');
    assert.equal(Number(replacement?.supportFrontReplacementDecisionBands?.profitableTargetMs), 10, 'replacement profitable target missing');
    assert.equal(Number(replacement?.supportFrontReplacementDecisionBands?.credibleBreakEvenTargetMs), 15, 'replacement credible target missing');
    assert.equal(Number(replacement?.supportFrontReplacementDecisionBands?.outerKillBoundaryMs), 24, 'replacement kill boundary missing');
    assert.equal(state?.nativeLowMaterializationProfile?.fullGridReceiverMaterialization, false, 'replacement materialization profile allowed full-grid receiver');
  } else if (sparseFrontContinuityRequested) {
    const sparseFront = state?.native96SparseFrontContinuity;
    assert.equal(
      state?.headCostTimingAuthority,
      cockpitRequested && !cockpitLearnedRoleRequested ? 'webgpu-timestamp-query-source-delta-only-v0' : 'webgpu-timestamp-query-native96-sparse-front-continuity-v0',
      'wrong sparse-front timing authority',
    );
    assert.equal(sparseFront?.identity, 'native96-sparse-front-continuity-v0', 'sparse-front continuity receipt missing');
    assert.equal(sparseFront?.hiddenCandidateCap, false, 'sparse-front route hid a candidate cap');
    assert.ok(Number(sparseFront?.uncappedCandidateCount) >= 0, 'sparse-front uncapped candidate count missing');
    if (cockpitRequested && !cockpitLearnedRoleRequested) {
      assert.equal(sparseFront?.packageResident, true, 'cockpit package was not resident during history-only role');
      assert.equal(sparseFront?.sourceHistoryAdvanced, true, 'cockpit source history did not advance during history-only role');
      assert.equal(sparseFront?.modelEvaluationEnabled, false, 'cockpit history-only role evaluated the learned model');
      assert.equal(sparseFront?.modelOutputConsumed, false, 'cockpit history-only role consumed learned output');
    } else {
      assert.equal(sparseFront?.hardZeroOutsideCandidateVisuallyRejected, true, 'sparse-front route did not preserve hard-mask rejection');
      assert.equal(sparseFront?.hardMaskTreatmentClaim, false, 'sparse-front route revived a hard-mask claim');
      assert.equal(sparseFront?.sparseContinuityTreatmentRendererConsumed, true, 'sparse-front treatment was not renderer-consumed');
      assert.ok(Number(sparseFront?.exactFrontTeacherEvalGpuMs) >= 0, 'sparse-front teacher timing missing');
      assert.ok(Number(sparseFront?.continuityReconstructionGpuMs) >= 0, 'sparse-front continuity timing missing');
      assert.ok(Number(sparseFront?.totalSparseFrontContinuityGpuMs) >= 0, 'sparse-front total timing missing');
    }
    assert.equal(Number(sparseFront?.sparseFrontContinuityDecisionBands?.profitableTargetMs), 10, 'sparse-front profitable target missing');
    assert.equal(Number(sparseFront?.sparseFrontContinuityDecisionBands?.credibleBreakEvenTargetMs), 15, 'sparse-front credible target missing');
    assert.equal(Number(sparseFront?.sparseFrontContinuityDecisionBands?.outerKillBoundaryMs), 24, 'sparse-front kill boundary missing');
  } else {
    assert.equal(state?.headCostTimingAuthority, 'webgpu-timestamp-query-stage-split-v0', 'wrong head cost timing authority');
  }
  assert.equal(state?.runtimeBuildIdentity, expectedRuntimeBuildIdentity, 'runtime build identity mismatch');
  if (cockpitRequested) {
    const cockpit = state?.nativeLowLiveResearchCockpit;
    assert.equal(cockpit?.identity, 'native-low-live-research-cockpit-v0', 'cockpit identity missing');
    assert.equal(cockpit?.runUntilExplicitPause, true, 'cockpit does not run until explicit pause');
    assert.equal(cockpit?.hiddenDurationLimit, false, 'cockpit retained a hidden duration limit');
    assert.equal(cockpit?.hiddenFrameLimit, false, 'cockpit retained a hidden frame limit');
    assert.equal(cockpit?.directCanvasPresentation, true, 'cockpit is not presenting the renderer canvas directly');
    assert.equal(cockpit?.blobImageReplacement, false, 'cockpit retained blob image replacement');
    assert.equal(cockpit?.cameraAutoRotation, false, 'cockpit camera auto-rotation is enabled');
    assert.equal(cockpit?.cameraStateStableAcrossRoleSwitch, true, 'cockpit camera state is not stable across role switches');
    assert.equal(cockpit?.noHiddenCandidateCap, true, 'cockpit hid candidate work');
    assert.equal(cockpit?.noHiddenInstanceCap, true, 'cockpit hid instance work');
    if (!directSparseCuesRequested) {
      failurePhase = 'cockpit-interaction-assay';
      cockpitInteractionAssay = await evaluate(socket, `(() => {
      const api = window.__kaminosNativeLowSelectiveLive;
      const before = api.debugState();
      const bypassSwitch = api.setCockpitRole('modelBypass');
      const nativeSwitch = api.setCockpitRole('native96Control');
      const radiusControl = api.setEmitterRadius(0.61);
      const flowControl = api.setFlowRate(1.2);
      const discontinuity = api.triggerRadiusDiscontinuity();
      const packageSlotB = api.setPackageSlot('B');
      const restoreRequestedRole = api.setCockpitRole(${JSON.stringify(requestedCockpitRole)});
      const after = api.debugState();
      return { before, bypassSwitch, nativeSwitch, radiusControl, flowControl, discontinuity, packageSlotB, restoreRequestedRole, after };
    })()`);
      assert.equal(cockpitInteractionAssay?.bypassSwitch?.roleSwitchSourceStepDelta, 0, 'bypass role switch advanced source history');
      assert.equal(cockpitInteractionAssay?.bypassSwitch?.roleSwitchHistoryEpochChanged, false, 'bypass role switch changed history epoch');
      assert.equal(cockpitInteractionAssay?.nativeSwitch?.roleSwitchSourceStepDelta, 0, 'native role switch advanced source history');
      assert.equal(cockpitInteractionAssay?.nativeSwitch?.roleSwitchHistoryEpochChanged, false, 'native role switch changed history epoch');
      assert.equal(cockpitInteractionAssay?.radiusControl?.controlValueMismatch, false, 'radius control was ignored or replaced');
      assert.equal(cockpitInteractionAssay?.flowControl?.controlValueMismatch, false, 'flow control was ignored or replaced');
      assert.equal(cockpitInteractionAssay?.discontinuity?.historyEpochChanged, false, 'radius discontinuity rebuilt history');
      assert.equal(cockpitInteractionAssay?.discontinuity?.simulationRebuilt, false, 'radius discontinuity rebuilt simulator');
      assert.equal(cockpitInteractionAssay?.packageSlotB?.stalePackageRejected, true, 'package slot did not reject stale package authority');
      assert.equal(cockpitInteractionAssay?.packageSlotB?.fallbackPackageRejected, true, 'package slot allowed fallback package authority');
      assert.equal(cockpitInteractionAssay?.packageSlotB?.packageChecksumMismatch, null, 'package slot checksum mismatch');
      failurePhase = 'cockpit-requested-role-restore';
      const restoreStartedAt = performance.now();
      while (performance.now() - restoreStartedAt < 60000) {
        state = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.debugState()');
        if (state?.nativeLowLiveResearchCockpit?.selectedRole === requestedCockpitRole) break;
        await delay(100);
      }
      assert.equal(state?.nativeLowLiveResearchCockpit?.selectedRole, requestedCockpitRole, 'witness did not restore the requested cockpit role');
    } else {
      cockpitInteractionAssay = {
        identity: 'native-low-cockpit-interaction-assay-deferral-v0',
        status: 'deferred-to-preserve-unperturbed-direct-route-performance-window',
        controlsMutated: false,
        roleMutated: false,
      };
    }
  }
  if (vivisectorCandidateHeadTrainedRouteRequested) {
    const receiver = state?.nativeLowVivisectorCandidateHeadPackageReceiver;
    assert.equal(receiver?.identity, 'native-low-vivisector-candidate-head-package-receiver-v0', 'Vivisector package receiver identity mismatch');
    assert.equal(receiver?.schema, 'kaminos.native-low.vivisector-candidate-head-width32-package.v0', 'Vivisector package schema mismatch');
    assert.equal(receiver?.trainedRouteRequested, true, 'Vivisector trained route was not recorded as requested');
    assert.equal(receiver?.syntheticBenchmarkWeightsRejected, true, 'Vivisector receiver did not reject synthetic benchmark weights');
    assert.equal(receiver?.syntheticBenchmarkLatentRejected, true, 'Vivisector receiver did not reject synthetic benchmark latent');
    assert.equal(receiver?.candidateListSource, 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0', 'Vivisector receiver candidate list source mismatch');
    assert.equal(receiver?.dispatchMode, 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0', 'Vivisector receiver dispatch mode mismatch');
    assert.equal(receiver?.width, 32, 'Vivisector receiver width mismatch');
    assert.equal(receiver?.outputSchema?.identity, 'compact-renderer-facing-cue-record-v0', 'Vivisector receiver cue schema mismatch');
    assert.equal(receiver?.visualClaim, false, 'Vivisector package receiver must not claim visual benefit');
    assert.equal(receiver?.fidelityClaim, false, 'Vivisector package receiver must not claim fidelity');
  }
  assert.ok(Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0, 'sourceDeltaAdmissionGpuMs missing');
  if (sparseFrontContinuityRequested) {
    if (cockpitRequested && !cockpitLearnedRoleRequested) {
      assert.equal(state?.nativeLowHeadCostProfile?.values?.length, 2, 'cockpit history-only profile did not record two timestamp values');
      assert.ok(nativeLowSourceDeltaOnlySumMatches(state?.nativeLowHeadCostProfile), 'cockpit history-only timing is not the exact source-delta sum');
    } else {
      assert.equal(state?.nativeLowHeadCostProfile?.values?.length, 6, 'sparse-front head cost profile did not record six timestamp values');
      assert.ok(
        Number(state?.nativeLowHeadCostProfile?.inferenceGpuMs) === Number(state?.nativeLowHeadCostProfile?.totalSparseFrontContinuityGpuMs),
        'sparse-front inferenceGpuMs is not the exact sparse-front total',
      );
    }
  } else if (coarseSourceHistorySupportFrontRequested) {
    assert.equal(state?.nativeLowHeadCostProfile?.values?.length, 2, 'replacement head cost profile did not record two timestamp values');
    assert.ok(nativeLowSourceDeltaOnlySumMatches(state?.nativeLowHeadCostProfile), 'replacement inferenceGpuMs is not the exact source-delta-only sum');
  } else {
    assert.equal(state?.nativeLowHeadCostProfile?.values?.length, 6, 'head cost profile did not record six timestamp values');
    assert.ok(nativeLowInferenceSumMatches(state?.nativeLowHeadCostProfile), 'inferenceGpuMs is not the exact sum of source-delta/support-front/residual stages');
  }
  if (!sparseFrontContinuityRequested) {
    assert.ok(Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) >= 0, 'supportFrontGpuMs missing');
    assert.ok(Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) >= 0, 'supportPositiveResidualGpuMs missing');
  }
  assert.equal(state?.nativeLowSupportTileProfile?.identity, 'native-low-support-proximal-tile-profile-v0', 'support-proximal tile profile missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.activeTileCount) >= 0, 'activeTileCount missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.projectedSupportFrontCellCount) >= 0, 'projectedSupportFrontCellCount missing');
  assert.ok(Number(state?.nativeLowSupportTileProfile?.tileProfileReadbackMs) >= 0, 'tileProfileReadbackMs missing');
  assert.equal(state?.nativeLowSourceTileCandidate?.identity, 'native-low-source-proximal-tile-candidate-v0', 'source-proximal tile candidate missing');
  assert.ok(Number(state?.nativeLowSourceTileCandidate?.candidateTileCount) >= 0, 'candidateTileCount missing');
  assert.ok(Number(state?.nativeLowSourceTileCandidate?.projectedCandidateCellCount) >= 0, 'projectedCandidateCellCount missing');
  assert.ok(Number(state?.nativeLowSourceTileCandidate?.supportMissRate) >= 0, 'supportMissRate missing');
  assert.equal(state?.nativeLowSourceTileCandidate?.hiddenSupportCap, false, 'source-proximal tile candidate hid a support cap');
  assert.equal(state?.nativeLowProductionStageLedger?.identity, 'native-low-production-stage-ledger-v0', 'production stage ledger missing');
  assert.equal(state?.nativeLowProductionStageLedger?.frozenDenseRouteControl?.retained, true, 'frozen dense route control missing');
  assert.ok(Number(state?.nativeLowProductionStageLedger?.denseReceiverWriteBytes) > 0, 'dense receiver write bytes missing');
  assert.equal(state?.nativeLowProductionStageLedger?.debugManifestTransportExcluded?.excluded, true, 'debug manifest transport was not excluded from live ledger');
  assert.equal(
    state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status,
    directSparseCuesRequested ? 'receiver-copy-bypass-implemented' : 'projection-not-implemented',
    'sparse receiver candidate projection status mismatch',
  );
  assert.equal(state?.nativeLowBreakEvenBudgetLedger?.identity, 'native-low-learned-transfer-break-even-ledger-v0', 'learned-transfer break-even ledger missing');
  assert.equal(Number(state?.nativeLowBreakEvenBudgetLedger?.outerKillBoundaryMs), 24, 'outer kill boundary must be 24ms');
  assert.equal(Number(state?.nativeLowBreakEvenBudgetLedger?.credibleBreakEvenTargetMs), 15, 'credible break-even target must be 15ms');
  assert.equal(Number(state?.nativeLowBreakEvenBudgetLedger?.profitableTargetMs), 10, 'profitable target must be 10ms');
  assert.equal(typeof state?.nativeLowBreakEvenBudgetLedger?.skeletonPlausibleUnder24ms, 'boolean', '24ms plausibility decision missing');
  assert.equal(state?.nativeLowCoarseFrontSparseDetailBand?.identity, 'native-low-coarse-front-sparse-detail-band-v0', 'coarse-front sparse detail-band receipt missing');
  assert.equal(Number(state?.nativeLowCoarseFrontSparseDetailBand?.coarseFrontScaffold?.spatialCorrelation), 0.9875, 'coarse front spatial correlation missing');
  assert.equal(Number(state?.nativeLowCoarseFrontSparseDetailBand?.sparseTemporalDetailBand?.consecutiveDeltaEnergyRetained), 0.1205, 'coarse front temporal-delta energy retention missing');
  assert.equal(Number(state?.nativeLowCoarseFrontSparseDetailBand?.sparseTemporalDetailBand?.top10CellEnergy), 0.97, 'temporal-detail concentration missing');
  assert.equal(state?.nativeLowCoarseFrontSparseDetailBand?.trueCompactCarrierDispatch?.required, true, 'true compact carrier dispatch is not required');
  assert.equal(state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noFull160Materialization, true, 'sparse detail-band path allowed full 160 materialization');
  assert.equal(state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noCpuReadback, true, 'sparse detail-band path allowed CPU readback');
  assert.equal(state?.nativeLowCoarseFrontSparseDetailBand?.candidatePathScope?.noJsVisibleDenseArrays, true, 'sparse detail-band path allowed JS-visible dense arrays');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.identity, 'native-low-source-history-detail-candidate-v0', 'source-history detail candidate missing');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.sourceChannelCount, 17, 'source-history candidate must use all 17 source channels');
  if (fixedGateDiscontinuityAssayRequested || cueBufferLifecycleStressRequested) {
    assert.ok(Number(state?.nativeLowSourceHistoryDetailCandidate?.candidateCoverage) >= 0, 'source-history candidate coverage missing');
  } else {
    assert.ok(Number(state?.nativeLowSourceHistoryDetailCandidate?.candidateCoverage) >= 0.09, 'source-history candidate coverage missing');
  }
  assert.equal(Number(state?.nativeLowSourceHistoryDetailCandidate?.sourceDeltaEnergyCapture), 0.8286, 'source-delta energy capture missing');
  assert.equal(Number(state?.nativeLowSourceHistoryDetailCandidate?.supportProbabilityEnergyCapture), 0.205, 'support-probability anti-evidence missing');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.supportProbabilityAdmission, false, 'support probability reused as detail admission');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.detailAdmissionSwitches?.sourceHistoryDetailAdmissionEnabled, true, 'source-history detail admission switch missing');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.detailAdmissionSwitches?.supportCarrierDispatchIndependent, true, 'detail admission is not independent of support/carrier dispatch');
  assert.equal(state?.nativeLowSourceHistoryDetailCandidate?.detailAdmissionSwitches?.coarseFrontScaffoldIndependent, true, 'detail admission is not independent of coarse front');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.identity, 'native-low-fixed-source-delta-admission-v0', 'fixed source-delta admission receipt missing');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.fixedSourceDeltaCalibrationSha256, 'c1b0c1ada36317ee634f198cd90e1ce9be5fb38a421c7e500af3f465834c16d3', 'fixed source-delta calibration checksum missing');
  assert.equal(Number(state?.nativeLowFixedSourceDeltaAdmission?.sourceDeltaThreshold).toFixed(10), '0.5457155704', 'fixed source-delta threshold drifted');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.runtimeTopK, false, 'runtime top-K used for fixed source-delta admission');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.dynamicPercentile, false, 'dynamic percentile used for fixed source-delta admission');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.hiddenCandidateCap, false, 'hidden candidate cap used for fixed source-delta admission');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.sourceHistoryStatsReadbackAuthority, 'diagnostic-only-not-production-candidate-path-v0', 'source-history stats readback is not diagnostic-only');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.productionCandidateNoCpuReadback, true, 'production candidate path lost no-CPU-readback receipt');
  assert.ok(state?.nativeLowFixedSourceDeltaAdmission?.currentHistoryEpochIdentity, 'current history epoch identity missing');
  assert.ok(Object.hasOwn(state?.nativeLowFixedSourceDeltaAdmission || {}, 'priorHistoryEpochIdentity'), 'prior history epoch identity missing');
  assert.ok(Object.hasOwn(state?.nativeLowFixedSourceDeltaAdmission || {}, 'historyEpochValidForAdmission'), 'history epoch validity missing');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.fixedSourceDeltaLongStripSha256, '7c65fc162fbf2c91e7a614ec6e0b37797d31441872d00ced3bbc325a513f8d23', 'fixed source-delta long-strip receipt missing');
  assert.equal(state?.nativeLowFixedSourceDeltaAdmission?.mohelWarningThresholdMode, 'normal-basin-coverage-mean-multiple-v0', 'Mohel warning is not calibrated to the normal-basin coverage mean');
  assert.equal(Number(state?.nativeLowFixedSourceDeltaAdmission?.mohelWarningThresholdMultiple), 1.5, 'Mohel warning threshold multiple drifted');
  assert.ok(Number(state?.nativeLowFixedSourceDeltaAdmission?.mohelWarningBoundaryCoverage) > 0, 'Mohel warning boundary coverage missing');
  assert.ok(Number(state?.nativeLowFixedSourceDeltaAdmission?.uncappedCandidateCount) >= 0, 'uncapped candidate count missing');
  assert.ok(Number(state?.nativeLowFixedSourceDeltaAdmission?.uncappedCandidateCoverage) >= 0, 'uncapped candidate coverage missing');
  if (candidateHeadBenchmarkRequested) {
    const benchmark = state?.nativeLowCandidateHeadCostMicrobenchmark || {};
    assert.equal(benchmark.identity, 'native-low-candidate-head-cost-microbenchmark-v0', 'candidate-head benchmark missing');
    assert.equal(benchmark.authority, 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0', 'candidate-head benchmark authority overclaims learned evidence');
    assert.equal(benchmark.coarseLatentAuthority, 'deterministic-synthetic-coarse-latent-v0', 'candidate-head benchmark coarse latent authority missing');
    assert.equal(benchmark.learnedWeightsUsed, false, 'candidate-head benchmark used learned weights');
    assert.equal(benchmark.fidelityClaim, false, 'candidate-head benchmark made a fidelity claim');
    assert.equal(benchmark.visualClaim, false, 'candidate-head benchmark made a visual claim');
    assert.deepEqual(benchmark.benchmarkWidths, [16, 24, 32], 'candidate-head benchmark widths drifted');
    assert.equal(benchmark.dispatchMode, 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0', 'candidate-head benchmark did not use indirect source-history dispatch args');
    assert.equal(benchmark.candidateListSource, 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0', 'candidate-head benchmark did not consume the real fixed-gate candidate list');
    assert.equal(benchmark.candidateInputs?.currentSourceChannels, 17, 'candidate-head benchmark did not read all current source channels');
    assert.equal(benchmark.candidateInputs?.sourceDeltaChannels, 17, 'candidate-head benchmark did not read all source deltas');
    assert.equal(benchmark.candidateInputs?.normalizedPositionAndSubcell, true, 'candidate-head benchmark did not read normalized position/subcell');
    assert.equal(benchmark.outputSchema?.identity, 'compact-renderer-facing-cue-record-v0', 'candidate-head benchmark output schema missing');
    assert.equal(Number(benchmark.outputSchema?.cueRecordStrideBytes), 32, 'candidate-head benchmark cue stride drifted');
    assert.equal(benchmark.pathExclusions?.noJsCandidateList, true, 'candidate-head benchmark exposed a JS candidate list');
    assert.equal(benchmark.pathExclusions?.productionPathCpuReadback, false, 'candidate-head benchmark added CPU readback to production path');
    assert.equal(benchmark.pathExclusions?.dense160ReceiverMaterialization, false, 'candidate-head benchmark materialized a dense 160 receiver');
    assert.equal(benchmark.pathExclusions?.hiddenCandidateCap, false, 'candidate-head benchmark hid a candidate cap');
    assert.equal(benchmark.frozenDenseHeadsControl, 'arithmetic-control-only', 'candidate-head benchmark misused frozen dense heads as runtime evidence');
    assert.equal(benchmark.widthResults?.length, 3, 'candidate-head benchmark did not report three width results');
    assert.ok(benchmark.widthResults.every(result => [16, 24, 32].includes(Number(result.width))), 'candidate-head benchmark reported an unexpected width');
    assert.ok(benchmark.widthResults.every(result => Number(result.indirectWorkgroups) >= 0 && Number(result.indirectThreads) >= 0), 'candidate-head benchmark indirect work accounting missing');
    assert.ok(benchmark.widthResults.every(result => Number(result.estimatedTotalMacs) >= 0 && Number(result.estimatedTotalBytes) >= 0), 'candidate-head benchmark MAC/byte accounting missing');
    assert.equal(benchmark.budgetDisposition?.profitableTargetMs, 10, 'candidate-head benchmark profitable target missing');
    assert.equal(benchmark.budgetDisposition?.credibleBreakEvenTargetMs, 15, 'candidate-head benchmark credible target missing');
    assert.equal(benchmark.budgetDisposition?.outerKillBoundaryMs, 24, 'candidate-head benchmark kill boundary missing');
  }
  if (cueBufferLifecycleStressRequested) {
    const stress = state?.nativeLowResidentCueBufferLifecycleStress || {};
    assert.equal(stress.identity, 'native-low-resident-cue-buffer-lifecycle-stress-v0', 'resident cue-buffer lifecycle stress missing');
    assert.equal(stress.claimScope, 'lifecycle-cost-substrate-not-fidelity-or-visual-evidence-v0', 'cue-buffer lifecycle stress overclaimed evidence');
    assert.equal(stress.candidateListSource, 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0', 'cue-buffer stress candidate list source mismatch');
    assert.equal(stress.dispatchMode, 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0', 'cue-buffer stress dispatch mode mismatch');
    assert.equal(stress.syntheticWeightsAuthority, 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0', 'cue-buffer stress synthetic authority missing');
    assert.ok(Number(stress.candidateCueRecordCapacity) >= Number(stress.candidateCountMax), 'cue-buffer capacity does not cover observed candidate count');
    assert.equal(Number(stress.candidateCueRecordAllocationCount), 1, 'resident cue buffer was reallocated');
    assert.equal(Number(stress.candidateCueRecordGrowthCount), 0, 'resident cue buffer grew during stress');
    assert.ok(Number(stress.candidateCueRecordReuseCount) >= Number(stress.frameCount), 'resident cue buffer reuse count did not cover stress frames');
    assert.equal(stress.noReallocation, true, 'resident cue buffer reallocation was not rejected');
    assert.equal(stress.noLeak, true, 'resident cue buffer leak was not rejected');
    assert.equal(stress.hiddenCandidateCap, false, 'cue-buffer stress hid a candidate cap');
    assert.equal(stress.staleCueRowsRetained, false, 'cue-buffer stress retained stale cue rows');
    assert.equal(Number(stress.activeTokenMismatchCount), 0, 'cue-buffer stress found active cue rows with stale tokens');
    assert.ok(Number(stress.staleTailRowsChecked) > 0, 'cue-buffer stress never checked a stale tail after a count decrease');
    assert.equal(stress.countDecreaseObserved, true, 'cue-buffer stress never observed a candidate-count decrease');
    assert.ok(Number(stress.distinctCandidateCountCount) >= 2, 'cue-buffer stress did not exercise changing candidate counts');
    assert.ok(Number(stress.candidateCountMax) >= Number(stress.observedCandidateCountTarget), 'cue-buffer stress did not reach the observed candidate-count target');
    assert.equal(stress.fidelityClaim, false, 'cue-buffer stress made a fidelity claim');
    assert.equal(stress.visualClaim, false, 'cue-buffer stress made a visual claim');
  }
  if (frontTopologyAblationRequested) {
    assert.equal(state?.nativeLowFrontTopologyAblation?.identity, 'native-low-front-topology-ablation-v0', 'frontTopology ablation missing');
    assert.equal(state?.nativeLowFrontTopologyAblation?.offlineImporterUsed, false, 'offline importer was used for frontTopology ablation');
    assert.equal(state?.nativeLowFrontTopologyAblation?.fullFrozenTreatmentReference?.learnedFrontTopologyResidualApplied, true, 'full frozen frontTopology reference missing');
    assert.equal(state?.nativeLowFrontTopologyAblation?.frontTopologyAblatedTreatment?.learnedFrontTopologyResidualApplied, false, 'learned frontTopology residual was not disabled');
    assert.equal(state?.nativeLowFrontTopologyAblation?.frontTopologyAblatedTreatment?.learnedSupportAndCarrierResidualsRetained, true, 'learned carrier residuals were not retained');
    assert.ok(Number(state?.frontTopologyAblatedSplatInstanceCount) >= 0, 'frontTopology ablated splat count missing');
  }
  assert.equal(state?.simulationSteppingReceipt?.simStepDelta, 1, 'simulator did not step exactly once for this model frame');
  assert.equal(state?.currentSourceFrameConsumption?.encodedFrameDelta, 1, 'model did not consume exactly one current source frame');
  assert.equal(state?.stalePredictionRejection?.repeatedStaticPrediction, false, 'stale prediction was not rejected');
  if (fixedGateDiscontinuityAssayRequested) {
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.identity, 'native-low-fixed-source-delta-discontinuity-assay-v0', 'fixed-gate discontinuity assay missing');
    const steadyStrip = state?.nativeLowFixedGateDiscontinuityAssay?.steadyPreShiftStrip || {};
    const workloadPressure = state?.nativeLowFixedGateDiscontinuityAssay?.preShiftWorkloadPressure || {};
    assert.equal(steadyStrip.minimumValidHistoryFrames, 4, 'pre-shift strip minimum missing');
    assert.ok(Number(steadyStrip.validHistoryFrameCount) >= 4, 'pre-shift strip did not capture four valid-history frames');
    assert.ok(Number(steadyStrip.sourceDeltaAdmissionGpuMsMin) >= 0, 'pre-shift source-delta admission timing min missing');
    assert.ok(Number(steadyStrip.sourceDeltaAdmissionGpuMsMax) >= Number(steadyStrip.sourceDeltaAdmissionGpuMsMin), 'pre-shift source-delta admission timing max invalid');
    assert.ok(Number(steadyStrip.sourceDeltaAdmissionGpuMsMean) >= Number(steadyStrip.sourceDeltaAdmissionGpuMsMin), 'pre-shift source-delta admission timing mean invalid');
    assert.deepEqual(steadyStrip.sourceDeltaAdmissionContentionRangeMs?.priorObservedR26, [1.043567, 9.699227], 'prior r26 source-delta admission contention range missing');
    assert.equal(steadyStrip.sourceDeltaAdmissionContentionRangeMs?.smoothingApplied, false, 'source-delta admission contention range was smoothed');
    assert.equal(workloadPressure.mohelWarningThresholdMode, 'normal-basin-coverage-mean-multiple-v0', 'assay workload warning mode missing');
    assert.equal(Number(workloadPressure.mohelWarningThresholdMultiple), 1.5, 'assay workload warning multiple drifted');
    assert.ok(Number(workloadPressure.mohelWarningBoundaryCoverage) > 0, 'assay workload warning boundary missing');
    if (Number(steadyStrip.coverageMax) > Number(workloadPressure.mohelWarningBoundaryCoverage)) {
      assert.ok(Number(steadyStrip.mohelWarningFrameCount) > 0, 'pre-shift strip exceeded warning boundary without a Mohel warning');
    }
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.noRebuildViolentSourceShapeShift?.historyEpochChanged, false, 'no-rebuild shift changed history epoch');
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.noRebuildViolentSourceShapeShift?.historyEpochValidForAdmission, true, 'no-rebuild shift lost valid history');
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.actualBasinGridSceneRebuild?.historyEpochChanged, true, 'rebuild did not change history epoch');
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.actualBasinGridSceneRebuild?.sourceHistoryResetReason, 'epoch-changed-first-frame-invalidated', 'rebuild first frame was not invalidated');
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.postRebuildConsecutiveValidFrame?.historyEpochValidForAdmission, true, 'post-rebuild consecutive frame did not become valid');
    assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.assayClaimScope, 'routing-cost-discontinuity-receipt-not-visual-robustness-claim-v0', 'assay overclaimed visual robustness');
    if (candidateHeadBenchmarkRequested) {
      assert.equal(state?.nativeLowFixedGateDiscontinuityAssay?.candidateHeadCostMicrobenchmarkStrip?.identity, 'native-low-candidate-head-cost-microbenchmark-v0', 'assay did not preserve candidate-head benchmark strip');
      assert.ok(Number(state?.nativeLowFixedGateDiscontinuityAssay?.candidateHeadCostMicrobenchmarkStrip?.benchmarkFrameCount) >= 4, 'assay did not benchmark the steady pre-shift strip');
      assert.ok(Number(state?.nativeLowFixedGateDiscontinuityAssay?.candidateHeadCostMicrobenchmarkStrip?.candidateCountMax) >= Number(state?.nativeLowFixedGateDiscontinuityAssay?.candidateHeadCostMicrobenchmarkStrip?.candidateCountMin), 'assay benchmark count range invalid');
    }
  }

  const startState = state;
  const observationStartMs = performance.now();
  failurePhase = 'continuous-observation';
  await delay(minimumContinuousSeconds * 1000);
  const endState = await evaluate(socket, 'window.__kaminosNativeLowSelectiveLive.debugState()');
  const observedSeconds = (performance.now() - observationStartMs) / 1000;
  const frameDelta = Number(endState?.frameIndex || 0) - Number(startState?.frameIndex || 0);
  const observedPresentationFps = frameDelta / Math.max(0.001, observedSeconds);
  lastTrustworthyEvidence = { startState, endState, observedSeconds, frameDelta };
  assert.ok(observedSeconds >= minimumContinuousSeconds * 0.98, 'observation window was truncated');
  assert.ok(frameDelta >= 1, 'native-low treatment frames did not advance continuously');
  if (cockpitRequested) {
    assert.ok(observedPresentationFps >= 5, `cockpit cadence below 5 fps: ${observedPresentationFps}`);
    assert.equal(endState?.nativeLowLiveResearchCockpit?.telemetry?.temporallyEven, true, 'cockpit presentation cadence was not temporally even');
    assert.ok(Number(endState?.nativeLowLiveResearchCockpit?.telemetry?.presentationSampleCount) >= 4, 'cockpit cadence sample strip is too short');
  }
  assert.equal(endState?.effectiveComposition, startState?.effectiveComposition, 'composition drift during observation');
  assert.equal(endState?.effectiveCalibration, startState?.effectiveCalibration, 'calibration drift during observation');
  assert.equal(endState?.modelOutputMutation, false, 'model-output mutation during observation');
  assert.ok(isWebGpuBackend(endState?.effectiveBackend), `backend drift during observation: ${endState?.effectiveBackend}`);
  assert.equal(endState?.fallbackBackend, null, 'fallback backend during observation');
  assert.equal(endState?.transportMode, TRANSPORT_MODE, 'transport mode drift during observation');
  if (directSparseCuesRequested) {
    assert.equal(endState?.simulationClockAuthority, 'fixed-one-sim-step-per-presented-frame-v0', 'direct sparse simulation clock drifted during observation');
  }
  assert.equal(endState?.runtimeBuildIdentity, expectedRuntimeBuildIdentity, 'runtime build identity drift during observation');
  assert.equal(endState?.sourceStepDrift, null, 'source-step drift during observation');
  assert.equal(endState?.simulationSteppingReceipt?.simStepDelta, 1, 'simulator stopped stepping during observation');
  assert.equal(endState?.currentSourceFrameConsumption?.encodedFrameDelta, 1, 'model stopped consuming current source frames during observation');
  assert.equal(endState?.stalePredictionRejection?.repeatedStaticPrediction, false, 'repeated static prediction during observation');
  if (directSparseCuesRequested) {
    assert.equal(endState?.nativeLowLiveResearchCockpit?.selectedRole, requestedCockpitRole, 'requested direct learned role drifted during observation');
    assert.equal(endState?.nativeLowDirectSparseCues?.directRendererConsumed, true, 'direct learned renderer was not active at observation end');
    assert.equal(typeof endState?.nativeLowDirectSparseCues?.diagnosticTelemetryReadbackThisFrame, 'boolean', 'direct telemetry cadence receipt drifted during observation');
    assert.equal(Number(endState?.nativeLowDirectSparseCues?.directSparseOverflowCount), 0, 'direct learned renderer overflowed during observation');
  }
  if (frontTopologyAblationRequested) {
    assert.equal(endState?.nativeLowFrontTopologyAblation?.sameSourceStepIdentity, endState?.sourceStepIdentity, 'frontTopology ablation source identity drift');
    assert.equal(endState?.nativeLowFrontTopologyAblation?.offlineImporterUsed, false, 'offline importer used during observation');
  }

  failurePhase = 'blankFrameRejection';
  const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = Buffer.from(capture.data || '', 'base64');
  assert.ok(screenshot.byteLength > 1000, 'blankFrameRejection: screenshot missing or blank');
  failurePhase = 'cachedFrameRejection';
  assert.notEqual(startState?.frameCacheKey, null, 'cachedFrameRejection: route omitted frame cache key');
  assert.notEqual(endState?.sameNativeStateIdentity, startState?.sameNativeStateIdentity, 'cachedFrameRejection: native state identity did not advance');
  writeFileSync(out, screenshot);

  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveUrl,
    runtimeBuildIdentity: endState.runtimeBuildIdentity,
    expectedRuntimeBuildIdentity,
    runtimeBuildCacheKey: endState.runtimeBuildCacheKey,
    witnessGitHead,
    servedSourceBundleSha256: servedSourceBundle.sha256,
    servedSourceBundleFiles: servedSourceBundle.files,
    servedSourceBundleAuthority: 'fresh-http-served-source-bundle-sha256-v0',
    browserProfileDir,
    cacheDisabled: true,
    cachedCodeRejection: 'passed-runtime-build-identity-and-cache-busted-url-v0',
    effectiveRoute: endState.routeIdentity,
    requestedComposition: endState.requestedComposition,
    effectiveComposition: endState.effectiveComposition,
    requestedCalibration: endState.requestedCalibration,
    effectiveCalibration: endState.effectiveCalibration,
    nativeLowControl: endState.nativeLowControl,
    nativeLowLiveResearchCockpit: endState.nativeLowLiveResearchCockpit,
    cockpitRequested,
    cockpitInteractionAssay,
    nativeLowSelectivePredicted: endState.nativeLowSelectivePredicted,
    modelOutputMutation: endState.modelOutputMutation,
    treatmentSplatRadianceGain: endState.treatmentSplatRadianceGain,
    treatmentSplatOpacityGain: endState.treatmentSplatOpacityGain,
    nativeLowMaterializationProfile: endState.nativeLowMaterializationProfile,
    nativeLowDirectSparseCues: endState.nativeLowDirectSparseCues,
    simulationClockAuthority: endState.simulationClockAuthority,
    simulationStepDeltaMs: endState.simulationStepDeltaMs,
    nativeLowProductionStageLedger: endState.nativeLowProductionStageLedger,
    nativeLowBreakEvenBudgetLedger: endState.nativeLowBreakEvenBudgetLedger,
    nativeLowCoarseFrontSparseDetailBand: endState.nativeLowCoarseFrontSparseDetailBand,
    nativeLowSourceHistoryDetailCandidate: endState.nativeLowSourceHistoryDetailCandidate,
    nativeLowFixedSourceDeltaAdmission: endState.nativeLowFixedSourceDeltaAdmission,
    nativeLowCandidateHeadCostMicrobenchmark: endState.nativeLowCandidateHeadCostMicrobenchmark,
    nativeLowCoarseSourceHistorySupportFrontReplacement: endState.nativeLowCoarseSourceHistorySupportFrontReplacement,
    native96SparseFrontContinuity: endState.native96SparseFrontContinuity,
    nativeLowResidentCueBufferLifecycleStress: endState.nativeLowResidentCueBufferLifecycleStress,
    nativeLowCandidateCueBufferLifecycle: endState.nativeLowCandidateCueBufferLifecycle,
    nativeLowVivisectorCandidateHeadPackageReceiver: endState.nativeLowVivisectorCandidateHeadPackageReceiver,
    nativeLowFixedGateDiscontinuityAssay: endState.nativeLowFixedGateDiscontinuityAssay,
    fixedGateDiscontinuityAssayRequested,
    candidateHeadBenchmarkRequested,
    cueBufferLifecycleStressRequested,
    coarseSourceHistorySupportFrontRequested,
    sparseFrontContinuityRequested,
    directSparseCuesRequested,
    vivisectorCandidateHeadTrainedRouteRequested,
    nativeLowFrontTopologyAblation: endState.nativeLowFrontTopologyAblation,
    fullFrozenTreatmentReference: endState.fullFrozenTreatmentReference,
    frontTopologyAblatedTreatment: endState.frontTopologyAblatedTreatment,
    frontTopologyAblatedSplatCandidateCount: endState.frontTopologyAblatedSplatCandidateCount,
    frontTopologyAblatedSplatInstanceCount: endState.frontTopologyAblatedSplatInstanceCount,
    frontTopologyAblationRequested,
    nativeLowSupportTileProfile: endState.nativeLowSupportTileProfile,
    nativeLowSourceTileCandidate: endState.nativeLowSourceTileCandidate,
    supportTileProjection: {
      activeTileCoverage: endState.nativeLowSupportTileProfile?.activeTileCoverage,
      projectedCellReduction: endState.nativeLowSupportTileProfile?.projectedCellReduction,
      projectedSupportFrontCellCount: endState.nativeLowSupportTileProfile?.projectedSupportFrontCellCount,
    },
    sourceTileCandidateProjection: {
      candidateTileCoverage: endState.nativeLowSourceTileCandidate?.candidateTileCoverage,
      projectedCellReduction: endState.nativeLowSourceTileCandidate?.projectedCellReduction,
      projectedCandidateCellCount: endState.nativeLowSourceTileCandidate?.projectedCandidateCellCount,
      supportMissRate: endState.nativeLowSourceTileCandidate?.supportMissRate,
      candidateCapturesAllDenseSupport: endState.nativeLowSourceTileCandidate?.candidateCapturesAllDenseSupport,
    },
    simulationSteppingReceipt: endState.simulationSteppingReceipt,
    currentSourceFrameConsumption: endState.currentSourceFrameConsumption,
    stalePredictionRejection: endState.stalePredictionRejection,
    nativeLowInferenceWorkProfile: endState.nativeLowInferenceWorkProfile,
    supportCompactionIdentity: endState.nativeLowInferenceWorkProfile?.supportCompactionIdentity,
    supportCompactedCount: endState.nativeLowInferenceWorkProfile?.supportCompactedCount,
    residualDispatchMode: endState.nativeLowInferenceWorkProfile?.residualDispatchMode,
    residualDispatchArgsFinalized: endState.nativeLowInferenceWorkProfile?.residualDispatchArgsFinalized,
    residualDispatchIndirect: endState.nativeLowInferenceWorkProfile?.residualDispatchIndirect,
    residualDispatchFullGridEarlyReturn: endState.nativeLowInferenceWorkProfile?.residualDispatchFullGridEarlyReturn,
    residualDispatchWorkgroups: endState.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups,
    residualDispatchThreadCount: endState.nativeLowInferenceWorkProfile?.residualDispatchThreadCount,
    nativeLowHeadCostProfile: endState.nativeLowHeadCostProfile,
    headCostTimingAuthority: endState.headCostTimingAuthority,
    requestedBackend: endState.requestedBackend,
    effectiveBackend: endState.effectiveBackend,
    transportMode: endState.transportMode,
    modelIdentity: endState.modelIdentity,
    modelSha256: endState.modelSha256,
    supportPositiveCount: endState.supportPositiveCount,
    supportPrevalence: endState.supportPrevalence,
    treatmentSplatCandidateCount: endState.treatmentSplatCandidateCount,
    treatmentSplatInstanceCount: endState.treatmentSplatInstanceCount,
    calibrationGain: endState.calibrationGain,
    blankTreatmentAttribution: endState.blankTreatmentAttribution,
    minimumContinuousSeconds,
    observedSeconds,
    observedPresentationFps,
    frameDelta,
    inferenceGpuMs: endState.inferenceGpuMs,
    uploadDispatchMs: endState.uploadDispatchMs,
    treatmentRebuildMs: endState.treatmentRebuildMs,
    treatmentCopyMs: endState.treatmentCopyMs,
    restoreRebuildMs: endState.restoreRebuildMs,
    restoreCopyMs: endState.restoreCopyMs,
    endToEndFrameMs: endState.endToEndFrameMs,
    blankFrameRejection: 'passed',
    cachedFrameRejection: 'passed',
    startState,
    endState,
    screenshot: out,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, frameDelta }, null, 2));
} catch (error) {
  let failureScreenshot = null;
  try {
    if (socket) {
      const capture = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(capture.data || '', 'base64');
      if (bytes.byteLength > 1000) {
        const failurePath = out.replace(/\.png$/i, '-failure.png');
        writeFileSync(failurePath, bytes);
        failureScreenshot = failurePath;
      }
    }
  } catch {}
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    expectedRuntimeBuildIdentity,
    witnessGitHead,
    servedSourceBundleSha256: servedSourceBundle?.sha256 || null,
    servedSourceBundleAuthority: servedSourceBundle ? 'fresh-http-served-source-bundle-sha256-v0' : null,
    routeIdentity: lastTrustworthyEvidence?.routeSettle?.routeIdentity || null,
    runtimeBuildIdentity: lastTrustworthyEvidence?.routeSettle?.runtimeBuildIdentity || null,
    requestedBackend: lastTrustworthyEvidence?.routeSettle?.requestedBackend || null,
    effectiveBackend: lastTrustworthyEvidence?.routeSettle?.effectiveBackend || null,
    requestedComposition: lastTrustworthyEvidence?.routeSettle?.requestedComposition || null,
    effectiveComposition: lastTrustworthyEvidence?.routeSettle?.effectiveComposition || null,
    transportMode: lastTrustworthyEvidence?.routeSettle?.transportMode || null,
    nativeLowVivisectorCandidateHeadPackageReceiver: lastTrustworthyEvidence?.routeSettle?.nativeLowVivisectorCandidateHeadPackageReceiver
      || lastTrustworthyEvidence?.nativeLowVivisectorCandidateHeadPackageReceiver
      || null,
    browserProfileDir,
    minimumContinuousSeconds,
    lastTrustworthyEvidence,
    failureScreenshot,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
  if (browserProfileDir) {
    try { rmSync(browserProfileDir, { recursive: true, force: true }); } catch {}
  }
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

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForTarget(debugPort, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(isInspectablePageTarget);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

function isInspectablePageTarget(target) {
  const targetUrl = String(target?.url || '');
  return target?.type === 'page' && !targetUrl.startsWith('chrome-extension://');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeReport(value) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function isWebGpuBackend(value) {
  return String(value || '').startsWith('WebGPU');
}

function cacheBustUrl(rawUrl, runtimeBuildIdentity, head) {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('runtime_build_expect', runtimeBuildIdentity);
  parsed.searchParams.set('witness_git_head', head);
  parsed.searchParams.set('cache_bust', `${Date.now()}-${randomInt(1_000_000, 9_999_999)}`);
  return parsed.toString();
}

function addServedSourceBundleIdentity(rawUrl, sha256) {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('served_source_bundle_sha256', sha256);
  return parsed.toString();
}

function nativeLowInferenceSumMatches(profile) {
  const sourceDelta = Number(profile?.sourceDeltaAdmissionGpuMs);
  const supportFront = Number(profile?.supportFrontGpuMs);
  const residual = Number(profile?.supportPositiveResidualGpuMs);
  const total = Number(profile?.inferenceGpuMs);
  if (![sourceDelta, supportFront, residual, total].every(Number.isFinite)) return false;
  return Math.abs(total - (sourceDelta + supportFront + residual)) < 1e-6;
}

function nativeLowSourceDeltaOnlySumMatches(profile) {
  const sourceDelta = Number(profile?.sourceDeltaAdmissionGpuMs);
  const total = Number(profile?.inferenceGpuMs);
  if (![sourceDelta, total].every(Number.isFinite)) return false;
  return Math.abs(total - sourceDelta) < 1e-6;
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'git-head-unavailable';
  }
}

async function fetchServedSourceBundle(rawUrl, paths) {
  const base = new URL(rawUrl);
  const files = [];
  const hash = createHash('sha256');
  let runtimeBuildIdentityPresent = false;
  for (const path of paths) {
    const fileUrl = new URL(path, base);
    fileUrl.searchParams.set('source_bundle_cache_bust', `${Date.now()}-${randomInt(1_000_000, 9_999_999)}`);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`served-source-fetch-failed:${path}:${response.status}`);
    const text = await response.text();
    const fileSha256 = createHash('sha256').update(text).digest('hex');
    hash.update(path);
    hash.update('\0');
    hash.update(text);
    hash.update('\0');
    if (text.includes(REQUIRED_RUNTIME_BUILD_IDENTITY)) runtimeBuildIdentityPresent = true;
    files.push({
      path,
      url: fileUrl.toString(),
      sha256: fileSha256,
      byteLength: Buffer.byteLength(text),
    });
  }
  return {
    authority: 'fresh-http-served-source-bundle-sha256-v0',
    sha256: hash.digest('hex'),
    runtimeBuildIdentityPresent,
    files,
  };
}
