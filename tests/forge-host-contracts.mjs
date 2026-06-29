import assert from 'node:assert/strict';
import {
  buildForgeHostFixture,
  deriveForgeStationAttention,
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
