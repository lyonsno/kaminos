import assert from 'node:assert/strict';
import {
  FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA,
  FORGE_HOST_SMOKE_CHAMBER_SCHEMA,
  buildForgeHostManifestFromRegistrySnapshot,
  buildForgeHostFixture,
  deriveForgeStationAttention,
  routeForgeHostSmokeOfferToChamber,
  validateForgeHostStationManifest,
} from '../forge-host-core.js';

const manifest = buildForgeHostFixture();

assert.equal(manifest.schema, 'kaminos.forge-host.station-manifest.v0');
assert.equal(manifest.fixtureSource, 'fixture:minion-forge-host-smoke-offers-0628');
assert.ok(manifest.stations.length >= 4, 'fixture includes enough diaulos stations to prove promoted/current/recent posture');

const stationIds = new Set();
for (const station of manifest.stations) {
  assert.match(station.actorId, /^forge-station:/, 'station actor ids are stable host-owned ids');
  assert.ok(!stationIds.has(station.actorId), `duplicate station actor id ${station.actorId}`);
  stationIds.add(station.actorId);
  assert.ok(station.diaulos, 'station preserves diaulos identity');
  assert.ok(station.callSign, 'station preserves operator-facing call sign');
  assert.equal(station.anchor.schema, 'kaminos.forge-host.station-anchor.v0');
  assert.equal(station.anchor.authority, 'host_static_fixture');
  assert.equal(station.visual.schema, 'kaminos.forge-host.station-visual.v0');
  assert.equal(station.attention.schema, 'kaminos.forge-host.station-attention.v0');
  assert.ok(station.smokeOffers.length >= 1, 'each fixture station advertises at least one smoke offer');

  for (const offer of station.smokeOffers) {
    assert.equal(offer.schema, 'kaminos.forge-host.smoke-offer.v0');
    assert.equal(offer.producerDiaulos, station.diaulos);
    assert.ok(offer.targetSurface, 'smoke offer declares a target surface');
    assert.ok(offer.sourceRef, 'smoke offer declares a source ref');
    assert.ok(['live', 'fixture', 'fallback', 'seeded', 'stale'].includes(offer.authority), 'smoke offer authority is explicit');
    assert.notEqual(offer.displayState, 'live', 'fixture manifest must not claim a live display state');
    assert.ok(Array.isArray(offer.downgrades), 'smoke offer downgrade list is machine-readable');
  }
}

const validation = validateForgeHostStationManifest(manifest);
assert.equal(validation.ok, true);
assert.deepEqual(validation.falseAuthorityViolations, []);

const bad = structuredClone(manifest);
bad.stations[0].smokeOffers[0].authority = 'fixture';
bad.stations[0].smokeOffers[0].displayState = 'live';
const badValidation = validateForgeHostStationManifest(bad);
assert.equal(badValidation.ok, false, 'fixture offer claiming live display must fail loud');
assert.match(badValidation.falseAuthorityViolations[0], /fixture.*live/);

const selectedAttention = deriveForgeStationAttention(manifest.stations[0], {
  selectedActorId: manifest.stations[0].actorId,
  cameraPosition: [0, 1.5, 4],
  timeSeconds: 1.25,
});
assert.equal(selectedAttention.mode, 'selected');
assert.equal(selectedAttention.primaryLookTarget, 'camera');
assert.ok(selectedAttention.operatorProximity > 0, 'attention records operator proximity');

const idleAttention = deriveForgeStationAttention(manifest.stations[1], {
  selectedActorId: null,
  cameraPosition: [7, 2, 7],
  timeSeconds: 2.5,
});
assert.ok(['bench', 'wander', 'offer'].includes(idleAttention.primaryLookTarget), 'idle stations look around instead of staring at the camera');

const registrySnapshot = {
  schema: FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA,
  sourceAuthority: 'live_registry',
  loadedAt: '2026-06-29T04:20:00Z',
  endpointRegistry: {
    path: '/tmp/directive-alert-endpoints.json',
    schema: 'epistaxis.directive_alert_endpoints.v1',
    exists: true,
    loaded: true,
  },
  diaulosRegistry: {
    path: '/tmp/diauloi.json',
    schema: 'epistaxis.diaulos-registry.v1',
    exists: true,
    loaded: true,
  },
  endpoints: [
    {
      diaulos: 'wake-and-bake-pit-boss',
      diaulosId: 'dia-wake-fixture',
      status: 'active',
      observedAt: '2026-06-29T04:19:00Z',
      endpoint: {
        cwd: '/Users/noahlyons/dev/lerms',
        kind: 'wezterm-pane',
        pane_id: '37',
        resume: 'codex resume wake-thread',
        thread_id: 'wake-thread',
        tool: 'codex',
      },
      registryStatus: 'active',
      sourceTopoi: ['projects/lerms/topoi/codex-wake-and-bake-pit-boss-0627.md'],
    },
  ],
  warnings: [],
};

const liveManifest = buildForgeHostManifestFromRegistrySnapshot(registrySnapshot, { fixtureManifest: manifest });
assert.equal(liveManifest.schema, 'kaminos.forge-host.station-manifest.v0');
assert.equal(liveManifest.sourceAuthority, 'live_registry');
assert.equal(liveManifest.registrySource.schema, FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA);
assert.equal(liveManifest.stations.length, 1, 'live registry manifest should not promote every fixture row');
assert.equal(liveManifest.stations[0].actorId, 'forge-station:wake-and-bake-pit-boss');
assert.equal(liveManifest.stations[0].sourceAuthority, 'live_registry');
assert.equal(liveManifest.stations[0].diaulosId, 'dia-wake-fixture');
assert.equal(liveManifest.stations[0].status, 'active');
assert.equal(liveManifest.stations[0].anchor.authority, 'host_static_fixture_overlay');
assert.equal(liveManifest.stations[0].smokeOffers[0].authority, 'live');
assert.equal(liveManifest.stations[0].smokeOffers[0].displayState, 'live');
assert.match(liveManifest.stations[0].smokeOffers[0].sourceRef, /directive-alert-endpoints\.json/);
assert.deepEqual(validateForgeHostStationManifest(liveManifest).falseAuthorityViolations, []);
assert.equal(deriveForgeStationAttention(liveManifest.stations[0]).source, 'live_registry');

const liveChamber = routeForgeHostSmokeOfferToChamber(liveManifest.stations[0].smokeOffers[0], liveManifest.stations[0], {
  openedAt: '2026-06-29T08:08:00.000Z',
});
assert.equal(FORGE_HOST_SMOKE_CHAMBER_SCHEMA, 'kaminos.forge-host.smoke-chamber.v0');
assert.equal(liveChamber.schema, FORGE_HOST_SMOKE_CHAMBER_SCHEMA);
assert.equal(liveChamber.routeIdentity, 'forge-host-smoke-offer-route');
assert.equal(liveChamber.stationActorId, liveManifest.stations[0].actorId);
assert.equal(liveChamber.producerDiaulos, liveManifest.stations[0].diaulos);
assert.equal(liveChamber.sourceAuthority, 'live');
assert.equal(liveChamber.displayState, 'live');
assert.equal(liveChamber.sourceOffer.schema, 'kaminos.forge-host.smoke-offer.v0');
assert.equal(liveChamber.targetSurface, liveManifest.stations[0].smokeOffers[0].targetSurface);
assert.equal(liveChamber.targetUrl, liveManifest.stations[0].smokeOffers[0].targetUrl);
assert.match(liveChamber.sourceRef, /directive-alert-endpoints\.json/);
assert.deepEqual(liveChamber.captureAffordances.map(affordance => affordance.id), ['screenshot', 'filmstrip', 'reply']);
assert.deepEqual(liveChamber.routeWarnings, ['not_chat_bridge', 'not_command_execution']);

const lyingOffer = structuredClone(liveManifest.stations[0].smokeOffers[0]);
lyingOffer.authority = 'fallback';
lyingOffer.displayState = 'live';
assert.throws(
  () => routeForgeHostSmokeOfferToChamber(lyingOffer, liveManifest.stations[0]),
  /fallback.*live/i,
  'smoke chamber routing must fail loud when fallback offer claims live routing',
);

const fallbackSnapshot = structuredClone(registrySnapshot);
fallbackSnapshot.sourceAuthority = 'fallback';
fallbackSnapshot.endpoints[0].status = 'fallback';
const fallbackManifest = buildForgeHostManifestFromRegistrySnapshot(fallbackSnapshot, { fixtureManifest: manifest });
assert.equal(fallbackManifest.sourceAuthority, 'fallback');
assert.notEqual(fallbackManifest.stations[0].smokeOffers[0].displayState, 'live', 'fallback registry rows must not display as live');

const lyingSnapshot = structuredClone(registrySnapshot);
lyingSnapshot.sourceAuthority = 'fallback';
lyingSnapshot.endpoints[0].displayState = 'live';
assert.throws(
  () => buildForgeHostManifestFromRegistrySnapshot(lyingSnapshot, { fixtureManifest: manifest }),
  /fallback.*live/i,
  'registry ingestion must fail loud when fallback rows claim live display authority',
);
