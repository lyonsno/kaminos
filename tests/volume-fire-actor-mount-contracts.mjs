import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  FIRE_ACTOR_EPISODE_SCHEMA,
  FIRE_ACTOR_MOUNT_SCHEMA,
  FIRE_ACTOR_POLICY_SCHEMA,
  beginFireActorEpisode,
  completeFireActorEpisode,
  mountPromotedFireActor,
} from '../volume-fire-actor-mount.mjs';

const root = resolve(import.meta.dirname, '..');
const handle = 'big-raymarch-hero-flamebowl-cotangent-covariance';
const revision = 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95';
const stableRef = `${handle}@${revision}`;
const channelPath = join(root, 'artifacts', 'basin-promotions', handle, 'current.json');
const trackedConsumerRoot = join(root, 'artifacts', 'basin-promotions', handle, 'consumers', 'wake-kiln-preview');
const scratch = mkdtempSync(join(tmpdir(), 'kaminos-fire-actor-mount-'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const policy = {
  simulation: { gridResolution: 128 },
  smoke: { renderScale: 0.25, raySteps: 130, adaptiveRays: 0.5, enabled: true },
  splats: { enabled: true },
  scheduling: { flameContinuity: 'live-every-frame' },
};
const consumer = {
  id: 'wake-kiln-crucible',
  surface: 'firing-station',
  anchor: 'crucible-firing-mouth',
};
const transform = {
  position: [0, -0.74, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

try {
  const outPath = join(scratch, 'wake-kiln-fire-actor.json');
  const first = mountPromotedFireActor({
    channelPath,
    handle,
    revision,
    settingsStorePath: join(scratch, 'settings'),
    origin: 'http://127.0.0.1:8398',
    outPath,
    actorId: 'wake-kiln-flamebowl-hero',
    consumer,
    transform,
    policy,
  });

  assert.equal(first.ok, true);
  assert.equal(first.mount.schema, FIRE_ACTOR_MOUNT_SCHEMA);
  assert.equal(first.mount.status, 'mounted');
  assert.match(first.mount.mountId, /^firemount-[a-f0-9]{64}$/);
  assert.equal(first.mount.basin.stableRef, stableRef);
  assert.equal(first.mount.basin.revision, revision);
  assert.equal(first.mount.basin.authoringSnapshotPreserved, true);
  assert.equal(first.mount.policy.schema, FIRE_ACTOR_POLICY_SCHEMA);
  assert.equal(first.mount.policy.requested.smoke.renderScale, 0.25);
  assert.equal(first.mount.policy.effective.smoke.renderScale, 0.25);
  assert.equal(first.mount.policy.requested.simulation.gridResolution, 128);
  assert.equal(first.mount.policy.basinRevisionChanged, false);
  assert.equal(first.mount.consumer.id, consumer.id);
  assert.equal(first.mount.consumer.anchor, consumer.anchor);
  assert.deepEqual(first.mount.transform, transform);
  assert.deepEqual(first.mount.runtimeApplication.transform, { translate: transform.position, scale: 1 });
  assert.equal(first.mount.activationContract.operatorPreviewRequiresInference, false);
  assert.equal(first.mount.activationContract.routeEpisodeRequiresExplicitRouteRef, true);
  assert.equal(first.mount.activationContract.placementContract, 'world-up-translate-uniform-scale-v1');
  assert.equal(first.mount.sourcePackage.sha256, 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc');
  assert.equal(existsSync(outPath), true);
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).mountId, first.mount.mountId);

  const lowerCost = mountPromotedFireActor({
    channelPath,
    handle,
    revision,
    settingsStorePath: join(scratch, 'settings'),
    origin: 'http://127.0.0.1:8398',
    outPath: join(scratch, 'wake-kiln-fire-actor-low.json'),
    actorId: 'wake-kiln-flamebowl-hero',
    consumer,
    transform,
    policy: {
      ...policy,
      simulation: { gridResolution: 64 },
      smoke: { ...policy.smoke, renderScale: 0.15, raySteps: 64 },
    },
  });
  assert.equal(lowerCost.mount.basin.stableRef, first.mount.basin.stableRef);
  assert.equal(lowerCost.mount.basin.revision, first.mount.basin.revision);
  assert.notEqual(lowerCost.mount.policy.policyId, first.mount.policy.policyId);
  assert.notEqual(lowerCost.mount.mountId, first.mount.mountId);
  assert.equal(lowerCost.mount.policy.requested.smoke.renderScale, 0.15, 'policy values must not snap or round');

  const reseated = mountPromotedFireActor({
    channelPath,
    handle,
    revision,
    settingsStorePath: join(scratch, 'reseated-settings'),
    origin: 'http://127.0.0.1:18400',
    outPath: join(scratch, 'wake-kiln-fire-actor-reseated.json'),
    actorId: 'wake-kiln-flamebowl-hero',
    consumer,
    transform,
    policy,
  });
  assert.equal(reseated.mount.mountId, first.mount.mountId, 'runtime endpoint must not mutate mount identity');
  assert.equal(reseated.mount.policy.policyId, first.mount.policy.policyId);
  assert.notEqual(reseated.mount.loader.targetUrl, first.mount.loader.targetUrl);

  assert.throws(
    () => mountPromotedFireActor({
      channelPath,
      handle,
      revision,
      settingsStorePath: join(scratch, 'rotated-settings'),
      origin: 'http://127.0.0.1:8398',
      outPath: join(scratch, 'rotated.json'),
      actorId: 'unsupported-rotated-actor',
      consumer,
      transform: { ...transform, rotation: [0, 0.5, 0] },
      policy,
    }),
    /world-up placement only/,
  );
  assert.throws(
    () => mountPromotedFireActor({
      channelPath,
      handle,
      revision,
      settingsStorePath: join(scratch, 'nonuniform-settings'),
      origin: 'http://127.0.0.1:8398',
      outPath: join(scratch, 'nonuniform.json'),
      actorId: 'unsupported-nonuniform-actor',
      consumer,
      transform: { ...transform, scale: [1, 2, 1] },
      policy,
    }),
    /requires uniform scale/,
  );

  const episode = beginFireActorEpisode({
    mount: first.mount,
    episodeId: 'wake-kiln-preview-001',
    activation: {
      mode: 'operator-preview',
      authority: 'operator-selected-preview',
      inferenceRequired: false,
    },
  });
  assert.equal(episode.schema, FIRE_ACTOR_EPISODE_SCHEMA);
  assert.equal(episode.status, 'recording');
  assert.equal(episode.mountId, first.mount.mountId);
  assert.equal(episode.activation.mode, 'operator-preview');
  assert.equal(episode.activation.inferenceRequired, false);
  assert.equal(episode.activation.routeRef, null);

  const completed = completeFireActorEpisode({
    mount: first.mount,
    episode,
    effectivePresentation: {
      mountId: first.mount.mountId,
      episodeId: episode.episodeId,
      policyId: first.mount.policy.policyId,
      basinRevision: revision,
      composition: first.mount.representation.composition,
      rendererIdentity: first.mount.representation.rendererIdentity,
      fallbackReason: null,
    },
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.inferenceRan, false);
  assert.equal(completed.effectivePresentation.fallbackReason, null);

  assert.throws(
    () => completeFireActorEpisode({
      mount: first.mount,
      episode: { ...episode, episodeId: 'different-episode' },
      effectivePresentation: {
        mountId: first.mount.mountId,
        episodeId: episode.episodeId,
        policyId: first.mount.policy.policyId,
        basinRevision: revision,
        composition: first.mount.representation.composition,
        rendererIdentity: first.mount.representation.rendererIdentity,
        fallbackReason: null,
      },
    }),
    /episode identity mismatch/,
  );
  assert.throws(
    () => beginFireActorEpisode({
      mount: first.mount,
      episodeId: 'dishonest-preview',
      activation: {
        mode: 'operator-preview',
        authority: 'operator-selected-preview',
        inferenceRequired: true,
      },
    }),
    /operator preview cannot require inference/,
  );

  const failurePath = join(scratch, 'wrong-revision.json');
  assert.throws(
    () => mountPromotedFireActor({
      channelPath,
      handle,
      revision: `basinrev-${'0'.repeat(64)}`,
      settingsStorePath: join(scratch, 'wrong-settings'),
      origin: 'http://127.0.0.1:8398',
      outPath: failurePath,
      actorId: 'wrong-revision',
      consumer,
      transform,
      policy,
    }),
    /mount revision mismatch/,
  );
  assert.equal(existsSync(failurePath), true, 'pre-mount failure must leave a durable report');
  const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'basin-package-mount');
  assert.equal(failure.requested.revision, `basinrev-${'0'.repeat(64)}`);
  assert.equal(failure.lastTrustworthyEvidence.channelPath, channelPath);

  const trackedMountPath = join(trackedConsumerRoot, 'mount.json');
  const trackedMount = JSON.parse(readFileSync(trackedMountPath, 'utf8'));
  assert.equal(trackedMount.schema, FIRE_ACTOR_MOUNT_SCHEMA);
  assert.equal(trackedMount.status, 'mounted');
  assert.equal(trackedMount.basin.stableRef, stableRef);
  assert.equal(trackedMount.mountId, 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7');
  assert.equal(trackedMount.policy.policyId, 'firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17');
  assert.equal(trackedMount.policy.basinRevisionChanged, false);
  assert.deepEqual(trackedMount.runtimeApplication.controls, {
    resolution: 128,
    raySteps: 130,
    adaptiveRays: 0.5,
    renderScale: 0.25,
  });
  const trackedPackagePath = resolve(dirname(trackedMountPath), trackedMount.sourcePackage.relativePath);
  const trackedSettingsPath = resolve(dirname(trackedMountPath), trackedMount.settingsPreset.storeRelativePath);
  assert.equal(existsSync(trackedPackagePath), true, 'tracked source package locator must resolve');
  assert.equal(existsSync(trackedSettingsPath), true, 'tracked settings locator must resolve');
  assert.equal(sha256(trackedPackagePath), trackedMount.sourcePackage.sha256);
  assert.doesNotMatch(JSON.stringify(trackedMount), /\/(?:private\/)?tmp\//, 'tracked mount must not retain author worktree paths');

  console.log('promoted fire actor mount and inference-independent Kiln episode contracts verified');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
