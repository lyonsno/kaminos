import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(witness, /--boundary-splat-supervision-dir/, 'witness exposes a direct fixed-candidate supervision output directory');
assert.match(witness, /--boundary-splat-supervision-frames/, 'witness exposes a requested truthful supervision frame count');
assert.match(witness, /--boundary-splat-supervision-step-delta-ms/, 'witness exposes deterministic simulator time spacing between supervision frames');
assert.match(witness, /--boundary-splat-supervision-raw-sidecar/, 'witness exposes native raw sidecar supervision as an explicit requested surface');
assert.match(witness, /--boundary-splat-supervision-min-sim-step/, 'witness exposes an uncapped simulator warmup floor');
assert.match(witness, /--boundary-splat-supervision-operation-timeout-ms/, 'witness exposes a caller-configured per-operation CDP deadline instead of a hidden total batch cap');
assert.match(witness, /boundarySplatSupervisionOperationTimeoutMsRequested/, 'witness preserves the requested supervision operation deadline');
assert.match(witness, /boundarySplatSupervisionOperationTimeoutMsEffective\s*=\s*boundarySplatSupervisionOperationTimeoutMsRequested/, 'witness does not silently clamp a lawful caller deadline below the requested value');
assert.match(witness, /operationTimeoutMs[\s\S]*setTimeout[\s\S]*CDP operation timed out/, 'CDP requests cleanly reject when one protocol operation stops answering');
assert.match(witness, /supervisionWsRequest[\s\S]*operationTimeoutMs:\s*boundarySplatSupervisionOperationTimeoutMsEffective/, 'every supervision CDP request routes through the configured operation deadline');
assert.match(witness, /live-single-browser-sim-step-floor-v0/, 'witness records truthful one-browser warmup authority');
assert.match(witness, /while \(warmupSimStepCount\s*<\s*boundarySplatSupervisionMinSimStep\)/, 'witness warms the live simulator until the requested step floor instead of sleeping blindly');
assert.match(witness, /warmup-progress-stalled|warmup.*stalled/i, 'witness fails loud if simulator warmup stops making progress');
assert.match(witness, /captureBoundarySplatSupervisionFrame/, 'witness invokes the dedicated same-state live capture API');
assert.match(witness, /captureBoundarySidecarRawFrameWithDeadline\?\.\(\{[\s\S]*sameStateCaptureId:\s*\$\{JSON\.stringify\(capture\.sameStateCaptureId\)\}/, 'raw sidecar capture is tied to the candidate and raymarch same-state identity');
assert.ok(witness.includes('deadlineMs: ${JSON.stringify(boundarySplatSupervisionOperationTimeoutMsEffective)}'), 'raw sidecar capture receives the literal browser-owned deadline so a host timeout cannot orphan retained capture state');
assert.match(witness, /boundarySplatSupervisionRawCaptureResponseGraceMs[\s\S]*operationTimeoutMs:\s*boundarySplatSupervisionOperationTimeoutMsEffective\s*\+\s*boundarySplatSupervisionRawCaptureResponseGraceMs/, 'host CDP custody outlives the browser deadline long enough to receive the cleanup-scheduled receipt');
assert.match(witness, /browserSessionDisposition\s*===\s*'poisoned-close-required'[\s\S]*browserSessionPoisoned\s*=\s*true/, 'a non-cancelable raw capture deadline poisons the browser session instead of pretending the page remains reusable');
assert.match(witness, /async function closeBrowserSession\(browserSession, options = \{\}\)[\s\S]*const force\s*=\s*options\.force\s*===\s*true[\s\S]*if \(!force && browserSession\?\.keepBrowserOpen\)\s*\{[\s\S]*kept-open-by-request/, 'forced poison cleanup overrides keep-browser-open while ordinary cleanup preserves it');
assert.match(witness, /async function requestAttachedBrowserClose\(\)[\s\S]*Browser\.close[\s\S]*async function closeBrowserSession[\s\S]*requestAttachedBrowserClose\(\)/, 'poison cleanup closes an attached shared browser through browser-level CDP when no child process handle exists');
assert.match(witness, /closeBrowserSession\(browserSession,\s*\{[\s\S]*force:\s*err\?\.browserSessionPoisoned\s*===\s*true/, 'outer failure custody forces browser teardown when the supervision capture marks the session poisoned');
assert.match(core, /const sameStateCaptureId = options\.sameStateCaptureId[\s\S]*boundarySidecarRawCapture = \{[\s\S]*sameStateCaptureId,[\s\S]*return \{[\s\S]*sameStateCaptureId,/, 'core preserves same-state identity through retained raw sidecar capture metadata');
assert.match(core, /async function captureBoundarySidecarRawFrameWithDeadline[\s\S]*runBoundarySidecarCaptureWithDeadline[\s\S]*captureBoundarySidecarRawFrameWithDeadline,/, 'core publishes the browser-owned deadline wrapper and late-release helper');
assert.match(witness, /for \(let frameIndex = 0; frameIndex < boundarySplatSupervisionFrames; frameIndex \+= 1\)/, 'one browser session captures every requested supervision frame');
assert.match(witness, /frameIndex > 0[\s\S]*sampleFrame\?\.\(\{[\s\S]*advanceSim:\s*true/, 'subsequent supervision frames advance the live simulator explicitly instead of reopening the browser');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.candidates\.f32/, 'multi-frame candidate artifacts have stable distinct names');
assert.match(witness, /sameBrowserSequenceSuitable/, 'supervision report states whether every requested frame came from one live browser sequence');
assert.match(witness, /captureReplay\?\.capture\?\.camera[\s\S]*replayedCaptureCamera\?\.applied\s*!==\s*true/, 'saved-camera supervision fails loud when the camera pose was not applied');
assert.match(witness, /window\.__kaminosBoundarySplatSupervisionCandidates\s*=\s*Uint8Array/, 'candidate payload remains in browser memory for bounded transport chunks');
assert.match(witness, /window\.__kaminosBoundarySplatSupervisionTarget\s*=\s*Uint8Array/, 'raymarch target remains in browser memory for bounded transport chunks');
assert.match(witness, /window\.__kaminosBoundarySplatSupervisionFlowDebug\s*=\s*Uint8Array/, 'same-state flow-debug pixels remain in browser memory for bounded transport chunks');
assert.match(witness, /readBoundarySidecarRawCaptureChunk/, 'witness drains retained raw sidecar fields through the browser API');
assert.match(witness, /for \(let offset = 0; offset < expectedBytes; offset \+= transportChunkBytes\)/, 'raw sidecar transport drains every retained byte without a hidden cap');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.sidecar-structure\.f32/, 'witness materializes stable raw structure filenames');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.sidecar-meta\.f32/, 'witness materializes stable raw meta filenames');
assert.match(witness, /releaseBoundarySidecarRawCapture/, 'witness explicitly releases each retained raw sidecar capture');
assert.match(witness, /finally\s*\{[\s\S]*releaseBoundarySidecarRawCapture/, 'raw sidecar release remains in failure-path custody');
assert.match(witness, /raw sidecar.*exact grid|raw-sidecar.*exact-grid/i, 'witness rejects a raw sidecar grid that is not the requested supervision grid');
assert.match(witness, /for \(let offset = 0; offset < expectedLength; offset \+= transportChunkBytes\)/, 'transport loops over the complete payload without a hidden row cap');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.candidates\.f32/, 'witness materializes exact candidate float rows with stable multi-frame names');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.raymarch\.png/, 'witness materializes native raymarch targets with stable multi-frame names');
assert.match(witness, /frame-\$\{String\(frameIndex\)\.padStart\(3, '0'\)\}\.flow-debug\.png/, 'witness materializes same-state flow-debug auxiliaries with stable multi-frame names');
assert.match(witness, /flow-debug-interface-canvas-capture-v0/, 'flow-debug auxiliary preserves the established shader-debug authority');
assert.match(witness, /controlOverrides:\s*\{\s*flowDebug:\s*1\s*\}/, 'flow-debug auxiliary records the exact diagnostic control override');
assert.match(witness, /hash\(targetBytes\)\s*===\s*hash\(flowDebugBytes\)[\s\S]*pixel-identical to target/, 'witness rejects a mislabeled flow-debug artifact that is byte-identical to the target');
assert.match(witness, /sameStateCaptureId:\s*capture\.sameStateCaptureId/, 'flow-debug corpus custody is tied to the candidate and target same-state identity');
assert.match(core, /boundarySplatSupervisionFireOnlyTargetActive\s*=\s*false;[\s\S]*flowDebug:\s*1,[\s\S]*fixed-candidate-supervision-flow-debug/, 'flow-debug capture disables the direct-flame supervision bypass before rendering the diagnostic');
assert.match(witness, /candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0/, 'witness labels the exact candidate-support-gated intrinsic unit-gain native raymarch target instead of implying stock-body or full-volume authority');
assert.match(witness, /schema:\s*BOUNDARY_SPLAT_SUPERVISION_SCHEMA/, 'witness writes the validated corpus schema');
assert.match(witness, /splatControls:\s*capture\.splatControls/, 'corpus preserves the exact live splat footprint controls for differentiable replay');
assert.match(witness, /live-simulator-frozen-state-candidate-raymarch-v0/, 'witness preserves same-state live authority');
assert.match(witness, /validateBoundarySplatSupervisionCorpus/, 'witness validates the complete artifact set before reporting success');
assert.match(witness, /targetVisualMetrics\s*=\s*measureScreenshot/, 'witness measures the transported raymarch target before accepting it');
assert.match(witness, /targetVisualMetrics\.meanLuma\s*>\s*180/, 'witness rejects globally blown-out raymarch targets using the measured invalid-target boundary');
assert.match(witness, /targetVisualMetrics\.meanLuma\s*<\s*1\.5/, 'witness rejects blank or nearly blank raymarch targets');
assert.match(witness, /targetVisualMetrics\.litPixels\s*<\s*80/, 'witness rejects dark targets whose background-biased mean luma hides missing flame emission');
assert.match(witness, /targetVisualMetrics\.litFraction\s*>\s*0\.72/, 'witness rejects broad slab targets that illuminate nearly the entire sampled viewport');
assert.match(witness, /targetVisualMetrics/, 'witness preserves target visual diagnostics in its corpus receipt');
assert.match(witness, /phase:\s*supervisionPhase/, 'supervision failure reports preserve the last trustworthy phase');
assert.match(witness, /lastTrustworthyEvidence/, 'supervision failure reports preserve the last trustworthy route and simulator evidence');
assert.match(witness, /operationDeadline:[\s\S]*requestedMs:[\s\S]*effectiveMs:/, 'supervision reports state requested and effective operation deadline identity');
assert.match(witness, /supervisionFailureReport/, 'inner supervision evidence survives the outer witness failure report');
assert.match(witness, /const supervisionFailureReport\s*=\s*err\?\.supervisionFailureReport[\s\S]*if \(supervisionFailureReport\) \{[\s\S]*state\s*=\s*supervisionFailureReport\.lastTrustworthyEvidence/, 'a supervision timeout bypasses generic CDP recovery so the outer report cannot hang on the same dead runtime');
assert.match(witness, /error\.supervisionPhase\s*=\s*supervisionPhase/, 'supervision failures carry their exact inner phase through the outer witness');
assert.match(witness, /phase:\s*err\?\.supervisionPhase\s*\|\|\s*phase/, 'outer failure reporting does not overwrite the supervision failure phase');
assert.match(
  witness,
  /rawSidecarReleaseError:\s*err\?\.rawSidecarReleaseError\s*\|\|\s*null/,
  'outer witness failure report preserves a secondary raw sidecar release failure instead of overwriting it',
);

console.log('boundary splat supervision witness contracts passed');
