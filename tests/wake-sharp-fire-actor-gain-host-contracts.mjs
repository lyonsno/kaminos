import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const selection = readFileSync(
  new URL('../kiln-sharp-fire-actor-selection.json', import.meta.url),
  'utf8',
);

assert.match(
  page,
  /createKilnPromotedFireActorApplication/,
  'the proved SHARP host must mount the promoted FireActor composition',
);
assert.match(
  selection,
  /"basinRevision": "basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95"/,
  'the product host must bind the exact promoted Flamebowl actor revision',
);
assert.match(
  page,
  /decoderKernelAdjustmentGain:\s*0\.375/,
  'the FireActor composition must preserve Wake SHARP adaptive gain 0.375',
);
assert.match(
  witness,
  /resolveHeadlessBrowser/,
  'the combined witness must retain Wake browser resolution',
);
assert.match(
  witness,
  /--remote-debugging-port=0/,
  'the combined witness must let its browser child allocate the CDP port',
);
assert.match(
  witness,
  /DevToolsActivePort/,
  'the combined witness must discover the child-owned CDP session',
);
assert.match(
  witness,
  /fireActorProductEpisode[\s\S]{0,1600}mountId[\s\S]{0,400}actorId[\s\S]{0,400}basinRevision[\s\S]{0,400}packageSha256/,
  'the combined witness must fail loud on exact effective FireActor identity',
);
assert.match(
  page,
  /waitForWakeSharpPromotedFirePresentation[\s\S]*createForegroundKilnHeartbeatEpisode/,
  'the combined host must prove a rendered promoted frame before foreground verification',
);
assert.match(
  page,
  /waitForWakeSharpPromotedFirePresentation\(\{[\s\S]{0,300}timeoutMs = null[\s\S]{0,1200}callerDeadlineMs = timeoutMs === null \? null/,
  'promoted readiness must remain uncapped unless its caller supplies a deadline',
);

const readinessSource = page.match(
  /async function waitForWakeSharpPromotedFirePresentation\([\s\S]*?\n}\n(?=\nasync function beginSharpBreathingRoomKilnFire)/,
)?.[0];
assert.ok(readinessSource, 'the promoted readiness function must remain independently exercisable');
const waitForWakeSharpPromotedFirePresentation = vm.runInNewContext(
  `(${readinessSource})`,
  {
    structuredClone,
    volumePrototype: null,
    performance: { now: () => 0 },
    requestAnimationFrame: callback => callback(),
    wakeSharpPromotedFireFallbackReason: () => null,
  },
);
const firingId = 'firing-reused-adapter';
const loaded = {
  mount: {
    mountId: 'firemount-test',
    actorId: 'actor-test',
    basin: { revision: 'basinrev-test' },
    representation: { splatMode: 'kernel_moment_covariance' },
  },
  packageSha256: 'package-test',
};
const staleReusedState = {
  active: true,
  frameCount: 80,
  simStepCount: 90,
  boundarySplatMode: 'kernel_moment_covariance',
  raymarchSmokePresentationModeEffective: 'on',
  fireEpisodeHooks: {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    firingId,
    status: 'recording',
    frameAdvanceCount: 0,
    simStepAdvanceCount: 0,
  },
};
let nowMs = 0;
await assert.rejects(
  waitForWakeSharpPromotedFirePresentation({
    firingId,
    fireEpisodeHooks: staleReusedState.fireEpisodeHooks,
    loaded,
    readState: () => staleReusedState,
    requestFrame: callback => {
      nowMs += 2;
      callback();
    },
    now: () => nowMs,
    timeoutMs: 1,
  }),
  /timed out waiting for an exact same-firing rendered frame/,
  'reused cumulative counters must not satisfy a new firing before local advancement',
);
const advancedState = structuredClone(staleReusedState);
advancedState.fireEpisodeHooks.frameAdvanceCount = 1;
advancedState.fireEpisodeHooks.simStepAdvanceCount = 1;
const readiness = await waitForWakeSharpPromotedFirePresentation({
  firingId,
  fireEpisodeHooks: advancedState.fireEpisodeHooks,
  loaded,
  readState: () => advancedState,
  timeoutMs: null,
});
assert.equal(readiness.firingId, firingId);
assert.equal(readiness.fireEpisodeHooks.frameAdvanceCount, 1);
assert.equal(readiness.fireEpisodeHooks.simStepAdvanceCount, 1);
