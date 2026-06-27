import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="worlds"/, 'sidebar exposes a Worlds tab');
assert.match(index, /id="tab-worlds"/, 'Worlds tab content is present');
assert.match(index, /world-chambers-core\.js/, 'index imports the world chambers substrate');
assert.match(index, /kaminosWorldChambersDebugState/, 'index exposes a world chamber debug surface');
assert.match(index, /lerms-underhill/, 'index names the LERMS Underhill chamber');
assert.match(index, /first-vertical-composer\/witness-file/, 'index preserves the Palm Daddy composer witness route');
assert.match(index, /synthetic_fixture/, 'index labels the LERMS evidence authority as synthetic fixture');
assert.match(index, /integrated fixture evidence; not a live first vertical/, 'index does not overclaim the first vertical fixture');
assert.match(index, /liveFingerJuicePackets/, 'index preserves intentionally absent live finger-juice packets');
assert.match(index, /Forge Rail/, 'index exposes the Forge Rail chamber affordance');
assert.match(index, /world_chamber/, 'URL route can open a world chamber without manual tab clicking');

const corePath = join(root, 'world-chambers-core.js');
assert.ok(existsSync(corePath), 'world-chambers-core.js exists');

const coreSource = readFileSync(corePath, 'utf8');
assert.match(coreSource, /kaminos\.world-chambers\.registry\.v0/, 'world chamber registry names a stable schema');
assert.match(coreSource, /kaminos\.world-chamber\.descriptor\.v0/, 'world chamber descriptors name a stable schema');
assert.match(coreSource, /lerms\.source-truth\.v0/, 'LERMS source-truth schema is preserved');
assert.match(coreSource, /lerms\.terrain-sample\.v0/, 'LERMS terrain schema is preserved');
assert.match(coreSource, /lerms\.lerm-state\.v0/, 'LERMS lerm schema is preserved');
assert.match(coreSource, /lerms\.goin-state\.v0/, 'LERMS goin schema is preserved');
assert.match(coreSource, /lerms\.juice-hit-event\.v0/, 'LERMS juice-hit schema is preserved');
assert.match(coreSource, /lerms\.carrier-drop-event\.v0/, 'LERMS carrier-drop schema is preserved');
assert.match(coreSource, /lerms\.first-vertical-frame\.v0/, 'LERMS first vertical frame schema is preserved');
assert.match(coreSource, /lerms\.first-vertical-summary\.v0/, 'LERMS first vertical summary schema is preserved');
assert.match(coreSource, /cc\/palm-daddy-first-vertical-composer-0627@98a100f/, 'Palm Daddy branch provenance is recorded');

const {
  WORLD_CHAMBER_DESCRIPTOR_SCHEMA,
  WORLD_CHAMBER_REGISTRY_SCHEMA,
  LERMS_UNDERHILL_CHAMBER_ID,
  LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
  createDefaultWorldChambersRegistry,
  normalizeWorldChamberReceipt,
} = await import('../world-chambers-core.js');

assert.equal(WORLD_CHAMBER_REGISTRY_SCHEMA, 'kaminos.world-chambers.registry.v0');
assert.equal(WORLD_CHAMBER_DESCRIPTOR_SCHEMA, 'kaminos.world-chamber.descriptor.v0');
assert.equal(LERMS_UNDERHILL_CHAMBER_ID, 'lerms-underhill');

const registry = createDefaultWorldChambersRegistry();
assert.equal(registry.schema, WORLD_CHAMBER_REGISTRY_SCHEMA);
assert.equal(registry.activeChamberId, 'lerms-underhill');
assert.equal(registry.chambers.length, 1);

const [underhill] = registry.chambers;
assert.equal(underhill.schema, WORLD_CHAMBER_DESCRIPTOR_SCHEMA);
assert.equal(underhill.id, 'lerms-underhill');
assert.equal(underhill.route, 'first-vertical-composer/witness-file');
assert.equal(underhill.expectedAuthority, 'synthetic_fixture');
assert.equal(underhill.evidenceStatus, 'integrated_fixture_only');
assert.equal(underhill.command, 'npm run witness:composer -- --out /tmp/lerms-first-vertical-composer-witness.json');
assert.deepEqual(underhill.postures, ['inspect', 'stage', 'inhabit', 'forge']);
assert.ok(underhill.acceptedSchemas.includes('lerms.first-vertical-frame.v0'));
assert.ok(underhill.acceptedSchemas.includes('lerms.first-vertical-summary.v0'));
assert.ok(underhill.acceptedSchemas.includes('lerms.source-truth.v0'));
assert.equal(underhill.forgeRail.id, 'forge-rail');

const normalized = normalizeWorldChamberReceipt(underhill, LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT);
assert.equal(normalized.chamberId, 'lerms-underhill');
assert.equal(normalized.route, 'first-vertical-composer/witness-file');
assert.equal(normalized.authority, 'synthetic_fixture');
assert.equal(normalized.authorityNote, 'integrated fixture evidence; not a live first vertical');
assert.equal(normalized.falseLiveClaim, false);
assert.equal(normalized.summary.lerms, 8);
assert.equal(normalized.summary.goins, 2);
assert.equal(normalized.summary.juiceHits, 1);
assert.equal(normalized.summary.carrierDrops, 1);
assert.equal(normalized.intentionallyAbsent.liveFingerJuicePackets, true);
assert.equal(normalized.intentionallyAbsent.liveGoinPhysics, true);
assert.equal(normalized.intentionallyAbsent.liveCrowdAi, true);
assert.equal(normalized.intentionallyAbsent.generatedLermMotion, true);

assert.throws(
  () => normalizeWorldChamberReceipt(underhill, {
    ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
    frame: {
      ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT.frame,
      source: { ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT.frame.source, authority: 'live_simulation' },
    },
  }),
  /fixture evidence cannot claim live first vertical authority/,
  'fixture route must fail loud if it claims live simulation evidence',
);

assert.throws(
  () => normalizeWorldChamberReceipt(underhill, {
    ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
    route: 'demo/fallback',
  }),
  /route mismatch/,
  'wrong receipt route must fail loud',
);

assert.throws(
  () => normalizeWorldChamberReceipt(underhill, {
    ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
    chamberId: 'demo-world',
  }),
  /chamber mismatch/,
  'wrong chamber id must fail loud',
);

assert.throws(
  () => normalizeWorldChamberReceipt(underhill, {
    ...LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
    ok: false,
    phase: 'composing-first-vertical-frame',
  }),
  /receipt is not ok/,
  'failed composer witness cannot be displayed as chamber evidence',
);

const witnessPath = join(root, 'scene-object-witness.mjs');
const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /world-chambers-lerms-underhill/, 'scene witness exposes the LERMS Underhill world chamber scenario');
assert.match(witness, /kaminosWorldChambersDebugState/, 'scene witness reads the world chamber debug state');
assert.match(witness, /first-vertical-composer\/witness-file/, 'scene witness verifies the effective composer witness route');
assert.match(witness, /synthetic_fixture/, 'scene witness verifies the fixture authority');
