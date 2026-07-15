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
const MODEL = 'exact-basin-selective-carrier-heads-160-to-128-v0';
const MODEL_SHA256 = 'dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9';
const TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';
const REQUIRED_RUNTIME_BUILD_IDENTITY = 'native-low-candidate-head-cost-microbenchmark-v1';
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
});
const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const expectedRuntimeBuildIdentity = String(args.get('--expected-runtime-build') || REQUIRED_RUNTIME_BUILD_IDENTITY);
const frontTopologyAblationRequested = new URL(url).searchParams.get('front_topology_ablation') === '1';
const fixedGateDiscontinuityAssayRequested = new URL(url).searchParams.get('fixed_gate_discontinuity_assay') === '1';
const candidateHeadBenchmarkRequested = new URL(url).searchParams.get('candidate_head_benchmark') === '1';
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
    if (state?.status === 'failed') throw new Error(state?.lastTrustworthyEvidence?.error || state?.failurePhase || 'native-low live route failed');
    if (
      state?.routeIdentity === ROUTE
      && state?.runtimeBuildIdentity === expectedRuntimeBuildIdentity
      && state?.status === 'running'
      && state?.frameIndex >= 1
      && state?.modelIdentity === MODEL
      && state?.modelSha256 === MODEL_SHA256
      && state?.requestedComposition === 'splat-only-v0'
      && state?.effectiveComposition === 'splat-only-v0'
      && state?.requestedCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.effectiveCalibration === 'native-low-learned-splat-calibration-v0'
      && state?.modelOutputMutation === false
      && state?.requestedBackend === 'WebGPU'
      && isWebGpuBackend(state?.effectiveBackend)
      && state?.fallbackBackend === null
      && state?.transportMode === TRANSPORT_MODE
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
      && state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage === 'full-grid-160^3'
      && state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity === 'native-low-support-positive-residual-dispatch-v0'
      && state?.nativeLowInferenceWorkProfile?.supportCompactionActive === true
      && state?.nativeLowInferenceWorkProfile?.residualDispatchMode === 'support-positive-indirect-dispatch-args-v0'
      && state?.nativeLowInferenceWorkProfile?.residualDispatchArgsFinalized === true
      && state?.nativeLowInferenceWorkProfile?.residualDispatchIndirect === true
      && state?.nativeLowInferenceWorkProfile?.residualDispatchFullGridEarlyReturn === false
      && state?.nativeLowInferenceWorkProfile?.hiddenSupportCap === false
      && Number(state?.nativeLowInferenceWorkProfile?.modelEvaluatedCellCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.residualHeadEvaluatedCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount) >= 0
      && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchWorkgroups) >= 1
      && Number(state?.nativeLowInferenceWorkProfile?.residualDispatchThreadCount) >= Number(state?.nativeLowInferenceWorkProfile?.supportCompactedCount)
      && state?.nativeLowHeadCostProfile?.identity === 'native-low-head-cost-profile-v0'
      && state?.headCostTimingAuthority === 'webgpu-timestamp-query-stage-split-v0'
      && Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0
      && Array.isArray(state?.nativeLowHeadCostProfile?.values)
      && state?.nativeLowHeadCostProfile?.values.length === 6
      && nativeLowInferenceSumMatches(state?.nativeLowHeadCostProfile)
      && Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) >= 0
      && Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) >= 0
      && state?.nativeLowSupportTileProfile?.identity === 'native-low-support-proximal-tile-profile-v0'
      && Number(state?.nativeLowSupportTileProfile?.activeTileCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.projectedSupportFrontCellCount) >= 0
      && Number(state?.nativeLowSupportTileProfile?.tileProfileReadbackMs) >= 0
      && state?.nativeLowSourceTileCandidate?.identity === 'native-low-source-proximal-tile-candidate-v0'
      && Number(state?.nativeLowSourceTileCandidate?.candidateTileCount) >= 0
      && Number(state?.nativeLowSourceTileCandidate?.projectedCandidateCellCount) >= 0
      && Number(state?.nativeLowSourceTileCandidate?.supportMissRate) >= 0
      && state?.nativeLowSourceTileCandidate?.hiddenSupportCap === false
      && state?.nativeLowProductionStageLedger?.identity === 'native-low-production-stage-ledger-v0'
      && state?.nativeLowProductionStageLedger?.frozenDenseRouteControl?.retained === true
      && Number(state?.nativeLowProductionStageLedger?.denseReceiverWriteBytes) > 0
      && state?.nativeLowProductionStageLedger?.debugManifestTransportExcluded?.excluded === true
      && state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status === 'projection-not-implemented'
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
    ) break;
    await delay(250);
  }
  assert.equal(state?.routeIdentity, ROUTE, 'wrong effective route');
  assert.equal(state?.status, 'running', 'live route did not reach running state');
  assert.equal(state?.modelIdentity, MODEL, 'wrong model identity');
  assert.equal(state?.modelSha256, MODEL_SHA256, 'wrong model checksum');
  assert.equal(state?.requestedComposition, 'splat-only-v0', 'wrong requested composition');
  assert.equal(state?.effectiveComposition, 'splat-only-v0', 'requested/effective composition drift');
  assert.equal(state?.requestedCalibration, 'native-low-learned-splat-calibration-v0', 'wrong requested calibration');
  assert.equal(state?.effectiveCalibration, 'native-low-learned-splat-calibration-v0', 'wrong effective calibration');
  assert.equal(state?.modelOutputMutation, false, 'calibration mutated model outputs');
  assert.equal(state?.requestedBackend, 'WebGPU', 'wrong requested backend');
  assert.ok(isWebGpuBackend(state?.effectiveBackend), `fallback backend used: ${state?.effectiveBackend}`);
  assert.equal(state?.fallbackBackend, null, 'fallback backend evidence is not admissible');
  assert.equal(state?.transportMode, TRANSPORT_MODE, 'wrong shared-device transport mode');
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
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportClassifierCoverage, 'full-grid-160^3', 'support classifier coverage is not full grid');
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionIdentity, 'native-low-support-positive-residual-dispatch-v0', 'wrong support compaction identity');
  assert.equal(state?.nativeLowInferenceWorkProfile?.supportCompactionActive, true, 'support compaction was not active');
  assert.equal(state?.nativeLowInferenceWorkProfile?.residualDispatchMode, 'support-positive-indirect-dispatch-args-v0', 'wrong residual dispatch mode');
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
  assert.equal(state?.nativeLowHeadCostProfile?.identity, 'native-low-head-cost-profile-v0', 'head cost profile missing');
  assert.equal(state?.headCostTimingAuthority, 'webgpu-timestamp-query-stage-split-v0', 'wrong head cost timing authority');
  assert.equal(state?.runtimeBuildIdentity, expectedRuntimeBuildIdentity, 'runtime build identity mismatch');
  assert.ok(Number(state?.nativeLowHeadCostProfile?.sourceDeltaAdmissionGpuMs) >= 0, 'sourceDeltaAdmissionGpuMs missing');
  assert.equal(state?.nativeLowHeadCostProfile?.values?.length, 6, 'head cost profile did not record six timestamp values');
  assert.ok(nativeLowInferenceSumMatches(state?.nativeLowHeadCostProfile), 'inferenceGpuMs is not the exact sum of source-delta/support-front/residual stages');
  assert.ok(Number(state?.nativeLowHeadCostProfile?.supportFrontGpuMs) >= 0, 'supportFrontGpuMs missing');
  assert.ok(Number(state?.nativeLowHeadCostProfile?.supportPositiveResidualGpuMs) >= 0, 'supportPositiveResidualGpuMs missing');
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
  assert.equal(state?.nativeLowProductionStageLedger?.dense160ReceiverWriteAvoidanceCandidate?.status, 'projection-not-implemented', 'sparse receiver candidate projection status missing');
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
  if (fixedGateDiscontinuityAssayRequested) {
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
  lastTrustworthyEvidence = { startState, endState, observedSeconds, frameDelta };
  assert.ok(observedSeconds >= minimumContinuousSeconds * 0.98, 'observation window was truncated');
  assert.ok(frameDelta >= 1, 'native-low treatment frames did not advance continuously');
  assert.equal(endState?.effectiveComposition, startState?.effectiveComposition, 'composition drift during observation');
  assert.equal(endState?.effectiveCalibration, startState?.effectiveCalibration, 'calibration drift during observation');
  assert.equal(endState?.modelOutputMutation, false, 'model-output mutation during observation');
  assert.ok(isWebGpuBackend(endState?.effectiveBackend), `backend drift during observation: ${endState?.effectiveBackend}`);
  assert.equal(endState?.fallbackBackend, null, 'fallback backend during observation');
  assert.equal(endState?.transportMode, TRANSPORT_MODE, 'transport mode drift during observation');
  assert.equal(endState?.runtimeBuildIdentity, expectedRuntimeBuildIdentity, 'runtime build identity drift during observation');
  assert.equal(endState?.sourceStepDrift, null, 'source-step drift during observation');
  assert.equal(endState?.simulationSteppingReceipt?.simStepDelta, 1, 'simulator stopped stepping during observation');
  assert.equal(endState?.currentSourceFrameConsumption?.encodedFrameDelta, 1, 'model stopped consuming current source frames during observation');
  assert.equal(endState?.stalePredictionRejection?.repeatedStaticPrediction, false, 'repeated static prediction during observation');
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
    nativeLowSelectivePredicted: endState.nativeLowSelectivePredicted,
    modelOutputMutation: endState.modelOutputMutation,
    treatmentSplatRadianceGain: endState.treatmentSplatRadianceGain,
    treatmentSplatOpacityGain: endState.treatmentSplatOpacityGain,
    nativeLowMaterializationProfile: endState.nativeLowMaterializationProfile,
    nativeLowProductionStageLedger: endState.nativeLowProductionStageLedger,
    nativeLowBreakEvenBudgetLedger: endState.nativeLowBreakEvenBudgetLedger,
    nativeLowCoarseFrontSparseDetailBand: endState.nativeLowCoarseFrontSparseDetailBand,
    nativeLowSourceHistoryDetailCandidate: endState.nativeLowSourceHistoryDetailCandidate,
    nativeLowFixedSourceDeltaAdmission: endState.nativeLowFixedSourceDeltaAdmission,
    nativeLowCandidateHeadCostMicrobenchmark: endState.nativeLowCandidateHeadCostMicrobenchmark,
    nativeLowFixedGateDiscontinuityAssay: endState.nativeLowFixedGateDiscontinuityAssay,
    fixedGateDiscontinuityAssayRequested,
    candidateHeadBenchmarkRequested,
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
