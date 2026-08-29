import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  runWakeSharpFireActorPreflight,
  validateWakeSharpFireActorPreflightState,
} from '../wake-sharp-fire-actor-preflight-witness.mjs';

const expected = {
  phase: 'burning',
  firingId: 'firing-fireactor-preflight-001',
  fireActorProductEpisode: {
    status: 'recording',
    firingId: 'firing-fireactor-preflight-001',
    mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
    actorId: 'wake-kiln-flamebowl-hero',
    basinRevision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
    packageSha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc',
    engine: {
      effectiveSha256: 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab',
    },
    carrier: {
      identity: 'kaminos.wake-sharp-promoted-fire-volume-adapter.v1',
      effectiveSha256: '4b3e12c6a5877443960faa03093cc1c3ad8998d64533935cb8b6df91aef31367',
    },
    sharp: {
      requestedRevision: 'd86691338df56df56b7f3942702c7c8648e9d0f2',
      effectiveRevision: 'd86691338df56df56b7f3942702c7c8648e9d0f2',
      revisionContractStatus: 'matched',
    },
    activation: {
      mode: 'product-route',
      authority: 'same-browser-product-realm-shared-device',
      routeId: 'sharp-image-to-splat-live-v0',
      inferenceRequired: true,
    },
  },
  volumeState: {
    active: true,
    frameCount: 8,
    simStepCount: 8,
    fireEpisodeHooks: {
      identity: 'foreground-kiln-fire-episode-hooks-v0',
      firingId: 'firing-fireactor-preflight-001',
      status: 'recording',
      frameAdvanceCount: 3,
      simStepAdvanceCount: 3,
    },
    boundarySplatMode: 'kernel_moment_covariance',
    boundarySplatFallbackReason: null,
    raymarchSmokePresentationModeEffective: 'on',
    timing: {
      identity: 'wake-sharp-promoted-fire-carrier-timing-v0',
      frameSamples: 7,
      queueTimingAvailable: true,
    },
    liveStageTimingReceipt: {
      status: 'sampled',
      authority: 'same-controls-same-device-separate-diagnostic-submit',
      carrierTimingReset: true,
      profile: {
        timestampStatus: 'available',
        reason: 'timestamp-query-sampled',
        stages: {
          total: { status: 'sampled', ms: 4.5 },
        },
      },
    },
    error: null,
  },
  pixelWitness: {
    projectionIdentity: 'promoted-canvas-raised-over-product-ui',
    width: 960,
    height: 640,
    changedPixels: 20000,
    litPixels: 12000,
  },
};

assert.doesNotThrow(() => validateWakeSharpFireActorPreflightState(expected, {
  expectedSharpRevision: expected.fireActorProductEpisode.sharp.effectiveRevision,
}));
for (const [name, mutate, pattern] of [
  ['wrong firing', value => { value.fireActorProductEpisode.firingId = 'firing-stale'; }, /firing/],
  ['wrong mount', value => { value.fireActorProductEpisode.mountId = `firemount-${'0'.repeat(64)}`; }, /mount/],
  ['wrong engine', value => { value.fireActorProductEpisode.engine.effectiveSha256 = '0'.repeat(64); }, /engine/],
  ['wrong carrier', value => { value.fireActorProductEpisode.carrier.effectiveSha256 = '0'.repeat(64); }, /carrier/],
  ['SHARP fallback', value => { value.fireActorProductEpisode.sharp.revisionContractStatus = 'unpinned'; }, /SHARP/],
  ['wrong SHARP revision', value => { value.fireActorProductEpisode.sharp.effectiveRevision = 'stale'; }, /SHARP/],
  ['renderer fallback', value => { value.volumeState.boundarySplatFallbackReason = 'ordinary-volume'; }, /fallback/],
  ['no frame', value => { value.volumeState.frameCount = 0; }, /frame/],
  ['stale cumulative frames', value => {
    value.volumeState.frameCount = 80;
    value.volumeState.simStepCount = 90;
    value.volumeState.fireEpisodeHooks.frameAdvanceCount = 0;
    value.volumeState.fireEpisodeHooks.simStepAdvanceCount = 0;
  }, /firing-local/],
  ['wrong hook firing', value => {
    value.volumeState.fireEpisodeHooks.firingId = 'firing-stale';
  }, /firing-local/],
  ['blank output', value => { value.pixelWitness.changedPixels = 0; value.pixelWitness.litPixels = 0; }, /blank/],
]) {
  const candidate = structuredClone(expected);
  mutate(candidate);
  assert.throws(
    () => validateWakeSharpFireActorPreflightState(candidate, {
      expectedSharpRevision: expected.fireActorProductEpisode.sharp.effectiveRevision,
    }),
    pattern,
    name,
  );
}

const source = readFileSync(
  resolve(import.meta.dirname, '..', 'wake-sharp-fire-actor-preflight-witness.mjs'),
  'utf8',
);
assert.match(source, /finally\s*\{[\s\S]*writeReport/, 'preflight must report an early failure');
assert.match(
  source,
  /state\?\.volume\?\.error/,
  'first-frame wait must surface an adapter render error instead of degrading it into a timeout',
);
assert.match(
  source,
  /lastObservedState/,
  'preflight failures must retain the last trustworthy browser state',
);
assert.match(source, /Page\.captureScreenshot/, 'preflight must capture the live composed viewport');
assert.match(
  source,
  /promoted-canvas-raised-over-product-ui/,
  'the screenshot must identify its temporary visibility projection instead of counting covered UI as fire pixels',
);
assert.match(
  source,
  /restorePromotedCanvasAfterWitness/,
  'the screenshot visibility projection must restore the live product UI',
);
assert.match(
  source,
  /kaminosSharpBreathingRoomKilnFireDebug\.begin/,
  'preflight must enter the real Wake product firing lifecycle',
);
assert.match(
  source,
  /kaminosSharpBreathingRoomKilnFireDebug\.sampleStageTimings/,
  'preflight must exercise the product carrier GPU stage timing contract',
);
assert.match(
  source,
  /waitForKaminosHostReady\(ws\)[\s\S]*kaminosSharpBreathingRoomKilnFireDebug\.begin/,
  'preflight must not invoke the product firing before the Kaminos scene and ordinary volume host initialize',
);
assert.match(
  source,
  /fireEpisodeHooks:\s*volume\?\.fireEpisodeHooks/,
  'the preflight projection must preserve firing-local renderer advancement',
);
assert.match(
  source,
  /resolveHeadlessBrowser/,
  'preflight browser selection must use the reviewed independent-browser resolver',
);
assert.match(
  source,
  /--remote-debugging-port=0/,
  'the preflight browser child must allocate its own CDP endpoint',
);
assert.match(
  source,
  /DevToolsActivePort/,
  'the preflight must bind CDP to the spawned profile endpoint',
);
assert.match(
  source,
  /browserCleanup/,
  'the preflight report must bind browser stop and profile cleanup evidence',
);
assert.match(source, /profileRemoved/, 'the preflight must report profile removal');
assert.match(
  source,
  /rmSync\(userDataDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
  'the preflight must remove its child-owned browser profile',
);
assert.doesNotMatch(
  source,
  /randomInt\(42000,\s*62000\)|--remote-debugging-port=\$\{port\}/,
  'the preflight must not guess a fixed CDP port',
);
assert.match(
  source,
  /kaminosSharpBreathingRoomKilnFireDebug\.end\('preflight-complete'/,
  'preflight must release the product firing without claiming a completed inference route',
);
assert.doesNotMatch(
  source,
  /runSharpBreathingRoomProfile|runKilnRouteBenchRoute|runSharpInlineProductRoute/,
  'preflight must not start SHARP inference',
);

const failedRunRoot = mkdtempSync(resolve(tmpdir(), 'wake-fireactor-preflight-failure-'));
const preservedReportPath = resolve(failedRunRoot, 'live', 'report.json');
const preservedImagePath = resolve(failedRunRoot, 'live', 'fire.png');
const failedReportPath = resolve(failedRunRoot, 'failures', 'missing-source.json');
mkdirSync(resolve(failedRunRoot, 'live'), { recursive: true });
writeFileSync(preservedReportPath, '{"sentinel":"canonical-report"}\n');
writeFileSync(preservedImagePath, 'canonical-image');
await assert.rejects(
  runWakeSharpFireActorPreflight({
    expectedSharpRevision: '',
    reportPath: preservedReportPath,
    outputPath: preservedImagePath,
    failureReportPath: failedReportPath,
    firingId: 'missing-source',
  }),
  /expected-sharp-revision is required/,
);
assert.equal(
  readFileSync(preservedReportPath, 'utf8'),
  '{"sentinel":"canonical-report"}\n',
  'a failed invocation must not overwrite the canonical success report',
);
assert.equal(
  readFileSync(preservedImagePath, 'utf8'),
  'canonical-image',
  'a failed invocation must not overwrite the canonical success image',
);
const failedReport = JSON.parse(readFileSync(failedReportPath, 'utf8'));
assert.equal(failedReport.ok, false);
assert.equal(failedReport.reportRole, 'firing-specific-failure');
assert.equal(failedReport.failure?.phase, 'launch');
assert.equal(failedReport.primaryOutputWritten, false);
assert.equal(failedReport.screenshotPath, null);

const childFailureRoot = mkdtempSync(resolve(tmpdir(), 'wake-fireactor-preflight-child-'));
try {
  const exitingBrowser = resolve(childFailureRoot, 'exiting-browser');
  const childFailureReport = resolve(childFailureRoot, 'child-failure.json');
  writeFileSync(exitingBrowser, '#!/bin/sh\nexit 7\n');
  chmodSync(exitingBrowser, 0o755);
  await assert.rejects(
    runWakeSharpFireActorPreflight({
      expectedSharpRevision: 'sharp-test-revision',
      chrome: exitingBrowser,
      outputPath: resolve(childFailureRoot, 'should-not-exist.png'),
      reportPath: resolve(childFailureRoot, 'canonical.json'),
      failureReportPath: childFailureReport,
      firingId: 'early-exit-browser',
    }),
    /exited before DevTools endpoint.*7/i,
  );
  const childFailure = JSON.parse(readFileSync(childFailureReport, 'utf8'));
  assert.equal(childFailure.ok, false);
  assert.equal(childFailure.phase, 'browser-launch');
  assert.equal(childFailure.primaryOutputWritten, false);
  assert.equal(childFailure.browser.requested.source, 'cli');
  assert.equal(childFailure.browser.resolution.effective.executable, exitingBrowser);
  assert.equal(childFailure.browser.session, null);
  assert.equal(childFailure.browser.cleanup.processStopped, true);
  assert.equal(childFailure.browser.cleanup.profileRemoved, true);
  assert.equal(existsSync(childFailure.browser.cleanup.profilePath), false);
} finally {
  rmSync(childFailureRoot, { recursive: true, force: true });
}

const exactPreflightRevision = 'b689f485d5d6f6c8868f21ad3d56d17e81cba44a';
const artifactRoot = resolve(
  import.meta.dirname,
  '..',
  'artifacts',
  'wake-sharp-fire-actor-preflight',
);
const liveReportPath = resolve(artifactRoot, 'live', 'report.json');
const liveReport = JSON.parse(readFileSync(liveReportPath, 'utf8'));
assert.equal(liveReport.ok, true, 'canonical preflight report must be successful');
assert.equal(
  liveReport.effectiveRoute,
  liveReport.requestedRoute,
  'canonical preflight report must bind the effective browser route',
);
assert.equal(
  liveReport.requested?.sharpRevision,
  exactPreflightRevision,
  'canonical preflight report must bind the exact SHARP source',
);
assert.equal(
  liveReport.primaryOutputWritten,
  true,
  'canonical preflight report must bind a newly written primary image',
);
assert.ok(liveReport.preflightState, 'canonical preflight report must preserve the validated live state');
assert.equal(
  liveReport.runtimeAuthority?.exactHeadProof,
  false,
  'the sole pre-R1 browser artifact must not impersonate exact-head runtime proof',
);
assert.deepEqual(
  liveReport.runtimeAuthority?.missingFromCapturedProjection,
  ['volumeState.fireEpisodeHooks', 'browser.session', 'browser.cleanup'],
);
assert.equal(
  liveReport.releaseState?.volumeReleaseConfirmed,
  true,
  'canonical preflight report must preserve confirmed release',
);
const liveImagePath = resolve(import.meta.dirname, '..', liveReport.screenshotPath || '');
assert.equal(
  liveImagePath,
  resolve(artifactRoot, 'live', 'fireactor-product-preflight.png'),
  'canonical report must name the canonical preflight image',
);
assert.ok(
  existsSync(liveImagePath) && statSync(liveImagePath).size > 0,
  'canonical preflight image must exist and be non-empty',
);
assert.equal(
  liveReport.screenshotSha256,
  createHash('sha256').update(readFileSync(liveImagePath)).digest('hex'),
  'canonical preflight report must bind the exact committed image bytes',
);

const historicalProductReportPath = resolve(
  import.meta.dirname,
  '..',
  'artifacts',
  'wake-sharp-fire-actor-product',
  'live',
  'report.json',
);
const historicalProductReportBytes = readFileSync(historicalProductReportPath);
const historicalProductReport = JSON.parse(historicalProductReportBytes);
assert.equal(historicalProductReport.reportRole, 'historical-obsolete-failure');
assert.equal(historicalProductReport.currentAuthority, false);
assert.equal(
  historicalProductReport.obsoleteSharpRevision,
  '637f45fe4150e34a36fd2200f08319a964bdbaee',
);
const historicalProductReadme = readFileSync(
  resolve(historicalProductReportPath, '..', '..', 'README.md'),
  'utf8',
);
const historicalProductReportSha256 = createHash('sha256')
  .update(historicalProductReportBytes)
  .digest('hex');
assert.match(
  historicalProductReadme,
  new RegExp(historicalProductReportSha256),
  'the historical product README must publish the exact demoted report bytes',
);

console.log('Wake SHARP FireActor preflight witness contracts verified');
