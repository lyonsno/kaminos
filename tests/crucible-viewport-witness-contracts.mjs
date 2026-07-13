import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const projectorSource = witness.match(
  /function projectFriendlyFiringEvidence\([\s\S]*?\n}\n(?=\ntry \{)/,
);
assert.ok(projectorSource, 'witness must expose a testable Node-side firing evidence projector');
const projectFriendlyFiringEvidence = vm.runInNewContext(`(${projectorSource[0]})`);
const projectedEvidence = projectFriendlyFiringEvidence({
  browserFiringEvidence: {
    status: 'complete',
    reportPath: '/tmp/pipeline-witness.json',
    foregroundKilnHeartbeat: { schema: 'kaminos.foreground-kiln-heartbeat.v0', sampleRetention: 'uncapped' },
    sharpDutyCorrelation: { schema: 'kaminos.foreground-sharp-duty-correlation.v0', status: 'verified' },
    volumeReleased: true,
    volumeReleaseConfirmed: true,
    autoOpenedTab: 'assets',
  },
  pipelineReport: {
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectiveRouteConfig: { routeId: 'adapter.sharp-image-to-splat-live.v0' },
    artifacts: { splat: { path: '/tmp/output.ply', bytes: 64, sha256: 'abc', status: 'real' } },
    stages: [{ effectiveRoute: { adapterReport: {
      revision: 'sharp-revision',
      breathingRoom: { requestedScheduler: { mode: 'cooperative' }, effectiveScheduler: { mode: 'cooperative' }, telemetry: { events: [] } },
      backgroundHeartbeat: { schema: 'sharp-webgpu.background-heartbeat.v0', worstFrameGaps: [], gpuDutyIntervals: { intervals: [] } },
    } } }],
  },
});
assert.equal(projectedEvidence.reportPath, '/tmp/pipeline-witness.json');
assert.equal(projectedEvidence.effectiveSharpRevision, 'sharp-revision');
assert.equal(projectedEvidence.output.sha256, 'abc');
assert.equal(projectedEvidence.foregroundKilnHeartbeat.sampleRetention, 'uncapped');
assert.equal(projectedEvidence.sharpDutyCorrelation.status, 'verified');
assert.equal(projectedEvidence.volumeReleased, true);

for (const [pattern, message] of [
  [/crucible-viewport-witness\.v0/, 'Witness must name the Crucible viewport contract it emits'],
  [/--url/, 'Witness must accept an explicit Kaminos URL instead of hardcoding a server'],
  [/--out/, 'Witness must let callers choose the screenshot path'],
  [/--report/, 'Witness must let callers choose the JSON report path'],
  [/--fire-friendly/, 'Witness must expose an explicit opt-in real Friendly firing mode'],
  [/--expected-sharp-revision/, 'Full-route witness must accept the exact expected SHARP source revision'],
  [/openGenerateTabExpression[\s\S]*data-tab="generate"[\s\S]*evaluate\(ws, openGenerateTabExpression\)/, 'Witness must open the real Generate tab path'],
  [/id: 'crucible-viewport-workspace'/, 'Witness report must include the requested workspace selector'],
  [/data-crucible-workroom/, 'Witness must verify workroom identity, not just screenshot nonblankness'],
  [/data-crucible-heat-state/, 'Witness must record heat state from the visible surface'],
  [/data-crucible-route-status/, 'Witness must record the effective route status shown by the workroom'],
  [/crucible-worktable-stage/, 'Witness must verify the worktable stage is actually mounted'],
  [/sourceOptionCount/, 'Witness must prove the plate has real source choices'],
  [/sourceSelectionExercise/, 'Witness must prove changing the plate selector changes the effective shared source'],
  [/backgroundHeartbeat/, 'Full-route witness mode must preserve the corrected heartbeat receipt'],
  [/foregroundKilnHeartbeat/, 'Full-route witness must preserve the exact foreground firing-window heartbeat'],
  [/sharpDutyCorrelation/, 'Full-route witness must preserve the foreground-to-SHARP epoch correlation'],
  [/kaminos\.foreground-sharp-duty-correlation\.v0/, 'Full-route witness must require the correlation schema'],
  [/sampleRetention[\s\S]*uncapped/, 'Full-route witness must reject capped foreground samples'],
  [/foregroundGaps/, 'Full-route witness must preserve every inference-window foreground gap'],
  [/unattributedDurationMs/, 'Full-route witness must preserve delay outside named SHARP duty intervals'],
  [/phaseRankings/, 'Full-route witness must rank named SHARP phase overlap'],
  [/boundaryRankings/, 'Full-route witness must rank named SHARP boundary overlap'],
  [/crossPageClock/, 'Full-route witness must require the shared epoch clock'],
  [/gpuDutyIntervals/, 'Full-route witness must require run-bound submitted-work duty intervals'],
  [/backgroundHeartbeat:\s*backgroundHeartbeat\s*\?\s*\{[\s\S]*gpuDutyIntervals:\s*backgroundHeartbeat\.gpuDutyIntervals/, 'CDP witness must project the complete duty envelope without serializing the entire duplicated adapter report'],
  [/inferenceWindow/, 'Full-route witness mode must fail if the measured inference window is absent'],
  [/worstFrameGaps/, 'Full-route witness mode must fail if scoped gap rows are absent'],
  [/volumeReleased/, 'Full-route witness mode must verify the furnace releases after the cast lands'],
  [/cpuChunkItems/, 'Full-route witness must verify the effective cooperative CPU chunk size'],
  [/routeTailYieldMs/, 'Full-route witness must verify the effective route-tail yield'],
  [/routeTailCheckpointEvents/, 'Full-route witness must require observed prep and Gaussian compose checkpoints'],
  [/lateTailBlockingIntervals/, 'Full-route witness must preserve the named late-tail blocking intervals'],
  [/intervalStartMs/, 'Late-tail interval evidence must preserve browser-timeline start coordinates'],
  [/intervalEndMs/, 'Late-tail interval evidence must preserve browser-timeline end coordinates'],
  [/ply-blob-assembly/, 'Full-route witness must require PLY Blob assembly interval evidence'],
  [/object-url-create/, 'Full-route witness must require object URL interval evidence'],
  [/output-bind/, 'Full-route witness must require output binding interval evidence'],
  [/gaussianCpuDutyIntervals/, 'Full-route witness must preserve Gaussian CPU duty intervals'],
  [/segmentStartProcessedItems/, 'Gaussian interval evidence must carry actual segment start bounds'],
  [/segmentEndProcessedItems/, 'Gaussian interval evidence must carry actual segment end bounds'],
  [/row-batched/, 'Gaussian interval evidence must identify its truthful row-batched granularity'],
  [/inferenceWindowFinalizeInterval/, 'Full-route witness must preserve the post-bind finalization envelope'],
  [/inference-window-finalize/, 'Full-route witness must require the named inference finalization interval'],
  [/localization-envelope/, 'Finalization interval must remain explicitly non-causal localization evidence'],
  [/preGaussianSetupIntervals/, 'Full-route witness must preserve pre-Gaussian setup intervals'],
  [/composePreparationIntervals/, 'Full-route witness must preserve all six bounded preparation intervals'],
  [/maxGaussianDutyMs/, 'Full-route witness must calculate the maximum observed Gaussian CPU duty'],
  [/maxGaussianDutyMs >= 50/, 'Full-route witness must reject a Gaussian CPU duty that misses the sub-50ms target'],
  [/cpuChunkItems !== 16384/, 'Full-route witness must require the effective smaller Gaussian CPU chunk target'],
  [/ply-data-allocation/, 'Full-route witness must require the PLY data allocation interval'],
  [/gaussian-activation-setup/, 'Full-route witness must require the activation setup interval'],
  [/allocation\.bytes > 0/, 'PLY allocation interval must carry a positive actual byte count'],
  [/uninstrumentedGapsAtOrAbove50Ms/, 'Full-route witness must reject every uninstrumented gap at or above the frame-starvation threshold'],
  [/gap\?\.overlapClassification[\s\S]*uninstrumented-gap/, 'Full-route witness must reject unattributed residual gaps'],
  [/fireButtonDisabled/, 'Witness must record whether the primary firing action can actually run'],
  [/castButtonDisabled/, 'Witness must record whether the cast action truthfully has a target'],
  [/pointerEvents/, 'Witness must prove the workroom is hittable instead of visually clickable only'],
  [/Page\.captureScreenshot/, 'Witness must capture the actual browser viewport'],
  [/Runtime\.exceptionThrown/, 'Witness must fail loud on browser runtime exceptions'],
  [/primaryOutputWritten/, 'Witness must report whether primary screenshot evidence was written'],
  [/lastTrustworthyEvidence/, 'Witness failures after inference must preserve the last trustworthy route and heartbeat evidence'],
  [/async function evaluate\(ws, expression, timeoutMs[\s\S]*wsRequest\(ws, 'Runtime\.evaluate',[\s\S]*timeoutMs\)[\s\S]*const browserFiringEvidence = await evaluate\(ws,[\s\S]*fireTimeoutMs\)/, 'Post-firing browser evidence collection must inherit the explicit firing budget instead of timing out while the completed cast binds'],
  [/const browserFiringEvidence = await evaluate\(ws,[\s\S]*reportPath:\s*routeState\.result\?\.report\?\.path/, 'Browser evidence read must return the durable report path instead of projecting the backend report in the busy page'],
  [/JSON\.parse\(readFileSync\(browserFiringEvidence\.reportPath, 'utf8'\)\)/, 'Node witness must read the backend report from its durable filesystem path'],
  [/projectFriendlyFiringEvidence\(\{[\s\S]*browserFiringEvidence,[\s\S]*pipelineReport/, 'Node witness must join browser-owned firing evidence with filesystem-owned backend evidence outside CDP'],
]) {
  assert.match(witness, pattern, message);
}

assert.doesNotMatch(
  witness,
  /\n\s*backgroundHeartbeat,\n\s*foregroundKilnHeartbeat,/,
  'CDP witness must not return the raw multi-megabyte background heartbeat shorthand',
);
assert.doesNotMatch(
  witness,
  /state\.fullRoute = await evaluate\(ws,[\s\S]*const report = routeState\.result\?\.report\?\.document/,
  'CDP witness must not traverse the multi-megabyte backend report inside the busy browser page',
);
