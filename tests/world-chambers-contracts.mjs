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
  WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA,
  WORLD_CHAMBER_REGISTRY_SCHEMA,
  LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE,
  LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA,
  LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA,
  LERMS_PREVIEW_WITNESS_SCHEMA,
  LERMS_TERRAIN_PREVIEW_BENCH_ID,
  LERMS_UNDERHILL_CHAMBER_ID,
  LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT,
  LERMS_PREVIEW_CAMERA_PRESETS,
  createDefaultWorldChambersRegistry,
  createLermsPreviewBenchState,
  normalizeWorldChamberReceipt,
  worldChamberDebugState,
} = await import('../world-chambers-core.js');

assert.equal(WORLD_CHAMBER_REGISTRY_SCHEMA, 'kaminos.world-chambers.registry.v0');
assert.equal(WORLD_CHAMBER_DESCRIPTOR_SCHEMA, 'kaminos.world-chamber.descriptor.v0');
assert.equal(WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA, 'kaminos.world-chamber.preview-bench.v0');
assert.equal(LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA, 'lerms.preview-bench-actor-motion-payload.v0');
assert.equal(LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA, 'lerms.preview-bench-actor-motion-state.v0');
assert.equal(LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE, 'lerms/preview-bench/actor-motion-payload-file');
assert.equal(LERMS_PREVIEW_WITNESS_SCHEMA, 'kaminos.lerms-preview-witness.v0');
assert.equal(LERMS_UNDERHILL_CHAMBER_ID, 'lerms-underhill');
assert.equal(LERMS_TERRAIN_PREVIEW_BENCH_ID, 'terrain-preview');
assert.deepEqual(
  LERMS_PREVIEW_CAMERA_PRESETS.map(preset => preset.id),
  ['overview-oblique', 'topographic-top', 'route-follow', 'actor-close', 'terrain-cross-section', 'operator-free-camera'],
);

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
assert.equal(underhill.previewBenches.length, 1);
assert.equal(underhill.previewBenches[0].schema, WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA);
assert.equal(underhill.previewBenches[0].id, 'terrain-preview');
assert.equal(underhill.previewBenches[0].operatorLabel, 'LERMS Preview Bench');
assert.equal(underhill.previewBenches[0].posture, 'inspect');
assert.deepEqual(underhill.previewBenches[0].routeParams, {
  world_chamber: 'lerms-underhill',
  posture: 'inspect',
  bench: 'terrain-preview',
});

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

const benchState = createLermsPreviewBenchState(registry, {
  posture: 'inspect',
  benchId: 'terrain-preview',
  cameraId: 'overview-oblique',
});
assert.equal(benchState.schema, LERMS_PREVIEW_WITNESS_SCHEMA);
assert.equal(benchState.hostDescriptor, 'kaminos.world-chamber.preview-bench.v0');
assert.equal(benchState.chamberId, 'lerms-underhill');
assert.equal(benchState.benchId, 'terrain-preview');
assert.equal(benchState.posture, 'inspect');
assert.equal(benchState.route, 'world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview');
assert.equal(benchState.source.authority, 'synthetic_fixture');
assert.equal(benchState.source.fallbackMode, 'embedded_fixture');
assert.equal(benchState.badges.source, 'synthetic_fixture');
assert.equal(benchState.badges.freshness, 'fixture');
assert.equal(benchState.badges.fallback, 'embedded_fixture');
assert.equal(benchState.activeCamera.id, 'overview-oblique');
assert.deepEqual(benchState.cameraPresets.map(preset => preset.id), LERMS_PREVIEW_CAMERA_PRESETS.map(preset => preset.id));
assert.equal(benchState.terrain.sampleCount, 16);
assert.equal(benchState.schemaPreservation.frame, 'lerms.first-vertical-frame.v0');
assert.equal(benchState.schemaPreservation.terrain, 'lerms.terrain-sample.v0');
assert.equal(benchState.actorMotion, null);

const actorMotionReport = {
  ok: true,
  schema: 'lerms.preview-bench-actor-motion-payload-report.v0',
  route: 'lerms/preview-bench/actor-motion-payload-file',
  reportPath: '/tmp/lerms-preview-bench-motion-payload-0628.json',
  payload: {
    schema: 'lerms.preview-bench-actor-motion-payload.v0',
    route: 'lerms/preview-bench/actor-motion-payload-file',
    acceptanceSurface: {
      kind: 'kaminos_preview_bench_payload',
      worldChamberId: 'lerms-underhill',
      posture: 'inspect',
      bench: 'terrain-preview',
      routeQuery: 'world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview',
      expectedHost: 'kaminos_workbench_kiln_preview_bench',
    },
    rejectedSurfaces: [{
      route: 'browser/?schnoz_3d=1',
      acceptanceSurface: false,
      reason: 'debug-only',
    }],
    frame: {
      schema: 'lerms.first-vertical-frame.v0',
      source: {
        schema: 'lerms.source-truth.v0',
        authority: 'live_simulation',
        route: 'lerms/schnoz-lerm-simulation/witness-file/frame',
        frameId: 'schnoz-lerm-live-sim-frame-001',
        sampleAgeMs: 16,
      },
      terrainSamples: [{ schema: 'lerms.terrain-sample.v0', id: 'terrain-crown-right' }],
      lerms: [
        { schema: 'lerms.lerm-state.v0', id: 'schnoz-carrier', state: 'carrying_goin' },
        { schema: 'lerms.lerm-state.v0', id: 'schnoz-hit-carrier', state: 'hit_reacting' },
      ],
      goins: [{ schema: 'lerms.goin-state.v0', id: 'goin-carried-001' }],
      juiceHits: [{ schema: 'lerms.juice-hit-event.v0', id: 'hit-001' }],
      carrierDrops: [],
    },
    sourceTruthUpgrade: {
      schema: 'lerms.first-vertical-source-truth-upgrade.v0',
      accepted: true,
      effectiveAuthority: 'live_simulation',
      predicates: {
        hasHitToDropChain: true,
      },
    },
    actorMotion: [
      {
        schema: 'lerms.preview-bench-actor-motion.v0',
        actorId: 'schnoz-carrier',
        species: 'red',
        role: 'carrier_actor',
        state: 'carrying_goin',
        terrainSampleId: 'terrain-crown-right',
        selectedCliplet: {
          schema: 'kaminos.generated-motion-cliplet-playback-sample.v0',
          sourceRoute: 'motion-server:http://127.0.0.1:8098/generate',
          sourceModel: 'kimodo',
          sourceStatus: 'archived-live-generated-witness',
          clipletLabel: 'carry-flee',
        },
        motionAdapter: {
          schema: 'lerms.schnoz-motion-adapter.v0',
        },
      },
      {
        schema: 'lerms.preview-bench-actor-motion.v0',
        actorId: 'schnoz-hit-carrier',
        species: 'red',
        role: 'carrier_actor',
        state: 'hit_reacting',
        terrainSampleId: 'terrain-crown-right',
        selectedCliplet: {
          schema: 'kaminos.generated-motion-cliplet-playback-sample.v0',
          sourceRoute: 'motion-server:http://127.0.0.1:8098/generate',
          sourceModel: 'kimodo',
          sourceStatus: 'archived-live-generated-witness',
          clipletLabel: 'brake-recover',
        },
        motionAdapter: {
          schema: 'lerms.schnoz-motion-adapter.v0',
        },
      },
    ],
    witnessState: {
      schema: 'lerms.preview-bench-actor-motion-state.v0',
      chamberId: 'lerms-underhill',
      posture: 'inspect',
      bench: 'terrain-preview',
      routeReady: true,
      actorCount: 2,
      motionAdapterSchema: 'lerms.schnoz-motion-adapter.v0',
      outputsVisualPreview: false,
      sourceTruthEffectiveAuthority: 'live_simulation',
    },
    downgrades: [
      'proxy_body_visual_only',
      'final_red_lerm_body_not_claimed',
      'kaminos_host_route_not_owned_by_lerms_payload',
      'gutterglass_camera_witness_custody_not_claimed',
      'minion_chamber_ontology_not_claimed',
    ],
  },
};

const actorMotionBenchState = createLermsPreviewBenchState(registry, {
  posture: 'inspect',
  benchId: 'terrain-preview',
  cameraId: 'overview-oblique',
  actorMotionPayloadReport: actorMotionReport,
  actorMotionPayloadSource: {
    mode: 'server_file',
    requestedUrl: '/api/read?root=lerms-preview&path=lerms-preview-bench-motion-payload-0628.json',
    root: 'lerms-preview',
    path: 'lerms-preview-bench-motion-payload-0628.json',
  },
});
assert.equal(actorMotionBenchState.actorMotion.schema, 'lerms.preview-bench-actor-motion-state.v0');
assert.equal(actorMotionBenchState.actorMotion.payloadSchema, 'lerms.preview-bench-actor-motion-payload.v0');
assert.equal(actorMotionBenchState.actorMotion.route, 'lerms/preview-bench/actor-motion-payload-file');
assert.equal(actorMotionBenchState.actorMotion.source.authority, 'live_simulation');
assert.equal(actorMotionBenchState.actorMotion.sourceTruthUpgrade.effectiveAuthority, 'live_simulation');
assert.equal(actorMotionBenchState.actorMotion.actorCount, 2);
assert.equal(actorMotionBenchState.actorMotion.frameCounts.lerms, 2);
assert.equal(actorMotionBenchState.actorMotion.frameCounts.goins, 1);
assert.equal(actorMotionBenchState.actorMotion.motionAdapterSchema, 'lerms.schnoz-motion-adapter.v0');
assert.equal(actorMotionBenchState.actorMotion.selectedClipletSource.route, 'motion-server:http://127.0.0.1:8098/generate');
assert.equal(actorMotionBenchState.actorMotion.selectedClipletSource.model, 'kimodo');
assert.equal(actorMotionBenchState.actorMotion.selectedClipletSource.status, 'archived-live-generated-witness');
assert.ok(actorMotionBenchState.actorMotion.states.includes('hit_reacting'));
assert.ok(actorMotionBenchState.actorMotion.downgrades.includes('gutterglass_camera_witness_custody_not_claimed'));
assert.equal(actorMotionBenchState.actorMotion.payloadSource.root, 'lerms-preview');
assert.equal(actorMotionBenchState.badges.actorMotion, 'live_simulation');

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
assert.match(witness, /lerms-preview-bench-terrain/, 'scene witness exposes the LERMS terrain preview bench scenario');
assert.match(witness, /lerms-preview-bench-actor-motion/, 'scene witness exposes the LERMS actor-motion preview bench scenario');
assert.match(witness, /__kaminosLermsPreviewState/, 'scene witness reads the LERMS Preview Bench state surface');
assert.match(witness, /kaminosWorldChambersDebugState/, 'scene witness reads the world chamber debug state');
assert.match(witness, /first-vertical-composer\/witness-file/, 'scene witness verifies the effective composer witness route');
assert.match(witness, /synthetic_fixture/, 'scene witness verifies the fixture authority');
assert.match(witness, /receiptSource/, 'scene witness verifies effective receipt source identity');
