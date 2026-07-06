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
  WORLD_CARTRIDGE_DISCOVERY_ROUTE,
  WORLD_CARTRIDGE_GRADUATION_MODES,
  LERMS_TERRARIUM_CARTRIDGE_ID,
  buildWorldCartridgeIndex,
  loadWorldCartridgeFromDirectory,
  normalizeWorldCartridgeManifest,
} = await import('../world-cartridges-core.js');

assert.equal(WORLD_CARTRIDGE_INDEX_SCHEMA, 'kaminos.world-cartridges.index.v0');
assert.equal(WORLD_CARTRIDGE_MANIFEST_SCHEMA, 'kaminos.world-cartridge.manifest.v0');
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
