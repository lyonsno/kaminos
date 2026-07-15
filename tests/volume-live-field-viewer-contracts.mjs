import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const viewer = readFileSync(join(root, 'volume-held-field-viewer.html'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const app = readFileSync(join(root, 'index.html'), 'utf8');

assert.doesNotMatch(
  viewer,
  /innerDocument\.body\.appendChild\(canvas\)/,
  'replay must not detach the volume canvas from the native viewport and cover the application shell',
);
assert.match(
  viewer,
  /canvas\.parentElement\?\.id\s*!==\s*'viewport'/,
  'replay fails loud when the renderer is not owned by the native viewport',
);
assert.match(
  viewer,
  /sidebar[\s\S]*getBoundingClientRect\(\)[\s\S]*sidebar-not-visible/,
  'replay verifies that the native sidebar remains visibly mounted',
);
assert.match(
  viewer,
  /kaminosApplyVolumeControlsSnapshot/,
  'replay applies captured controls through the native UI so shown controls equal effective controls',
);
assert.match(
  viewer,
  /volume_field_replay_manifest_sha256[\s\S]*manifestSha256Requested/,
  'inner native shell route is cache-bound to the admitted manifest instead of reusing stale code silently',
);
assert.match(
  app,
  /window\.kaminosApplyVolumeControlsSnapshot[\s\S]*applyVolumeControlsSnapshot\(controlsSnapshot\)[\s\S]*readVolumeControls\(\)/,
  'native app exposes a requested/effective control snapshot bridge for replay',
);

assert.match(core, /checksum-addressed-live-replay-resume-v0/, 'runtime names live replay initialization authority');
assert.match(core, /exact-field-live-replay-application-v0/, 'runtime names live replay application identity');
assert.match(core, /resumeDebugImportedFieldLive/, 'runtime exposes a session-bound live replay transition');
assert.match(
  core,
  /initializationAuthority\s*!==\s*CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY[\s\S]*live-replay-authority-required/,
  'held or selective imports cannot silently become live simulation state',
);
assert.match(
  core,
  /setActive\(active\)[\s\S]*full-field-import-live-resume-api-required/,
  'generic activation cannot bypass the explicit imported-field live replay transition',
);
assert.match(
  core,
  /advanceDebugImportedFieldSteps\(payload = \{\}\)[\s\S]*CHECKSUM_ADDRESSED_LIVE_REPLAY_AUTHORITY[\s\S]*live-replay-requires-native-resume-api/,
  'exact live imports cannot be mutated through the held-state advance API before resume',
);
assert.match(
  core,
  /resumeDebugImportedFieldLive\(payload = \{\}\)[\s\S]*receipt\.importedAdvance[\s\S]*live-replay-import-already-advanced/,
  'live resume defensively rejects any import already mutated through an advance receipt',
);
assert.match(
  core,
  /playbackRequested:\s*'live'[\s\S]*playbackEffective:\s*'live'[\s\S]*renderLoopPaused:\s*false/,
  'live replay transition records requested/effective playback and running loop state',
);
assert.match(
  viewer,
  /params\.get\('playback'\)[\s\S]*manifest\.defaultPlayback[\s\S]*'held'/,
  'viewer preserves held-link compatibility while admitting manifest-declared or explicit live playback',
);
assert.match(viewer, /resumeDebugImportedFieldLive/, 'viewer enters motion through the admitted live replay API');
assert.match(
  viewer,
  /setSelectiveHeadLiveRole\('truthHigh'\)/,
  'viewer preserves the non-DOM selective role explicitly instead of losing it through native control normalization',
);
assert.match(
  viewer,
  /selectiveHeadLiveCompositionEffective\s*===\s*compositionRequested[\s\S]*livePassMatchesComposition/,
  'viewer requires the advancing native loop to apply the requested renderer composition',
);
assert.match(
  viewer,
  /playbackRequested:\s*null[\s\S]*playbackEffective:\s*null[\s\S]*initialSimStepCount:\s*null[\s\S]*effectiveSimStepCount:\s*null/,
  'operator receipt distinguishes requested/effective playback and source/current steps',
);
assert.match(
  viewer,
  /simStepCount[\s\S]*initialSimStepCount[\s\S]*live-replay-step-timeout/,
  'viewer refuses to call replay live until the ordinary simulation loop advances the imported state',
);
assert.match(
  viewer,
  /visibleWaitMs[\s\S]*visibilityState[\s\S]*Waiting for visible tab/,
  'background requestAnimationFrame suspension is reported instead of misdiagnosed as a broken live replay',
);
assert.match(
  viewer,
  /controlSubstitutions:[\s\S]*receipt\.substitutions[\s\S]*controls? normalized/,
  'native control substitutions remain operator-visible in the running replay receipt and status',
);
assert.match(
  viewer,
  /pollLiveReceipt\(\)[\s\S]*livePassMatchesComposition[\s\S]*live-pass-receipt/,
  'running replay fails loud if its applied passes stop matching the advertised composition',
);
assert.match(
  viewer,
  /rerender:[\s\S]*requestViewerRerender[\s\S]*live-native-loop-owns-rerender/,
  'the debug rerender API cannot cancel the native live replay clock',
);

console.log('volume live-field viewer contracts: ok');
