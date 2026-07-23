import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const schedulerProfileSource = page.match(
  /function sharpInlineSchedulerProfile\([\s\S]*?\n}\n(?=\nasync function )/,
);
assert.ok(schedulerProfileSource, 'the inline product route must expose its scheduler profile as a testable contract');
const sharpInlineSchedulerProfile = vm.runInNewContext(`(${schedulerProfileSource[0]})`);
assert.deepEqual(
  JSON.parse(JSON.stringify(sharpInlineSchedulerProfile('cooperative-spn-gaussian'))),
  {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    yieldMs: 4,
    waitForSubmittedWorkDone: true,
    gaussianPhaseYieldMs: 4,
    vitBlockChunkSize: 1,
    vitMicroduty: true,
    vitMicrodutyMode: 'dispatch-major',
    cpuChunkItems: 16384,
    routeTailYieldMs: 3,
    spnFusionChunkItems: 524288,
    decoderKernelChunkItems: 262144,
    decoderKernelMinChunkItems: 65536,
    decoderKernelMaxChunkItems: 8388608,
    decoderKernelTargetDurationMs: 12,
    plyAssemblyMode: 'worker',
    retirePostInferenceBuffers: true,
  },
  'the visible Friendly button must request the reviewed liveness, assembly, and retirement controls',
);

assert.match(
  page,
  /import \{\s*createSharpSameDeviceKilnOpportunityHook,?\s*\} from '\.\/lib\/sharp-same-device-kiln-interlock\.mjs'/,
  'Crucible must own the actual same-device kiln opportunity hook',
);
assert.match(
  page,
  /const SHARP_INLINE_ELEMENT_PREFIX = 'kaminos-sharp-inline-'[\s\S]{0,5000}__kaminosSharpElementPrefix = SHARP_INLINE_ELEMENT_PREFIX[\s\S]{0,1000}__kaminosSharpElementRoot = host/,
  'the inline SHARP module must mount against an isolated caller-owned DOM host before import',
);
for (const id of [
  'drop-zone', 'file-input', 'status', 'error', 'output', 'results', 'input-canvas',
  'depth-canvas', 'download-ply', 'use-spn', 'r-model', 'r-weights', 'r-patch',
  'r-title', 'r-time-label', 'r-grid', 'r-features', 'r-time', 'r-valid',
]) {
  assert.match(page, new RegExp(`SHARP_INLINE_ELEMENT_PREFIX\\}\\$\\{id\\}`), `inline host must create #${id}`);
}
assert.match(
  page,
  /runtimeConfig\.sharpInline[\s\S]{0,1000}registered[\s\S]{0,1000}moduleExists[\s\S]{0,1000}weightsExists/,
  'the product route must fail loud unless the reviewed SHARP module and weights are mounted',
);
assert.match(
  page,
  /const gpuContext = volumePrototype\.foregroundGpuContext\(\)[\s\S]{0,5000}inline\.run\(sourceBlob, \{[\s\S]{0,500}gpuContext,[\s\S]{0,500}weightsUrl:[\s\S]{0,500}scheduler,/,
  'the inline route must inject the product volume device, queue, weights URL, and requested scheduler',
);
assert.match(
  page,
  /createSharpSameDeviceKilnOpportunityHook\([\s\S]{0,1500}__kaminosSharpForegroundOpportunity = opportunityHook[\s\S]{0,1800}beforeInference: async[\s\S]{0,500}await volumePrototype\.setForegroundOpportunityMode\(true\)/,
  'the friendly route must keep ordinary kiln RAF alive through setup and enter lease mode at SHARP inference',
);
assert.match(
  page,
  /const sharpResult = await inline\.run\([\s\S]{0,1000}onProgress:\s*event\s*=>\s*onProgress\?\.\(event\)/,
  'the product route must forward uncapped SHARP inference progress instead of jumping from setup to storage',
);
const progressUpdaterSource = page.match(
  /function setKilnRouteBenchProgress\([\s\S]*?\n}\n(?=\nfunction )/,
);
assert.ok(
  progressUpdaterSource,
  'live SHARP progress must have a dedicated DOM update path instead of entering the full Crucible renderer',
);
assert.doesNotMatch(
  progressUpdaterSource?.[0] || '',
  /renderCrucibleViewportWorkspace|refreshSharpBreathingRoomComparisonSummary/,
  'per-duty progress updates must not rebuild the full Crucible workspace or comparison surface',
);
assert.doesNotMatch(
  progressUpdaterSource?.[0] || '',
  /setInfo\(/,
  'per-duty progress updates must not dirty the full Kaminos scene',
);
assert.match(
  page,
  /const onProgress = event => \{[\s\S]{0,1200}setKilnRouteBenchProgress\(/,
  'the live inline route must consume every progress event through the progress-only updater',
);
assert.match(
  page,
  /throwOnError:\s*false[\s\S]{0,1200}if \(!sharpResult\?\.ok[\s\S]{0,1800}persistSharpInlineRunReport/,
  'a pre-PLY SHARP failure must persist its run debug before the product route reports failure',
);
assert.match(
  page,
  /phase:\s*'splat-ingest'[\s\S]{0,1800}sharpRunDebug:\s*sharpResult\.runDebug[\s\S]{0,1000}lastTrustworthyEvidence:\s*\{[\s\S]{0,1000}schedulerStatus:[\s\S]{0,1800}persistSharpInlineRunReport/,
  'a failure after successful inference must persist the exact SHARP run debug instead of erasing the expensive run',
);
assert.match(
  page,
  /persistSharpInlineSplat\(sharpResult, firingId\)[\s\S]{0,2200}catch \(error\)[\s\S]{0,1800}phase:\s*'splat-ingest'/,
  'PLY ingest must be guarded by a durable post-inference failure report',
);
assert.equal(
  (page.match(/report:\s*\{\s*path:\s*failureReceipt\.path,\s*readUrl:\s*failureReceipt\.readUrl,\s*document:\s*failureReceipt\.document,?\s*\}/g) || []).length,
  2,
  'both inline failure returns must expose the durable receipt through the canonical result.report shape',
);
assert.match(
  page,
  /let foregroundModeActivated = false[\s\S]{0,9000}finally \{[\s\S]{0,1200}delete globalThis\.__kaminosSharpForegroundOpportunity[\s\S]{0,1200}if \(foregroundModeActivated\) await volumePrototype\.setForegroundOpportunityMode\(false\)/,
  'the foreground lease mode and hook must always be released after inline inference',
);
assert.match(
  page,
  /schema: 'sharp-webgpu\.background-heartbeat\.v0'[\s\S]{0,3000}sampleRetention: 'uncapped'/,
  'the inline evidence bridge must preserve same-clock uncapped SHARP duty evidence',
);
assert.match(
  page,
  /const overlapCandidates = \[\.\.\.events, \.\.\.intervals\][\s\S]{0,1500}candidate\.endMs > gapStartMs && candidate\.startMs < gapEndMs/,
  'foreground gap attribution must include reconstructed queue intervals that span an entire gap',
);
assert.match(
  page,
  /overlappedEventRefs/,
  'foreground gap attribution must retain stable event references instead of expanding event payloads into every frame row',
);
assert.doesNotMatch(
  page,
  /\boverlappedEvents,\s*\n/,
  'foreground gap rows must not duplicate complete scheduler event payloads',
);
const persistedEvidenceBuilderSource = page.match(
  /function createSharpInlinePersistedEvidence\([\s\S]*?\n}\n(?=\nasync function )/,
);
assert.ok(
  persistedEvidenceBuilderSource,
  'the inline route must normalize its durable evidence before synchronous report serialization',
);
const createSharpInlinePersistedEvidence = vm.runInNewContext(`(${persistedEvidenceBuilderSource?.[0]})`);
const uniqueTraceEvent = { kind: 'unique-full-trace-event', dutyId: 'trace-duty-1' };
const fullRunDebug = {
  schedulerTelemetry: {
    eventTrace: { events: [uniqueTraceEvent] },
    boundaryAssertions: [{ field: 'decoderKernelAdaptiveRanges', status: 'verified' }],
  },
};
const persistedEvidence = createSharpInlinePersistedEvidence({
  adapterReport: {
    schema: 'kaminos.sharp-inline-product-route-report.v0',
    revision: 'sharp-test-revision',
    effectiveRoute: 'same-browser-product-realm-shared-device',
    sharedGpu: { exactObjectIdentityVerified: true },
    firingId: 'firing-test',
    foregroundOpportunityMode: 'lease-driven',
    foregroundFrameCount: 42,
    requestedScheduler: { mode: 'cooperative' },
    effectiveScheduler: { mode: 'cooperative' },
    breathingRoom: {
      requestedScheduler: { mode: 'cooperative' },
      effectiveScheduler: { mode: 'cooperative' },
      telemetry: fullRunDebug.schedulerTelemetry,
      boundaryAssertions: fullRunDebug.schedulerTelemetry.boundaryAssertions,
    },
    schedulerVerification: fullRunDebug.schedulerTelemetry,
    sharpRunDebug: fullRunDebug,
    backgroundHeartbeat: {
      schema: 'sharp-webgpu.background-heartbeat.v0',
      worstFrameGaps: [{ overlappedEventRefs: ['event:0'] }],
    },
    pipelineScheduler: {
      schema: 'kaminos.pipeline-scheduler-composition.v0',
      schedulerVerification: fullRunDebug.schedulerTelemetry,
    },
  },
  sharpRunDebug: fullRunDebug,
});
const persistedEvidenceJson = JSON.stringify(persistedEvidence);
assert.equal(
  (persistedEvidenceJson.match(/unique-full-trace-event/g) || []).length,
  1,
  'the durable evidence envelope must serialize the complete uncapped trace exactly once',
);
assert.equal(
  persistedEvidence.adapterReport.sharpRunDebugRef,
  '#/authoritativeTrace/sharpRunDebug',
  'the compact adapter projection must point at the one authoritative SHARP trace',
);
assert.equal(
  persistedEvidence.adapterReport.backgroundHeartbeatRef,
  '#/authoritativeTrace/backgroundHeartbeat',
  'the compact adapter projection must point at the one authoritative foreground heartbeat',
);
assert.equal(
  persistedEvidence.pipelineScheduler.schema,
  'kaminos.pipeline-scheduler-composition-reference.v0',
  'the compact scheduler projection must identify itself as a reference rather than impersonating full scheduler evidence',
);
assert.match(
  page,
  /const rawResult = \{[\s\S]{0,5000}inlineSharp:\s*persistedEvidence\.adapterReport/,
  'the actual remembered pipeline result must carry only the compact inline adapter projection',
);
assert.doesNotMatch(
  page,
  /inlineSharp:\s*adapterReport/,
  'the actual remembered pipeline result must not retain the duplicated full live adapter envelope',
);
assert.match(
  page,
  /overlapReferenceSpace:\s*\{[\s\S]{0,800}eventSource:[\s\S]{0,800}intervalSource:/,
  'the durable heartbeat must declare how every compact overlap reference resolves',
);
assert.match(
  page,
  /breathingRoom: \{[\s\S]{0,1000}requestedScheduler: backgroundHeartbeat\.requestedScheduler[\s\S]{0,500}effectiveScheduler: backgroundHeartbeat\.effectiveScheduler[\s\S]{0,500}telemetry: sharpResult\.runDebug\?\.schedulerTelemetry/,
  'the durable adapter must project canonical scheduler telemetry through the established witness surface',
);
assert.match(
  page,
  /revision: inline\.mount\.revision/,
  'the durable adapter must project the runtime-seated SHARP source revision into witness evidence',
);
assert.match(
  page,
  /requestedPipelineId: 'sharp-image-to-splat-live-v0'[\s\S]{0,1000}effectiveRouteConfig:[\s\S]{0,500}routeId: 'sharp-image-to-splat-live-v0'[\s\S]{0,1500}artifacts: \{ splat: artifact \}/,
  'the durable report must preserve the existing pipeline route and artifact projection contract',
);
assert.match(
  page,
  /fetch\('\/api\/ingest-splat'[\s\S]{0,1500}body: sharpResult\.plyBlob/,
  'the real PLY blob must be persisted through the product-owned ingest route',
);
assert.match(
  page,
  /sha256: entry\.sha256[\s\S]{0,300}status: entry\.status[\s\S]{0,300}bytes: entry\.bytes/,
  'the durable artifact must use the server receipt for its real hash, status, and byte count',
);
assert.match(
  page,
  /async function persistSharpInlineRunReport\(\{[\s\S]{0,300}document,[\s\S]{0,300}traceCollections,[\s\S]{0,300}schedulerTelemetryArchive,[\s\S]{0,300}lastTrustworthyOutput,[\s\S]{0,400}persistSharpInlineReportSession\(\{[\s\S]{0,400}document,[\s\S]{0,300}traceCollections/,
  'the compact inline envelope and uncapped trace collections must enter the report-session transport',
);
assert.match(
  page,
  /const reportReceipt = await persistSharpInlineRunReport\(\{[\s\S]{0,400}traceCollections: reportTransport\.collections[\s\S]{0,400}rawResult\.report\.path = reportReceipt\.path[\s\S]{0,400}rawResult\.bundle\.document\.outputRoot = reportReceipt\.outputRoot/,
  'the finished report session must rebind the remembered run to its effective pipeline-runs identity',
);
assert.match(
  page,
  /const reportTransport = compactSharpInlineReportDocument\(\{[\s\S]{0,5000}schedulerTelemetryArchive:\s*sharpResult\.schedulerTelemetryArchive/,
  'the success route must hand the explicit sealed SHARP archive to the uncapped transport',
);
assert.match(
  page,
  /persistSharpInlineRunReport\(\{[\s\S]{0,500}lastTrustworthyOutput:\s*artifact/,
  'terminal report transport must retain the already-ingested PLY identity across archive failure',
);
assert.match(
  page,
  /from '\.\/lib\/sharp-inline-trace-transport\.mjs'/,
  'the product route must use the independently testable nonblocking trace transport',
);
assert.match(
  page,
  /persistSharpInlineReportSession\(\{[\s\S]{0,1200}traceCollections/,
  'the product route must persist uncapped trace collections through a report session',
);
assert.match(
  page,
  /function sharpBreathingRoomSchedulerEventSummary\([\s\S]{0,1600}eventSummary/,
  'the live comparison UI must resolve compact scheduler summary evidence after trace externalization',
);
assert.match(
  page,
  /function sharpBreathingRoomSpnFusionBlocks\([\s\S]{0,1800}sharpBreathingRoomSchedulerEventSummary/,
  'SPN comparison evidence must fall back to the compact summary instead of reporting empty coverage',
);
assert.match(
  page,
  /schedulerEventCount:\s*sharpBreathingRoomSchedulerEventSummary\(run\)\?\.count[\s\S]{0,120}sharpBreathingRoomSchedulerEvents\(run\)\.length/,
  'the comparison card must preserve the exact scheduler event count after trace externalization',
);
assert.doesNotMatch(
  page,
  /body:\s*JSON\.stringify\(\{\s*pipelineId:[\s\S]{0,500}document/,
  'the renderer must not stringify the complete report document into one request body',
);
assert.match(
  page,
  /artifact\?\.source \|\| pipelineRunReadUrlForPath/,
  'the cast loader must consume the persisted inline artifact source instead of projecting a pipeline-run path',
);
assert.match(
  page,
  /pipelineId === 'sharp-image-to-splat-live-v0'[\s\S]{0,1200}runSharpInlineProductRoute/,
  'the Crucible SHARP action must select the inline product-realm route rather than the separate backend process',
);

console.log('SHARP inline product integration contracts passed');
