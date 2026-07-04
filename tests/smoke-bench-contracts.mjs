import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const smokeBenchCorePath = join(root, 'smoke-bench-core.js');
const forgeHostCorePath = join(root, 'forge-host-core.js');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(smokeBenchCorePath), 'Smoke Bench core contract exists');
assert.ok(existsSync(forgeHostCorePath), 'Forge Host core exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');

const smokeBench = await import(smokeBenchCorePath);
const forgeHost = await import(forgeHostCorePath);
const indexHtml = readFileSync(indexPath, 'utf8');

assert.equal(smokeBench.KAMINOS_SMOKE_BENCH_OFFER_SCHEMA, 'kaminos.smoke-bench.offer.v0');
assert.equal(smokeBench.KAMINOS_SMOKE_BENCH_PRIMARY_TARGET_SCHEMA, 'kaminos.smoke-bench.primary-target.v0');
assert.equal(smokeBench.KAMINOS_SMOKE_BENCH_ROUTE_SCHEMA, 'kaminos.smoke-bench.route.v0');
assert.equal(smokeBench.KAMINOS_SMOKE_BENCH_SHELL_SCHEMA, 'kaminos.smoke-bench.shell.v0');
assert.equal(typeof smokeBench.createSmokeBenchOffer, 'function');
assert.equal(typeof smokeBench.routeSmokeBenchOfferToTarget, 'function');
assert.equal(typeof smokeBench.normalizeForgeHostOfferForSmokeBench, 'function');

const browserOffer = smokeBench.createSmokeBenchOffer({
  id: 'offer:test:browser',
  producerDiaulos: 'wake-and-bake-pit-boss',
  title: 'Wake Published Witness',
  sourceRef: 'scene-object-witness.mjs#forge-host-published-smoke-result-offer',
  authority: 'published_artifact',
  displayState: 'available',
  freshness: 'fresh_artifact',
  primaryTarget: {
    id: 'target:wake-published-witness',
    kind: 'browser',
    surface: 'smoke-result',
    url: '/fixtures/forge-host-smoke-targets/wake-published-witness.html',
    adapter: {
      id: 'browser-iframe',
      kind: 'browser_iframe',
      acceptancePredicate: 'iframe_loaded_same_origin_target',
    },
  },
  artifacts: [
    { id: 'report', kind: 'report', ref: 'scene-object-witness.mjs#forge-host-published-smoke-result-offer' },
  ],
});

assert.equal(browserOffer.schema, 'kaminos.smoke-bench.offer.v0');
assert.equal(browserOffer.primaryTarget.schema, 'kaminos.smoke-bench.primary-target.v0');
assert.equal(browserOffer.primaryTarget.kind, 'browser');
assert.equal(browserOffer.primaryTarget.adapter.kind, 'browser_iframe');
assert.equal(browserOffer.artifacts[0].kind, 'report');
assert.deepEqual(browserOffer.downgrades, []);

const browserRoute = smokeBench.routeSmokeBenchOfferToTarget(browserOffer, {
  openedAt: '2026-07-03T22:10:00.000Z',
});
assert.equal(browserRoute.schema, 'kaminos.smoke-bench.route.v0');
assert.equal(browserRoute.shellSchema, 'kaminos.smoke-bench.shell.v0');
assert.equal(browserRoute.primaryTarget.id, 'target:wake-published-witness');
assert.equal(browserRoute.adapter.id, 'browser-iframe');
assert.equal(browserRoute.targetUrl, '/fixtures/forge-host-smoke-targets/wake-published-witness.html');
assert.equal(browserRoute.operatorInspectionStatus, 'pending');
assert.ok(browserRoute.routeWarnings.includes('pop_out_escape_not_acceptance'));
assert.ok(browserRoute.routeWarnings.includes('not_chat_bridge'));

const nativeOffer = smokeBench.createSmokeBenchOffer({
  id: 'offer:test:glove-well',
  producerDiaulos: 'greedy-glove-fucker',
  title: 'Glove Well Host Payload',
  sourceRef: 'lerms:glove-well-host-packet.json',
  authority: 'host_payload_fixture',
  displayState: 'available',
  primaryTarget: {
    id: 'target:glove-well-host-payload',
    kind: 'native-host',
    surface: 'glove-well',
    hostPayload: {
      schema: 'lerms.glove-well-host-packet.v0',
      route: 'lerms/glove-well/host-packet',
    },
    adapter: {
      id: 'glove-well',
      kind: 'native_host',
      acceptancePredicate: 'source_owned_primitives_visible',
    },
  },
});
const nativeRoute = smokeBench.routeSmokeBenchOfferToTarget(nativeOffer);
assert.equal(nativeRoute.primaryTarget.kind, 'native-host');
assert.equal(nativeRoute.adapter.kind, 'native_host');
assert.equal(nativeRoute.hostPayload.schema, 'lerms.glove-well-host-packet.v0');
assert.equal(nativeRoute.targetUrl, null);

const streamOffer = smokeBench.createSmokeBenchOffer({
  id: 'offer:test:hand-state',
  producerDiaulos: 'palm-daddy',
  title: 'Hand State Stream',
  sourceRef: 'hand-runtime://state-stream',
  authority: 'live',
  displayState: 'live',
  primaryTarget: {
    id: 'target:hand-state-stream',
    kind: 'stateStream',
    surface: 'hand-state',
    stateStream: {
      schema: 'hand-state.frame.v0',
      route: 'hand-runtime/state-stream',
      url: 'http://127.0.0.1:8787/state',
    },
    adapter: {
      id: 'hand-state-surface',
      kind: 'state_stream',
      acceptancePredicate: 'fresh_hand_state_visible',
    },
  },
});
assert.equal(smokeBench.routeSmokeBenchOfferToTarget(streamOffer).stateStream.schema, 'hand-state.frame.v0');

assert.throws(
  () => smokeBench.createSmokeBenchOffer({
    id: 'offer:test:missing-primary',
    producerDiaulos: 'bad-producer',
    title: 'Missing Target',
    sourceRef: 'bad',
    authority: 'fixture',
    primaryTarget: null,
  }),
  /primaryTarget/i,
  'offer without primaryTarget must fail loud',
);

assert.throws(
  () => smokeBench.createSmokeBenchOffer({
    id: 'offer:test:bad-preview',
    producerDiaulos: 'bad-producer',
    title: 'Preview Is Not Authority',
    sourceRef: 'bad',
    authority: 'fixture',
    displayState: 'live',
    primaryTarget: {
      id: 'target:bad',
      kind: 'browser',
      surface: 'preview',
      url: '/bad.html',
      adapter: { id: 'browser-iframe', kind: 'browser_iframe', acceptancePredicate: 'iframe_loaded_same_origin_target' },
    },
  }),
  /fixture.*live/i,
  'fixture/fallback offers must not claim live display',
);

assert.throws(
  () => smokeBench.createSmokeBenchOffer({
    id: 'offer:test:link-out',
    producerDiaulos: 'bad-producer',
    title: 'Link Out Only',
    sourceRef: 'bad',
    authority: 'published_artifact',
    primaryTarget: {
      id: 'target:link-out',
      kind: 'native-host',
      surface: 'finger-juice',
      url: '/old-route.html',
      adapter: { id: 'popout', kind: 'link_out', acceptancePredicate: 'operator_clicked_external_tab' },
    },
  }),
  /link.?out.*not.*acceptance/i,
  'link-out-only route must not satisfy a native Smoke Bench target',
);

const fixtureManifest = forgeHost.buildForgeHostFixture();
const fixtureStation = fixtureManifest.stations.find(station =>
  station.smokeOffers.some(offer => offer.schema === 'kaminos.forge-host.smoke-offer.v0')
);
const fixtureOffer = fixtureStation.smokeOffers.find(offer => offer.schema === 'kaminos.forge-host.smoke-offer.v0');
const normalizedFixture = smokeBench.normalizeForgeHostOfferForSmokeBench(fixtureOffer, fixtureStation);
assert.equal(normalizedFixture.schema, 'kaminos.smoke-bench.offer.v0');
assert.equal(normalizedFixture.legacyForgeHostOffer.schema, 'kaminos.forge-host.smoke-offer.v0');
assert.equal(normalizedFixture.primaryTarget.surface, fixtureOffer.targetSurface);
assert.equal(normalizedFixture.primaryTarget.adapter.id, 'browser-iframe');

const chamber = forgeHost.routeForgeHostSmokeOfferToChamber(fixtureOffer, fixtureStation, {
  openedAt: '2026-07-03T22:12:00.000Z',
});
assert.equal(chamber.smokeBench.schema, 'kaminos.smoke-bench.route.v0');
assert.equal(chamber.smokeBench.primaryTarget.schema, 'kaminos.smoke-bench.primary-target.v0');
assert.equal(chamber.primaryTarget.id, chamber.smokeBench.primaryTarget.id);
assert.equal(chamber.adapter.id, chamber.smokeBench.adapter.id);

assert.match(indexHtml, /data-kaminos-smoke-bench-shell-schema="kaminos\.smoke-bench\.shell\.v0"/, 'Kaminos shell exposes Smoke Bench shell schema identity');
assert.match(indexHtml, /id="forge-smoke-target-viewer"/, 'Forge Host mounts embedded Smoke Bench target viewer');
assert.match(indexHtml, /kaminosSmokeBenchDebugState/, 'browser exposes Smoke Bench debug state for witnesses');
assert.match(indexHtml, /pop_out_escape_not_acceptance/, 'shell preserves pop-out as escape hatch, not acceptance');
