import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  WAKE_SHARP_FIRE_ACTOR_PRODUCT_EPISODE_SCHEMA,
  beginWakeSharpFireActorProductEpisode,
  completeWakeSharpFireActorProductEpisode,
} from '../kiln-sharp-promoted-fire-actor-composition.mjs';

const root = resolve(import.meta.dirname, '..');
const selection = JSON.parse(readFileSync(
  resolve(root, 'kiln-sharp-fire-actor-selection.json'),
  'utf8',
));

const exact = {
  mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
  actorId: 'wake-kiln-flamebowl-hero',
  basinRevision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
  packageSha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc',
  engineSha256: 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab',
  carrierIdentity: 'kaminos.wake-sharp-promoted-fire-volume-adapter.v1',
  carrierSha256: '9654565c662782d22a3d2d3917cbec139715eeafccff3c1b4050d6f80797ba6d',
};

assert.equal(selection.schema, 'kaminos.wake-sharp-fire-actor-selection.v1');
assert.equal(selection.status, 'selected');
assert.deepEqual(selection.expected, exact);
assert.equal(
  selection.mountUrl,
  './artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/mount.json',
);
assert.deepEqual(selection.productRoute, {
  routeId: 'sharp-image-to-splat-live-v0',
  authority: 'same-browser-product-realm-shared-device',
  inferenceRequired: true,
});

const loaded = {
  schema: 'kaminos.kiln.promoted-fire-actor-load.v1',
  status: 'verified',
  packageSha256: exact.packageSha256,
  mount: {
    mountId: exact.mountId,
    actorId: exact.actorId,
    basin: {
      revision: exact.basinRevision,
      handle: 'big-raymarch-hero-flamebowl-cotangent-covariance',
      sourceCommit: 'dcf2ee18a8ed726efde5bf2ae4a8e0f8cd804c10',
    },
    policy: {
      policyId: 'firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17',
    },
    representation: {
      composition: 'smoke-raymarch-under-splats-v0',
      rendererIdentity: 'exact-basin-selective-head-live-v0',
      splatMode: 'kernel_moment_covariance',
    },
  },
};
const application = {
  schema: 'kaminos.kiln.promoted-fire-actor-application.v1',
  status: 'requested',
  mountId: exact.mountId,
  policyId: loaded.mount.policy.policyId,
  basinRevision: exact.basinRevision,
  runtimeControls: {
    'volume-resolution': 128,
    'volume-steps': 130,
    'volume-adaptive-rays': 0.5,
    'volume-render-scale': 0.25,
  },
  presentation: {
    raymarchSmoke: 'on',
    boundarySplats: 'on',
    flameContinuity: 'live-every-frame',
  },
};
const engineIdentity = {
  schema: 'kaminos.kiln.promoted-fire-engine.v1',
  sourceCommit: 'ef85ee89e63fe2276c951e7c401cd719d62bf3ce',
  sourcePath: 'volume-core.js',
  consumerPath: 'kiln-promoted-fire-volume-core.js',
  sha256: exact.engineSha256,
  effectiveSha256: exact.engineSha256,
};
const carrierIdentity = {
  identity: exact.carrierIdentity,
  consumerPath: 'kiln-sharp-promoted-fire-volume-adapter.mjs',
  sha256: exact.carrierSha256,
  effectiveSha256: exact.carrierSha256,
};
const sharpMount = {
  registered: true,
  expectedRevision: 'd86691338df56df56b7f3942702c7c8648e9d0f2',
  revision: 'd86691338df56df56b7f3942702c7c8648e9d0f2',
  revisionMatchesExpectation: true,
  revisionContractStatus: 'matched',
  moduleExists: true,
  weightsExists: true,
};
const firingId = 'firing-promoted-product-001';

function rendererEpisode(status, exactFiringId = firingId) {
  return {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
    authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
    firingId: exactFiringId,
    generation: 1,
    status,
    routeIdentity: {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'wake-sharp-promoted-fire-volume-adapter-v1',
      volumeScene: 'crucible-volume-scene',
      flameRendererIdentity: 'fireactor-promoted-volume-v1',
      learnedModelIdentity: 'fireactor-9b70310e',
      fallbackReason: null,
      compositionRequested: 'hybrid-smoke',
      compositionEffective: 'hybrid-smoke',
      compositionFallbackReason: null,
    },
  };
}

const episode = beginWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  application,
  engineIdentity,
  carrierIdentity,
  sharpMount,
  firingId,
  requireSharpDutyCorrelation: true,
  rendererEpisode: rendererEpisode('recording'),
});
assert.equal(episode.schema, WAKE_SHARP_FIRE_ACTOR_PRODUCT_EPISODE_SCHEMA);
assert.equal(episode.status, 'recording');
assert.equal(episode.firingId, firingId);
assert.equal(episode.mountId, exact.mountId);
assert.equal(episode.actorId, exact.actorId);
assert.equal(episode.basinRevision, exact.basinRevision);
assert.equal(episode.packageSha256, exact.packageSha256);
assert.equal(episode.engine.effectiveSha256, exact.engineSha256);
assert.equal(episode.carrier.identity, exact.carrierIdentity);
assert.equal(episode.carrier.effectiveSha256, exact.carrierSha256);
assert.equal(episode.sharp.requestedRevision, sharpMount.expectedRevision);
assert.equal(episode.sharp.effectiveRevision, sharpMount.revision);
assert.equal(episode.activation.mode, 'product-route');
assert.equal(episode.activation.inferenceRequired, true);
assert.equal(episode.activation.routeId, selection.productRoute.routeId);
assert.equal(episode.evidenceRequirements.sharpDutyCorrelation, true);
assert.deepEqual(episode.foregroundHookIdentity, {
  identity: rendererEpisode('recording').identity,
  evidenceSource: rendererEpisode('recording').evidenceSource,
  authority: rendererEpisode('recording').authority,
  generation: 1,
  routeIdentity: rendererEpisode('recording').routeIdentity,
});

const completed = completeWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  episode,
  rendererEpisode: rendererEpisode('complete'),
  foregroundHeartbeat: {
    schema: 'kaminos.foreground-kiln-heartbeat.v0',
    status: 'verified',
    firingId,
    sharpDutyCorrelation: { status: 'verified', firingId },
  },
  sharpReport: {
    schema: 'kaminos.sharp-inline-product-route-report.v0',
    status: 'real',
    firingId,
    revision: sharpMount.revision,
    effectiveRoute: selection.productRoute.authority,
    sharedGpu: { exactObjectIdentityVerified: true },
  },
  effectivePresentation: {
    mountId: exact.mountId,
    actorId: exact.actorId,
    basinRevision: exact.basinRevision,
    packageSha256: exact.packageSha256,
    policyId: loaded.mount.policy.policyId,
    composition: loaded.mount.representation.composition,
    rendererIdentity: loaded.mount.representation.rendererIdentity,
    splatMode: loaded.mount.representation.splatMode,
    smokePresentation: 'on',
    fallbackReason: null,
  },
});
assert.equal(completed.status, 'completed');
assert.equal(completed.firingId, firingId);
assert.equal(completed.sharp.effectiveRevision, sharpMount.revision);
assert.equal(completed.sharp.sharedGpuExactObjectIdentityVerified, true);
assert.equal(completed.effectivePresentation.fallbackReason, null);
assert.equal(completed.evidence.foregroundHeartbeatStatus, 'verified');
assert.equal(completed.evidence.sharpDutyCorrelationStatus, 'verified');

const baselineEpisode = beginWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  application,
  engineIdentity,
  carrierIdentity,
  sharpMount,
  firingId: 'firing-promoted-baseline-001',
  requireSharpDutyCorrelation: false,
  rendererEpisode: rendererEpisode('recording', 'firing-promoted-baseline-001'),
});
const baselineCompleted = completeWakeSharpFireActorProductEpisode({
  selection,
  loaded,
  episode: baselineEpisode,
  rendererEpisode: rendererEpisode('complete', baselineEpisode.firingId),
  foregroundHeartbeat: {
    schema: 'kaminos.foreground-kiln-heartbeat.v0',
    status: 'verified',
    firingId: baselineEpisode.firingId,
    sharpDutyCorrelation: null,
  },
  sharpReport: {
    schema: 'kaminos.sharp-inline-product-route-report.v0',
    status: 'real',
    firingId: baselineEpisode.firingId,
    revision: sharpMount.revision,
    effectiveRoute: selection.productRoute.authority,
    sharedGpu: { exactObjectIdentityVerified: true },
  },
  effectivePresentation: {
    ...completed.effectivePresentation,
    mountId: baselineEpisode.mountId,
    actorId: baselineEpisode.actorId,
    basinRevision: baselineEpisode.basinRevision,
    packageSha256: baselineEpisode.packageSha256,
  },
});
assert.equal(baselineCompleted.evidence.sharpDutyCorrelationStatus, 'not-required');

assert.throws(
  () => beginWakeSharpFireActorProductEpisode({
    selection,
    loaded: {
      ...loaded,
      mount: { ...loaded.mount, mountId: `firemount-${'a'.repeat(64)}` },
    },
    application,
    engineIdentity,
    carrierIdentity,
    sharpMount,
    firingId,
    requireSharpDutyCorrelation: true,
    rendererEpisode: rendererEpisode('recording'),
  }),
  /selected mount identity mismatch/,
  'a self-consistent but unselected actor mount must not enter the product route',
);
assert.throws(
  () => beginWakeSharpFireActorProductEpisode({
    selection,
    loaded,
    application,
    engineIdentity: { ...engineIdentity, effectiveSha256: 'b'.repeat(64) },
    carrierIdentity,
    sharpMount,
    firingId,
    requireSharpDutyCorrelation: true,
    rendererEpisode: rendererEpisode('recording'),
  }),
  /promoted engine identity mismatch/,
  'a different renderer source must not impersonate the selected product actor',
);
assert.throws(
  () => beginWakeSharpFireActorProductEpisode({
    selection,
    loaded,
    application,
    engineIdentity,
    carrierIdentity: { ...carrierIdentity, effectiveSha256: 'c'.repeat(64) },
    sharpMount,
    firingId,
    requireSharpDutyCorrelation: true,
    rendererEpisode: rendererEpisode('recording'),
  }),
  /promoted carrier identity mismatch/,
  'a substituted product carrier must not impersonate the selected mounted route',
);
assert.throws(
  () => beginWakeSharpFireActorProductEpisode({
    selection,
    loaded,
    application,
    engineIdentity,
    carrierIdentity,
    sharpMount: {
      ...sharpMount,
      expectedRevision: null,
      revisionMatchesExpectation: null,
      revisionContractStatus: 'unpinned',
    },
    firingId,
    requireSharpDutyCorrelation: true,
    rendererEpisode: rendererEpisode('recording'),
  }),
  /SHARP revision contract mismatch/,
  'the product episode must not convert an unpinned runtime fallback into exact evidence',
);
assert.throws(
  () => completeWakeSharpFireActorProductEpisode({
    selection,
    loaded,
    episode,
    rendererEpisode: rendererEpisode('complete', 'firing-from-another-run'),
    foregroundHeartbeat: {
      schema: 'kaminos.foreground-kiln-heartbeat.v0',
      status: 'verified',
      firingId,
      sharpDutyCorrelation: { status: 'verified', firingId },
    },
    sharpReport: {
      schema: 'kaminos.sharp-inline-product-route-report.v0',
      status: 'real',
      firingId,
      revision: sharpMount.revision,
      effectiveRoute: selection.productRoute.authority,
      sharedGpu: { exactObjectIdentityVerified: true },
    },
    effectivePresentation: completed.effectivePresentation,
  }),
  /renderer completion mismatch/,
  'a completed fire episode from another firing must not close this product run',
);

const page = readFileSync(resolve(root, 'index.html'), 'utf8');
assert.match(page, /from '\.\/kiln-sharp-promoted-fire-actor-composition\.mjs'/);
const resourceLoaderSource = page.match(
  /async function loadWakeSharpFireActorResources\(\)[\s\S]*?\n}\n/,
)?.[0] || '';
assert.match(
  resourceLoaderSource,
  /verifyWakeSharpPromotedFireEngine\([\s\S]*loadKilnPromotedFireActor\(/,
  'the product resource load must jointly verify the selected actor and exact promoted engine bytes',
);
const activationSource = page.match(
  /async function activateWakeSharpPromotedFireVolume\([\s\S]*?\n}\n/,
)?.[0] || '';
assert.match(
  activationSource,
  /createWakeSharpPromotedFireGpuContext\(\)[\s\S]*createWakeSharpPromotedFireVolumeAdapter\(/,
  'the promoted carrier must create the exact product GPU identity shared with SHARP',
);
const applicationAdapterSource = page.match(
  /function applyWakeSharpFireActorApplication\([\s\S]*?\n}\n/,
)?.[0] || '';
assert.doesNotMatch(
  applicationAdapterSource,
  /\[\.\.\.application\.domControls,\s*\.\.\.application\.rendererControls\]/,
  'product-only renderer policy must not require research-cockpit DOM controls',
);
assert.match(
  applicationAdapterSource,
  /for \(const control of application\.domControls\)/,
  'authored basin DOM controls must remain fail-loud at the consumer boundary',
);
const beginSource = page.match(
  /async function beginSharpBreathingRoomKilnFire\([\s\S]*?\n}\n(?=\nasync function confirmSharp)/,
)?.[0] || '';
assert.match(
  beginSource,
  /loadSharpInlineProductRuntime\(\)[\s\S]*loadWakeSharpFireActorResources\(\)[\s\S]*activateWakeSharpPromotedFireVolume\(/,
  'the real product firing must verify SHARP and FireActor resources before activating the promoted engine',
);
assert.match(
  beginSource,
  /beginWakeSharpFireActorProductEpisode\(/,
  'Wake must bind the promoted actor episode to the real SHARP firing lifecycle',
);
const endSource = page.match(
  /async function endSharpBreathingRoomKilnFire\([\s\S]*?\n}\n(?=\nwindow\.kaminosSharp)/,
)?.[0] || '';
assert.match(
  endSource,
  /completeWakeSharpFireActorProductEpisode\(/,
  'Wake must close the promoted actor through the real SHARP result and heartbeat',
);
assert.match(
  endSource,
  /options\.runResult\.fireActorProductReceipt\s*=/,
  'the durable SHARP result must carry the exact promoted actor receipt',
);
assert.match(
  page,
  /sampleStageTimings:\s*\(\)\s*=>\s*volumePrototype\?\.sampleLiveStageTimings\?\.\(\)/,
  'the inhabited product route must expose truthful same-device stage timing on the promoted carrier',
);

console.log('Wake SHARP promoted FireActor product contract verified');
