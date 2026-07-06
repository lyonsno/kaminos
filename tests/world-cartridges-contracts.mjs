import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const docs = readFileSync(join(root, 'docs/world-cartridges.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const serveSource = readFileSync(join(root, 'serve.py'), 'utf8');

assert.match(readme, /docs\/world-cartridges\.md/, 'README links the world cartridge guide');
assert.match(docs, /worlds\/<cartridge-id>\/[\s\S]*world\.json[\s\S]*composition\.js[\s\S]*graduation\.md/, 'world cartridge docs define the concrete scaffold shape');
assert.match(serveSource, /\/api\/world-cartridges/, 'Kaminos server exposes world cartridge discovery');
assert.match(serveSource, /build_world_cartridge_index/, 'Kaminos server builds cartridge index through a named function');

const cartridgeDir = join(root, 'worlds/lerms-terrarium');
const worldJsonPath = join(cartridgeDir, 'world.json');
const compositionPath = join(cartridgeDir, 'composition.js');
const graduationPath = join(cartridgeDir, 'graduation.md');
const witnessesPath = join(cartridgeDir, 'witnesses');

assert.ok(existsSync(worldJsonPath), 'lerms terrarium cartridge has world.json');
assert.ok(existsSync(compositionPath), 'lerms terrarium cartridge has composition.js');
assert.ok(existsSync(graduationPath), 'lerms terrarium cartridge has graduation.md');
assert.ok(existsSync(witnessesPath), 'lerms terrarium cartridge has witnesses directory');

const {
  WORLD_CARTRIDGE_INDEX_SCHEMA,
  WORLD_CARTRIDGE_MANIFEST_SCHEMA,
  WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA,
  WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA,
  WORLD_CARTRIDGE_DISCOVERY_ROUTE,
  WORLD_CARTRIDGE_GRADUATION_MODES,
  LERMS_TERRARIUM_CARTRIDGE_ID,
  buildWorldCartridgeIndex,
  loadWorldCartridgeFromDirectory,
  normalizeWorldCartridgeManifest,
} = await import('../world-cartridges-core.js');

assert.equal(WORLD_CARTRIDGE_INDEX_SCHEMA, 'kaminos.world-cartridges.index.v0');
assert.equal(WORLD_CARTRIDGE_MANIFEST_SCHEMA, 'kaminos.world-cartridge.manifest.v0');
assert.equal(WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA, 'kaminos.world-crucible.descriptor.v0');
assert.equal(WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA, 'kaminos.world-cartridge.first-use-trial.v0');
assert.equal(WORLD_CARTRIDGE_DISCOVERY_ROUTE, '/api/world-cartridges');
assert.equal(LERMS_TERRARIUM_CARTRIDGE_ID, 'lerms-terrarium');
assert.deepEqual(WORLD_CARTRIDGE_GRADUATION_MODES, [
  'remain_in_kaminos_terrarium',
  'port_domain_native',
  'extract_shared_runtime',
  'ship_kaminos_backed_shell',
  'archive_prototype',
]);

const manifest = JSON.parse(readFileSync(worldJsonPath, 'utf8'));
const manifestSource = readFileSync(worldJsonPath, 'utf8');
const privateDiaulosHandlePattern = /\b(?:minion-spawnfucker|palm-daddy|mushfinger-clayfucker|molten-heartfucker|hill-of-hills-fucker|lerm-horde-fucker|lerm-feel-fucker|big-papa-finger-juice-fucker|greedy-glove-fucker)\b/;
assert.doesNotMatch(
  manifestSource,
  privateDiaulosHandlePattern,
  'world cartridge manifest uses role/subsystem keys instead of private Diaulos handles',
);
const normalized = normalizeWorldCartridgeManifest(manifest, {
  manifestPath: worldJsonPath,
  rootDir: cartridgeDir,
});

assert.equal(normalized.schema, WORLD_CARTRIDGE_MANIFEST_SCHEMA);
assert.equal(normalized.id, 'lerms-terrarium');
assert.equal(normalized.slug, 'lerms-terrarium');
assert.equal(normalized.title, 'LERMS Terrarium');
assert.equal(normalized.authority.fixtureIdentity, 'lerms-terrarium.fixture.v0');
assert.equal(normalized.authority.displayAuthority, 'fixture_cartridge');
assert.equal(normalized.defaultChamber, 'lerms-underhill');
assert.equal(normalized.defaultRoute.query.world_chamber, 'lerms-underhill');
assert.equal(normalized.defaultRoute.query.world_cartridge, 'lerms-terrarium');
assert.equal(normalized.sourceBridges.some(bridge => bridge.repo === 'lerms' && bridge.role === 'game-law'), true);
assert.equal(normalized.affordanceBindings.some(binding => binding.id === 'world-chamber-lerms-underhill'), true);
assert.equal(normalized.affordanceBindings.some(binding => binding.id === 'mushfinger-motion-agency'), true);
assert.equal(normalized.affordanceBindings.some(binding => binding.id === 'palm-hand-surface-runtime'), true);
assert.equal(normalized.generationBasins.some(basin => basin.id === 'little-body-variants'), true);
assert.equal(normalized.firstUseTrial.schema, WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA);
assert.equal(normalized.firstUseTrial.entryRoute, '/api/world-cartridges');
assert.equal(normalized.firstUseTrial.firstMove, 'choose_crucible');
assert.deepEqual(normalized.firstUseTrial.trialSteps, [
  'enter_cartridge',
  'choose_crucible',
  'name_armature',
  'name_handle',
  'run_firing',
  'emit_shard_or_cast',
  'write_receipt',
  'answer_graduation_question',
]);
assert.ok(normalized.firstUseTrial.allowedOutputs.includes('firing_receipt'));
assert.ok(normalized.firstUseTrial.allowedOutputs.includes('gap_report'));
assert.ok(normalized.firstUseTrial.failureSignals.includes('no_crucible_chosen'));
assert.ok(normalized.firstUseTrial.graduationQuestion.includes('Kaminos'));
assert.deepEqual(normalized.firstUseTrial.consumerCoverage.find(coverage => coverage.consumer === 'hand-feel-live-compositing').crucibles, [
  'finger-fluid',
  'glove-emitter',
]);
assert.deepEqual(normalized.crucibles.map(crucible => crucible.id), [
  'hill-of-hills',
  'lerm-species',
  'finger-fluid',
  'glove-emitter',
]);
for (const crucible of normalized.crucibles) {
  assert.equal(crucible.schema, WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA);
  assert.ok(crucible.title, `${crucible.id} has a title`);
  assert.ok(crucible.role, `${crucible.id} has a role`);
  assert.ok(crucible.status, `${crucible.id} has a status`);
  assert.ok(crucible.makingIntent, `${crucible.id} has making intent`);
  assert.ok(crucible.armatures.length >= 1, `${crucible.id} names an armature`);
  assert.ok(crucible.handles.length >= 1, `${crucible.id} names operator/agent handles`);
  assert.ok(crucible.firings.length >= 1, `${crucible.id} records firing memory`);
  assert.ok(crucible.shards.length >= 1, `${crucible.id} records shards`);
  assert.ok(crucible.casts.length >= 1, `${crucible.id} records casts`);
  assert.ok(crucible.receipts.length >= 1, `${crucible.id} records receipts`);
  assert.ok(crucible.smokeApparitions.length >= 1, `${crucible.id} carries smoke apparition hooks`);
  assert.ok(WORLD_CARTRIDGE_GRADUATION_MODES.includes(crucible.graduationMode), `${crucible.id} graduation mode is known`);
  assert.ok(crucible.consumerCanStartBy.includes('firing'), `${crucible.id} tells a consumer how to run a firing`);
  assert.ok(crucible.graduationQuestion.includes('?'), `${crucible.id} carries a graduation question`);
  assert.equal(typeof crucible.stewardship.owner, 'string', `${crucible.id} names workbench stewardship owner`);
  assert.equal(typeof crucible.sourceOwnership.owner, 'string', `${crucible.id} names subsystem source owner`);
}
assert.equal(normalized.crucibles.find(crucible => crucible.id === 'hill-of-hills').smokeApparitions[0].route, 'future:moge-depth-smoke-apparition');
assert.equal(normalized.crucibles.find(crucible => crucible.id === 'finger-fluid').handles.some(handle => handle.kind === 'state-stream'), true);
assert.match(normalized.crucibles.find(crucible => crucible.id === 'glove-emitter').stewardship.role, /workbench/i);
assert.equal(normalized.crucibles.find(crucible => crucible.id === 'glove-emitter').sourceOwnership.owner, 'glove-well-source');
assert.equal(normalized.graduation.modes.length, WORLD_CARTRIDGE_GRADUATION_MODES.length);
assert.equal(normalized.graduation.currentMode, 'remain_in_kaminos_terrarium');
assert.equal(normalized.witnesses[0].schema, 'kaminos.world-cartridge.witness.v0');
assert.equal(normalized.witnesses[0].route, 'world_cartridge=lerms-terrarium&world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview');
assert.equal(normalized.files.composition, 'composition.js');
assert.equal(normalized.files.graduation, 'graduation.md');

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    authority: {
      displayAuthority: 'fixture_cartridge',
    },
  }),
  /fixture identity/,
  'fixture-backed cartridges must name stable fixture identity',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    id: 'lerms-terrarium-demo',
    authority: {
      fixtureIdentity: 'lerms-terrarium.fixture.v0',
      displayAuthority: 'live_cartridge',
    },
  }),
  /live display authority/,
  'fixture-backed cartridges fail loud if they claim live display authority',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    crucibles: [
      {
        id: 'bad-crucible',
        title: 'Bad Crucible',
        role: 'invalid fixture',
        status: 'fixture',
        armatures: ['missing-intent'],
        handles: ['nope'],
        firings: ['nope'],
        shards: ['nope'],
        casts: ['nope'],
        receipts: ['nope'],
        smokeApparitions: [{ route: 'future:moge-depth-smoke-apparition' }],
        graduationMode: 'remain_in_kaminos_terrarium',
        custody: { owner: 'test' },
      },
    ],
  }),
  /crucible 0 schema mismatch/,
  'crucibles fail loud when schema identity is missing',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    crucibles: [
      {
        schema: WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA,
        id: 'bad-crucible',
        title: 'Bad Crucible',
        role: 'invalid fixture',
        status: 'fixture',
        armatures: ['missing-intent'],
        handles: ['nope'],
        firings: ['nope'],
        shards: ['nope'],
        casts: ['nope'],
        receipts: ['nope'],
        smokeApparitions: [{ route: 'future:moge-depth-smoke-apparition' }],
        graduationMode: 'remain_in_kaminos_terrarium',
        custody: { owner: 'test' },
      },
    ],
  }),
  /must include makingIntent/,
  'crucibles fail loud when they lack a positive making intent',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    crucibles: [
      {
        schema: WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA,
        id: 'bad-crucible',
        title: 'Bad Crucible',
        role: 'invalid fixture',
        status: 'fixture',
        makingIntent: 'Try to prove route identity.',
        consumerCanStartBy: 'Run a bad firing.',
        armatures: ['bad'],
        handles: ['bad'],
        firings: ['bad'],
        shards: ['bad'],
        casts: ['bad'],
        receipts: ['bad'],
        smokeApparitions: [{ id: 'blank-apparition' }],
        graduationMode: 'remain_in_kaminos_terrarium',
        graduationQuestion: 'Where should this go?',
        stewardship: { owner: 'test' },
        sourceOwnership: { owner: 'test-source' },
        custody: { owner: 'test' },
      },
    ],
  }),
  /smoke apparition 0 must include route/,
  'smoke apparition hooks must name the route they intend to prove',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    firstUseTrial: {
      schema: WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA,
      entryRoute: '/api/world-cartridges',
      firstMove: 'read_some_private_report',
      chooseCrucible: 'Guess from context.',
      trialSteps: ['enter_cartridge'],
      allowedOutputs: ['gap_report'],
      failureSignals: ['no_crucible_chosen'],
      graduationQuestion: 'Where should this go?',
    },
  }),
  /firstUseTrial firstMove must be choose_crucible/,
  'the cartridge first-use route forces crucible choice as the first operational move',
);

assert.throws(
  () => normalizeWorldCartridgeManifest({
    ...manifest,
    crucibles: [
      {
        ...manifest.crucibles[0],
        consumerCanStartBy: '',
      },
    ],
  }),
  /must include consumerCanStartBy/,
  'a crucible must tell an unaided consumer the first productive action',
);

const loaded = loadWorldCartridgeFromDirectory(cartridgeDir);
assert.equal(loaded.id, 'lerms-terrarium');
assert.equal(loaded.files.manifestPath.endsWith('worlds/lerms-terrarium/world.json'), true);

const index = buildWorldCartridgeIndex({ rootDir: join(root, 'worlds') });
assert.equal(index.schema, WORLD_CARTRIDGE_INDEX_SCHEMA);
assert.equal(index.discoveryRoute, WORLD_CARTRIDGE_DISCOVERY_ROUTE);
assert.equal(index.cartridges.length, 1);
assert.equal(index.cartridges[0].id, 'lerms-terrarium');
assert.equal(index.cartridges[0].summary.creatureFamilies.includes('red-lerms'), true);
assert.equal(index.cartridges[0].defaultRoute.query.world_cartridge, 'lerms-terrarium');
assert.equal(index.cartridges[0].firstUseTrial.firstMove, 'choose_crucible');
assert.equal(index.cartridges[0].firstUseTrial.trialSteps.includes('run_firing'), true);
assert.equal(index.cartridges[0].firstUseTrial.consumerCoverage.some(coverage => coverage.consumer === 'lerm-feel-fucker'), false);
assert.equal(index.cartridges[0].crucibleCount, 4);
assert.deepEqual(index.cartridges[0].crucibles.map(crucible => crucible.id), [
  'hill-of-hills',
  'lerm-species',
  'finger-fluid',
  'glove-emitter',
]);
