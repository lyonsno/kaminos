import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const worldCartridgeCorePath = join(root, 'world-cartridges-core.js');
const worldPath = join(root, 'worlds', 'lerms-terrarium', 'world.json');
const serveSource = readFileSync(join(root, 'serve.py'), 'utf8');

assert.ok(existsSync(worldCartridgeCorePath), 'world-cartridges-core.js exposes the cartridge normalizer');
assert.ok(existsSync(worldPath), 'lerms-terrarium cartridge manifest exists');
assert.match(serveSource, /\/api\/world-cartridges/, 'server exposes world cartridge discovery');

const {
  LERMS_TERRARIUM_CARTRIDGE_ID,
  WORLD_CARTRIDGE_DISCOVERY_ROUTE,
  createWorldCartridgeIndex,
  normalizeWorldCartridgeManifest,
} = await import('../world-cartridges-core.js');

assert.equal(LERMS_TERRARIUM_CARTRIDGE_ID, 'lerms-terrarium');
assert.equal(WORLD_CARTRIDGE_DISCOVERY_ROUTE, '/api/world-cartridges');

const manifest = JSON.parse(readFileSync(worldPath, 'utf8'));
const normalized = normalizeWorldCartridgeManifest(manifest, {
  manifestPath: worldPath,
});
const lermSpecies = normalized.crucibles.find(crucible => crucible.id === 'lerm-species');
assert.ok(lermSpecies, 'lerms-terrarium exposes the lerm-species crucible');

const offer = lermSpecies.smokeOffers.find(item => item.id === 'lerm-species-moving-timeline-smoke-offer');
assert.ok(offer, 'lerm-species exposes a first-party moving-timeline smoke offer');
assert.equal(offer.authority, 'firing_receipt');
assert.equal(offer.outputClass, 'firing_receipt');
assert.equal(offer.targetSurface, 'lerms-moving-timeline-host');
assert.equal(offer.hostRoute, 'kaminos/lerms-moving-timeline-host');
assert.equal(offer.packetSchema, 'lerms.preview-bench-actor-motion-timeline.v0');
assert.equal(offer.packetRoute, 'lerms/preview-bench/actor-motion-timeline-file');
assert.equal(offer.sourceAuthority, 'source-owned-timeline-packet');
assert.equal(offer.sourceTruthAuthority, 'lerms.timelineBehaviorTruth');
assert.ok(offer.downgrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(offer.downgrades.includes('timevarying_payload_not_live_socket_stream'));
assert.doesNotMatch(JSON.stringify(offer), /behavior_engine_truth|live_socket_motion|final_lerm_body_art|goin_physics_authority/);
assert.match(offer.route, /kaminos_lerms_moving_timeline_host=1/);
assert.match(offer.route, /world_chamber=lerms-underhill/);
assert.match(offer.route, /bench=terrain-preview/);
assert.match(offer.route, /lerms_actor_motion_timeline_url=%2Ftests%2Ffixtures%2Flerms-moving-timeline-host-smoke\.json/);

assert.equal(offer.smokeWorkbench.schema, 'kaminos.world-cartridge.smoke-workbench-helper.v0');
assert.equal(offer.smokeWorkbench.routeKind, 'host-surface-smoke-offer-route');
assert.equal(offer.smokeWorkbench.receiptSchema, 'kaminos.host-surface.tools-report.v0');
assert.equal(offer.smokeWorkbench.operatorRoute, offer.route);
assert.deepEqual(offer.smokeWorkbench.operatorSteps, [
  'open_operator_route',
  'inspect_lerms_moving_timeline_host',
  'capture_host_surface_witness',
  'return_source_owned_firing_receipt_or_gap_report',
]);

const index = createWorldCartridgeIndex([manifest], { rootDir: join(root, 'worlds') });
assert.equal(index.schema, 'kaminos.world-cartridges.index.v0');
assert.equal(index.discoveryRoute, '/api/world-cartridges');
assert.equal(index.cartridges[0].id, 'lerms-terrarium');
assert.equal(index.cartridges[0].crucibles.find(crucible => crucible.id === 'lerm-species').smokeOffers[0].id, offer.id);
