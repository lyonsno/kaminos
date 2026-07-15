#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const foreground = fs.readFileSync(new URL('../lib/foreground-kiln-heartbeat.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = fs.readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const renderLoop = core.slice(core.indexOf('function render(now)'), core.indexOf('function pumpLookLabFrozenFrame'));
const liveFrame = core.slice(core.indexOf('function renderLiveFrame'), core.indexOf('function stopVolumeRenderOnError'));
const hybridEncoder = core.slice(core.indexOf('function encodeBoundarySplatSmokeHybrid'), core.indexOf('function encodeBoundarySplatTelemetry'));
const holdoverActuator = core.slice(core.indexOf('async function actuateSingleFlameHistoryHoldoverFrame'), core.indexOf('function renderLiveFrame'));
const holdoverRenderer = core.slice(core.indexOf('async function renderBoundarySplatHistorySlotToCanvas'), core.indexOf('function publishPyroDynamicDetail'));
const activeSetter = core.slice(core.indexOf('async setActive(active)'), core.indexOf('debugState()'));
const fireEpisodeCloser = page.slice(page.indexOf('async function endSharpBreathingRoomKilnFire'), page.indexOf('window.kaminosSharpBreathingRoomKilnFireDebug'));

assert.match(
  core,
  /import \{ createKilnFrameStageLedger \} from '\.\/lib\/kiln-frame-stage-ledger\.mjs';/,
  'the runtime must consume the tested causal ledger rather than inventing witness state inline',
);
assert.match(
  core,
  /createKilnFrameStageLedger\(\{[\s\S]{0,300}timeOriginEpochMs:\s*performance\.timeOrigin/,
  'volume stages must share an epoch-alignable monotonic browser clock',
);
assert.match(
  core,
  /beginFireEpisode\(options\) \{[\s\S]{0,700}kilnFrameStageLedger\.begin\(\{ firingId:[\s\S]{0,900}endFireEpisode\(options\) \{[\s\S]{0,500}kilnFrameStageLedger\.end/,
  'the ledger window must be the exact fire episode, not page lifetime or a stale prior firing',
);
assert.match(
  renderLoop,
  /recordPresentationOpportunity[\s\S]*beginFrame\(\{[\s\S]*path:\s*useHoldover \? 'holdover' : 'live'/,
  'each volume RAF must close the prior presentation opportunity and open an actual route-labelled frame',
);
assert.match(
  liveFrame,
  /stageLedgerFrameId[\s\S]*'live-source-encode'[\s\S]*'queue-submit'[\s\S]*finishKilnFrameStage/,
  'live frames must separate source encoding, submission, and exact clock advancement',
);
assert.match(
  hybridEncoder,
  /function encodeBoundarySplatSmokeHybrid\(encoder, view, targetPipeline = hybridCompositorPipeline, options = \{\}\)[\s\S]*'hybrid-splat-encode'[\s\S]*'hybrid-smoke-encode'[\s\S]*'hybrid-resolve-encode'/,
  'both routes must expose the three shared hybrid compositor CPU encode stages',
);
assert.match(
  holdoverActuator,
  /stageLedgerFrameId[\s\S]*setFramePath\(stageLedgerFrameId, 'fallback'[\s\S]*'history-metadata-readback'/,
  'an attempted held frame must expose selector readback and preserve fail-closed effective path truth',
);
assert.match(
  holdoverRenderer,
  /'holdover-pre-render-drain'[\s\S]*'history-metadata-readback'[\s\S]*'queue-submit'[\s\S]*'queue-drain'[\s\S]*'draw-state-readback'/,
  'held frames must expose every known synchronization/readback boundary around the shared compositor',
);
assert.match(
  renderLoop,
  /activeHoldoverRenderPromise\s*=\s*holdoverFramePromise[\s\S]*holdoverFramePromise\.finally/,
  'the runtime must retain the active asynchronous held frame until its full ledger row closes',
);
assert.match(
  activeSetter,
  /state\.active\s*=\s*false[\s\S]*cancelAnimationFrame\(raf\)[\s\S]*await activeHoldoverRenderPromise/,
  'deactivation must prevent another RAF and await the active held frame before returning',
);
assert.match(
  core,
  /async quiesceFireEpisodeFrames\(\)[\s\S]{0,500}fireEpisodeFramesQuiescing\s*=\s*true[\s\S]{0,500}cancelAnimationFrame\(raf\)[\s\S]{0,500}await activeHoldoverRenderPromise/,
  'episode close must have a narrow frame quiescence boundary that does not erase active firing identity',
);
assert.match(
  renderLoop,
  /if \(!state\.active \|\| fireEpisodeFramesQuiescing\) return;[\s\S]*if \(state\.active && !fireEpisodeFramesQuiescing\) raf = requestAnimationFrame\(render\)/,
  'quiescence must reject new volume RAF work before and after an asynchronous held frame',
);
assert.match(
  renderLoop,
  /if \(!result\.ok && state\.active && !fireEpisodeFramesQuiescing\) \{[\s\S]{0,300}renderLiveFrame\(now, \{ preserveContinuityDecision: true, stageLedgerFrameId \}\);[\s\S]{0,200}\} else \{[\s\S]{0,120}finishKilnFrameStage\(stageLedgerFrameId\);/,
  'an in-flight held-frame failure must close without submitting fallback live work after quiescence begins',
);
const quiesceIndex = fireEpisodeCloser.indexOf('await volumePrototype.quiesceFireEpisodeFrames()');
const ledgerCloseIndex = fireEpisodeCloser.indexOf('volumePrototype.endFireEpisode');
assert.ok(
  quiesceIndex >= 0 && ledgerCloseIndex >= 0 && quiesceIndex < ledgerCloseIndex,
  'the page must quiesce an active volume before closing the exact firing ledger',
);
assert.equal(
  fireEpisodeCloser.slice(0, ledgerCloseIndex).includes('setActive(false)'),
  false,
  'episode identity must remain active until the foreground heartbeat and exact ledger close',
);
assert.match(
  core,
  /debugState\(\) \{[\s\S]{0,700}kilnFrameStageLedger:\s*kilnFrameStageLedger\.snapshot\(\{ includeRows: !kilnFrameStageLedgerRecording \}\)/,
  'terminal debug state must retain uncapped causal evidence',
);
assert.match(
  core,
  /recordMainPageKilnRaf\(timestampMs, detail = \{\}\)[\s\S]{0,500}recordEvent\(\{[\s\S]{0,300}stage:\s*'main-page-raf'/,
  'the independent main-page RAF must join the ledger without impersonating the volume RAF',
);
assert.match(
  core,
  /function recordVolumeQueueTiming\(submittedAt, stageLedgerFrameId = null\)[\s\S]{0,1800}recordEvent\(\{[\s\S]{0,300}stage:\s*'queue-drain'[\s\S]{0,400}sampledEveryTwelveFrames:\s*true/,
  'the existing nonblocking live queue probe must join the ledger without adding a new drain',
);
assert.match(
  core,
  /function probeVolumeQueueTiming\(stageLedgerFrameId = null\)[\s\S]{0,1800}recordVolumeQueueTiming\(submittedAt, stageLedgerFrameId\)/,
  'the sampled queue completion must retain the originating frame identity',
);
assert.match(
  foreground,
  /onFrameSample = null/,
  'the foreground heartbeat must accept an exact RAF sample consumer',
);
assert.match(
  foreground,
  /samples\.push\(sample\);[\s\S]{0,120}onFrameSample\?\.\(sample\)/,
  'the foreground heartbeat must offer its real RAF samples to the exact-firing ledger',
);
assert.match(
  page,
  /onFrameSample:\s*sample => volumePrototype\?\.recordMainPageKilnRaf\?\.\(sample\.timestampMs/,
  'the page must wire main-page RAF evidence into the volume ledger',
);
assert.match(
  page,
  /options\.runResult\.kilnFrameStageLedger = fireState\.volumeDebugState\?\.kilnFrameStageLedger/,
  'the page must wire main-page RAF evidence and preserve the completed ledger on the route result',
);
assert.match(
  witness,
  /require-frame-stage-ledger[\s\S]{0,1800}const requireFrameStageLedger = args\.has\('require-frame-stage-ledger'\)/,
  'the causal witness must expose an explicit fail-loud diagnostic mode',
);
assert.match(
  witness,
  /kilnFrameStageFrames:\s*Object\.freeze\(\[\.\.\.\(kilnFrameStageLedger\?\.frames \|\| \[\]\)\]\)/,
  'the browser snapshot must freeze the exact ledger rows before extraction',
);
assert.match(
  witness,
  /label:\s*'kiln frame stage ledger frames'/,
  'the witness must preserve uncapped frame rows through chunked browser extraction',
);
assert.match(
  witness,
  /if \(requireFrameStageLedger\)[\s\S]{0,2800}kaminos\.kiln-frame-stage-ledger\.v0[\s\S]{0,2800}sampleRetention !== 'uncapped'[\s\S]{0,2800}firingId/,
  'diagnostic mode must reject missing, capped, partial, or wrong-firing ledger evidence',
);

console.log('kiln frame stage ledger runtime contracts passed');
