import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-scale-witness.mjs', import.meta.url), 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.volume\.boundary-splat-scale-witness\.v0/, 'scale witness must publish a stable report schema');
assert.match(witness, /\[1, 4, 16, 25, 64, 100\]/, 'scale witness must run the steward-specified count ladder in order');
assert.match(witness, /sampleBoundarySplatInstanceCostLadder/, 'scale witness must use the runtime GPU ladder rather than infer cost from draw counts');
assert.match(witness, /primeBoundarySplatLiveHistory/, 'scale witness must explicitly prime a throttled browser to a positive live candidate source before timing');
assert.match(witness, /historyPrime/, 'scale witness must preserve live-history priming evidence in its report');
assert.match(witness, /connected-existing/, 'scale witness must record reuse of the persistent browser');
assert.match(witness, /browserContinuity/, 'scale witness must state whether its browser existed continuously or was explicitly reseated before measurement');
assert.match(witness, /reseated-after-original-process-disappeared/, 'scale witness must preserve the actual pre-witness browser recovery boundary');
assert.match(witness, /browserProfilePath/, 'scale witness must identify the replacement browser profile carrying measurement authority');
assert.match(witness, /discoverBrowserProcessIdentity/, 'scale witness must recover effective profile identity when a cached Greenroom route omits the expected profile argument');
assert.match(witness, /browserProcessId/, 'scale witness must bind effective profile evidence to the Chrome parent process');
assert.match(witness, /finalTargetReachable/, 'scale witness must observe final CDP target reachability rather than hard-code browser survival');
assert.match(witness, /pageId:\s*browserPageId/, 'failure browser evidence must preserve the selected page id');
assert.match(witness, /lastTrustworthyEvidence\.composedCapture/, 'late browser failures must preserve completed capture evidence');
assert.match(witness, /lastTrustworthyEvidence\.finalState/, 'late browser failures must preserve the last validated runtime state');
assert.match(witness, /lastTrustworthyEvidence\.ladder\s*=\s*ladder;\s*validateLadder/s, 'rejected timestamp ladders must be preserved before validation');
assert.match(witness, /preserved-open/, 'scale witness must leave the existing browser session open');
assert.match(witness, /failed-before-primary-output/, 'scale witness must write a durable failure report before primary output exists');
assert.match(witness, /stale-or-default-config/, 'scale witness must fail loud when requested composition or instance controls do not become effective');
assert.match(witness, /blank-or-partial-native-capture/, 'scale witness must reject missing or blank visual output');

assert.match(core, /advanceSimulation:\s*false/, 'GPU ladder must label frozen-simulator timing authority explicitly');
assert.match(core, /boundary-splat-live-history-prime-v0/, 'runtime must identify the bounded one-simulator history prime');
assert.match(core, /minimumHistoryFrames/, 'history prime must derive a falsifiable bounded frame target from the configured ring');
assert.match(core, /simStepCountBefore/, 'GPU ladder must record simulator state before serial measurements');
assert.match(core, /simStepCountAfter/, 'GPU ladder must record simulator state after serial measurements');
assert.match(core, /timestampStatus:\s*'available'/, 'GPU ladder must require timestamp-backed stage evidence');
assert.match(core, /compactTimestampWrites/, 'GPU timing must bracket compaction with timestamps on the real compact pass');
assert.match(core, /requiredTimestampIndices/, 'GPU timing must validate only timestamps backed by real passes in frozen mode');
assert.match(page, /boundarySplatFieldLayoutCameraPose/, 'page must own a deterministic camera pose for composed-field routes');
assert.match(page, /boundary-splat-composed-field-camera-v1/, 'camera telemetry must publish the effective composed-field camera identity');
assert.match(page, /requestedEffectiveAgreement/, 'camera telemetry must compare requested and actual post-controls poses');
assert.match(witness, /requestedEffectiveAgreement/, 'scale witness must reject composed-camera requests that were overwritten or clamped');

console.log('boundary splat scale witness contracts passed');
