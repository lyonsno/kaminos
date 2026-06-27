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
assert.match(index, /world_chamber_receipt_url/, 'URL route can load an external world chamber receipt by URL');
assert.match(index, /world_chamber_receipt_root/, 'URL route can select a server-backed receipt root');
assert.match(index, /world_chamber_receipt_path/, 'URL route can select a server-backed receipt path');
assert.match(index, /world-chamber-receipt-source/, 'Worlds tab displays effective receipt source identity');
assert.match(index, /world-chamber-load-error/, 'Worlds tab displays receipt load failures instead of silently falling back');

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
  worldChamberDebugState,
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
assert.equal(normalized.receiptSource.mode, 'embedded_fixture');
assert.equal(normalized.receiptSource.label, 'embedded Kaminos fixture receipt');
assert.equal(normalized.falseLiveClaim, false);
assert.equal(normalized.summary.lerms, 8);
assert.equal(normalized.summary.goins, 2);
assert.equal(normalized.summary.juiceHits, 1);
assert.equal(normalized.summary.carrierDrops, 1);
assert.equal(normalized.summary.terrainSamples, 1);
assert.equal(normalized.intentionallyAbsent.liveFingerJuicePackets, true);
assert.equal(normalized.intentionallyAbsent.liveGoinPhysics, true);
assert.equal(normalized.intentionallyAbsent.liveCrowdAi, true);
assert.equal(normalized.intentionallyAbsent.generatedLermMotion, true);

const palmDaddyComposerReceipt = structuredClone(LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT);
palmDaddyComposerReceipt.phase = 'complete';
palmDaddyComposerReceipt.outputPath = '/tmp/lerms-first-vertical-composer-witness-minion.json';
palmDaddyComposerReceipt.frame.terrainSamples = [
  {
    schema: 'lerms.terrain-sample.v0',
    id: 'terrain-fixture-crown',
    source: palmDaddyComposerReceipt.frame.source,
  },
];
delete palmDaddyComposerReceipt.frame.terrain;
palmDaddyComposerReceipt.frame.carrierDropEvents = palmDaddyComposerReceipt.frame.carrierDrops;
delete palmDaddyComposerReceipt.frame.carrierDrops;
palmDaddyComposerReceipt.summary = {
  schema: 'lerms.first-vertical-summary.v0',
  frameId: 'minion-kaminos-ingestion-smoke',
  authority: 'synthetic_fixture',
  lermCount: 8,
  goinCount: 2,
  juiceHitCount: 1,
  carrierDropCount: 1,
  lermStateCounts: {
    tumbling: 1,
  },
  goinStateCounts: {
    rolling: 1,
  },
};

const externalNormalized = normalizeWorldChamberReceipt(underhill, palmDaddyComposerReceipt, {
  receiptSource: {
    mode: 'external_url',
    requestedUrl: '/api/read?root=scratch&path=lerms-first-vertical-composer-witness.json',
    effectiveUrl: 'http://127.0.0.1:8793/api/read?root=scratch&path=lerms-first-vertical-composer-witness.json',
  },
});
assert.equal(externalNormalized.receiptSource.mode, 'external_url');
assert.equal(externalNormalized.receiptSource.requestedUrl, '/api/read?root=scratch&path=lerms-first-vertical-composer-witness.json');
assert.equal(externalNormalized.receiptSource.effectiveUrl, 'http://127.0.0.1:8793/api/read?root=scratch&path=lerms-first-vertical-composer-witness.json');
assert.equal(externalNormalized.summary.lerms, 8);
assert.equal(externalNormalized.summary.goins, 2);
assert.equal(externalNormalized.summary.juiceHits, 1);
assert.equal(externalNormalized.summary.carrierDrops, 1);
assert.equal(externalNormalized.summary.terrainSamples, 1);
assert.deepEqual(externalNormalized.summary.lermStateCounts, { tumbling: 1 });
assert.deepEqual(externalNormalized.summary.goinStateCounts, { rolling: 1 });

const externalRegistry = createDefaultWorldChambersRegistry({
  lermsUnderhillReceipt: palmDaddyComposerReceipt,
  lermsUnderhillReceiptSource: {
    mode: 'external_url',
    requestedUrl: '/api/read?root=scratch&path=lerms-first-vertical-composer-witness.json',
  },
});
const externalDebug = worldChamberDebugState(externalRegistry);
assert.equal(externalDebug.receiptSource.mode, 'external_url');
assert.equal(externalDebug.usingFixtureFallback, false);
assert.equal(externalDebug.summary.lerms, 8);

const failedRegistry = createDefaultWorldChambersRegistry({
  lermsUnderhillReceiptLoadError: {
    phase: 'loading-world-chamber-receipt',
    requestedUrl: '/api/read?root=scratch&path=missing.json',
    message: 'HTTP 404',
  },
});
const failedDebug = worldChamberDebugState(failedRegistry);
assert.equal(failedDebug.receipt, null);
assert.equal(failedDebug.receiptLoadError.phase, 'loading-world-chamber-receipt');
assert.equal(failedDebug.usingFixtureFallback, false);

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
assert.match(witness, /world-chambers-lerms-underhill-receipt-url/, 'scene witness exposes the external receipt URL world chamber scenario');
assert.match(witness, /kaminosWorldChambersDebugState/, 'scene witness reads the world chamber debug state');
assert.match(witness, /first-vertical-composer\/witness-file/, 'scene witness verifies the effective composer witness route');
assert.match(witness, /synthetic_fixture/, 'scene witness verifies the fixture authority');
assert.match(witness, /receiptSource/, 'scene witness verifies effective receipt source identity');
