import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  KILN_PROMOTED_FIRE_ACTOR_APPLICATION_SCHEMA,
  KILN_PROMOTED_FIRE_ACTOR_PREVIEW_SCHEMA,
  beginKilnPromotedFireActorPreview,
  completeKilnPromotedFireActorPreview,
  createKilnPromotedFireActorApplication,
  loadKilnPromotedFireActor,
} from '../kiln-promoted-fire-actor-consumer.mjs';

const root = resolve(import.meta.dirname, '..');
const mountPath = join(
  root,
  'artifacts',
  'basin-promotions',
  'big-raymarch-hero-flamebowl-cotangent-covariance',
  'consumers',
  'wake-kiln-preview',
  'mount.json',
);
const mountUrl = pathToFileURL(mountPath).toString();

function fileFetch(input) {
  const url = new URL(input);
  if (url.protocol !== 'file:') return Promise.resolve(new Response('unsupported', { status: 404 }));
  try {
    return Promise.resolve(new Response(readFileSync(url, 'utf8'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  } catch {
    return Promise.resolve(new Response('missing', { status: 404 }));
  }
}

const loaded = await loadKilnPromotedFireActor({ mountUrl, fetchImpl: fileFetch });
assert.equal(loaded.status, 'verified');
assert.equal(loaded.mount.mountId, 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7');
assert.equal(loaded.mount.policy.policyId, 'firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17');
assert.equal(loaded.mount.basin.revision, 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95');
assert.equal(loaded.packageSha256, loaded.mount.sourcePackage.sha256);
assert.equal(loaded.settingsPresetArtifact.presetId, loaded.mount.settingsPreset.presetId);
assert.equal(loaded.resources.mountUrl, mountUrl);
assert.equal(loaded.resources.packageUrl, new URL(loaded.mount.sourcePackage.relativePath, mountUrl).toString());
assert.equal(loaded.resources.settingsPresetUrl, new URL(loaded.mount.settingsPreset.storeRelativePath, mountUrl).toString());

const application = createKilnPromotedFireActorApplication(loaded);
assert.equal(application.schema, KILN_PROMOTED_FIRE_ACTOR_APPLICATION_SCHEMA);
assert.equal(application.status, 'requested');
assert.equal(application.mountId, loaded.mount.mountId);
assert.equal(application.policyId, loaded.mount.policy.policyId);
assert.equal(application.domControls.length, 186);
assert.equal(application.rendererControls.length, 3);
assert.deepEqual(application.runtimeControls, {
  'volume-resolution': 128,
  'volume-steps': 130,
  'volume-adaptive-rays': 0.5,
  'volume-render-scale': 0.25,
});
assert.deepEqual(application.presentation, {
  raymarchSmoke: 'on',
  boundarySplats: 'on',
  flameContinuity: 'live-every-frame',
});
assert.deepEqual(application.productTransform, { translate: [0, 0, 0], scale: 1 });

const preview = await beginKilnPromotedFireActorPreview({
  loaded,
  episodeId: 'wake-kiln-operator-preview-001',
  rendererEpisode: {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    firingId: 'wake-kiln-operator-preview-001',
    status: 'recording',
  },
});
assert.equal(preview.schema, KILN_PROMOTED_FIRE_ACTOR_PREVIEW_SCHEMA);
assert.equal(preview.status, 'recording');
assert.equal(preview.activation.mode, 'operator-preview');
assert.equal(preview.activation.inferenceRequired, false);
assert.equal(preview.activation.routeRef, null);
assert.equal(preview.mountId, loaded.mount.mountId);

const completed = await completeKilnPromotedFireActorPreview({
  loaded,
  preview,
  rendererEpisode: {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    firingId: preview.episodeId,
    status: 'completed',
  },
  effectivePresentation: {
    mountId: loaded.mount.mountId,
    episodeId: preview.episodeId,
    policyId: loaded.mount.policy.policyId,
    basinRevision: loaded.mount.basin.revision,
    composition: loaded.mount.representation.composition,
    rendererIdentity: loaded.mount.representation.rendererIdentity,
    fallbackReason: null,
    inferenceRan: false,
    routeRef: null,
  },
});
assert.equal(completed.status, 'completed');
assert.equal(completed.effectivePresentation.inferenceRan, false);

const tamperedMount = JSON.parse(readFileSync(mountPath, 'utf8'));
tamperedMount.policy.requested.smoke.renderScale = 0.5;
tamperedMount.policy.effective.smoke.renderScale = 0.5;
await assert.rejects(
  () => loadKilnPromotedFireActor({
    mountUrl,
    fetchImpl: async input => new URL(input).toString() === mountUrl
      ? new Response(JSON.stringify(tamperedMount), { status: 200 })
      : fileFetch(input),
  }),
  /policy identity mismatch/,
);

await assert.rejects(
  () => completeKilnPromotedFireActorPreview({
    loaded,
    preview,
    rendererEpisode: {
      identity: 'foreground-kiln-fire-episode-hooks-v0',
      firingId: preview.episodeId,
      status: 'completed',
    },
    effectivePresentation: {
      mountId: loaded.mount.mountId,
      episodeId: preview.episodeId,
      policyId: loaded.mount.policy.policyId,
      basinRevision: loaded.mount.basin.revision,
      composition: loaded.mount.representation.composition,
      rendererIdentity: loaded.mount.representation.rendererIdentity,
      fallbackReason: 'ordinary-volume-fallback',
      inferenceRan: false,
      routeRef: null,
    },
  }),
  /fallback/,
);

const source = readFileSync(join(root, 'index.html'), 'utf8');
assert.match(source, /from '\.\/kiln-promoted-fire-actor-consumer\.mjs'/);
assert.match(source, /async function beginPromotedKilnFirePreview\(\)/);
assert.match(source, /window\.kaminosPromotedFireActorPreview/);
assert.doesNotMatch(
  source.match(/async function beginPromotedKilnFirePreview\(\)[\s\S]*?\n}\n/)?.[0] || '',
  /runSharpInlineProductRoute|loadSharpInlineProductRuntime|requestedRoute/,
  'operator preview must not start or impersonate SHARP',
);

console.log('Wake Kiln promoted fire actor consumer contract verified');
