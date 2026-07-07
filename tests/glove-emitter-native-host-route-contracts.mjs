import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const worldPath = join(root, 'worlds', 'lerms-terrarium', 'world.json');
const indexPath = join(root, 'index.html');
const mainPath = join(root, 'kaminos-main.js');
const hostCorePath = join(root, 'glove-well-host-core.js');
const sceneWitnessPath = join(root, 'scene-object-witness.mjs');
const hostSurfaceWitnessPath = join(root, 'host-surface-witness.mjs');

function read(path) {
  return readFileSync(path, 'utf8');
}

function findGloveEmitterOffer(world) {
  for (const crucible of world.crucibles || []) {
    for (const offer of crucible.smokeOffers || []) {
      if (offer.id === 'glove-emitter-native-host-smoke-offer') {
        return { crucible, offer };
      }
    }
  }
  throw new Error('lerms-terrarium missing glove-emitter-native-host-smoke-offer');
}

const world = JSON.parse(read(worldPath));
const { crucible, offer } = findGloveEmitterOffer(world);
const operator = new URL(offer.route, 'http://127.0.0.1:18157/index.html');
const target = new URL(offer.targetUrl || '', 'http://127.0.0.1:18157/index.html');

assert.equal(crucible.id, 'glove-emitter', 'offer must stay owned by the Glove Emitter crucible');
assert.equal(offer.sourceRole, 'glove-well-source', 'offer must preserve Glove Well source role');
assert.equal(offer.expectedReceipt, 'firing_receipt', 'offer must advertise the Greedy firing receipt expectation');
assert.equal(operator.searchParams.get('kaminos_forge_host'), 'live', 'operator route must remain the Forge Host receipt route');
assert.equal(
  operator.searchParams.get('forge_host_smoke_offer'),
  'glove-emitter-native-host-smoke-offer',
  'operator route must open the Glove Emitter smoke chamber by offer id',
);
assert.ok(
  target.searchParams.get('kaminos_glove_well_host') === '1'
    || target.searchParams.has('glove_well_host_url')
    || target.searchParams.has('glove_well_host_path'),
  'Glove Emitter offer targetUrl must target the native Glove Well host surface, not a recursive Forge Host route card',
);
assert.notEqual(
  target.searchParams.get('forge_host_smoke_offer'),
  'glove-emitter-native-host-smoke-offer',
  'Glove Emitter offer targetUrl must not recurse into its own Forge Host offer',
);
assert.match(offer.targetUrl || '', /glove_well_host_live=(1|true)/, 'targetUrl must preserve live Glove Well polling intent');
assert.match(offer.targetUrl || '', /glove_well_host_(url|path)=/, 'targetUrl must carry the source-owned Glove Well packet route');

const indexSource = read(indexPath);
const runtimeSource = existsSync(mainPath) ? read(mainPath) : indexSource;
const sceneWitnessSource = read(sceneWitnessPath);
const hostSurfaceWitnessSource = read(hostSurfaceWitnessPath);

assert.ok(existsSync(hostCorePath), 'Kaminos must ship the Glove Well host adapter core in this branch');
assert.match(indexSource, /id="glove-well-host-operator-panel"/, 'Kaminos app shell must expose the Glove Well host operator panel');
assert.match(runtimeSource, /function gloveWellHostRouteFromParams/, 'Kaminos runtime must parse Glove Well host route params');
assert.match(
  runtimeSource,
  /function activateKaminosGloveWellHostRouteFromParams/,
  'Glove Well route activation must be re-runnable separately from one-time event listener wiring',
);
assert.match(runtimeSource, /window\.kaminosGloveWellHostDebugState/, 'Kaminos runtime must expose Glove Well host debug state for witnesses');
assert.match(runtimeSource, /window\.kaminosStartGloveWellHostLive/, 'Kaminos runtime must expose live Glove Well polling control');
assert.match(indexSource, /kaminos_glove_well_host/, 'Kaminos app shell must recognize native Glove Well host-only routes');
assert.match(indexSource, /function captureForgeHostInlineHostState/, 'Forge Host receipt capture must inspect embedded native host state');
assert.match(indexSource, /embeddedHost/, 'Forge Host receipt must carry embedded native host state evidence');
assert.match(indexSource, /kaminosGloveWellHostDebugState/, 'Forge Host receipt must know how to read Glove Well host iframe state');
assert.match(
  sceneWitnessSource,
  /forge-host-glove-emitter-native-host-smoke/,
  'scene witness must exercise the Glove Emitter native-host smoke route',
);
assert.match(
  sceneWitnessSource,
  /kaminosGloveWellHostDebugState/,
  'scene witness must read native Glove Well host state, not only the Forge Host route card',
);
assert.doesNotMatch(
  sceneWitnessSource,
  /effectiveUrl\s*=\s*await evaluate\(ws,\s*'location\.href'\)/,
  'scene witness must not block on page Runtime.evaluate before it records route evidence',
);
assert.match(
  hostSurfaceWitnessSource,
  /glove-well-host-canvas/,
  'host-surface witness must sample the native Glove Well canvas instead of the generic WebGPU canvas',
);
