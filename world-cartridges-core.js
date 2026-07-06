import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const WORLD_CARTRIDGE_INDEX_SCHEMA = 'kaminos.world-cartridges.index.v0';
export const WORLD_CARTRIDGE_MANIFEST_SCHEMA = 'kaminos.world-cartridge.manifest.v0';
export const WORLD_CARTRIDGE_WITNESS_SCHEMA = 'kaminos.world-cartridge.witness.v0';
export const WORLD_CARTRIDGE_DISCOVERY_ROUTE = '/api/world-cartridges';
export const LERMS_TERRARIUM_CARTRIDGE_ID = 'lerms-terrarium';

export const WORLD_CARTRIDGE_GRADUATION_MODES = [
  'remain_in_kaminos_terrarium',
  'port_domain_native',
  'extract_shared_runtime',
  'ship_kaminos_backed_shell',
  'archive_prototype',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function objectList(value) {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => clone(item))
    : [];
}

function normalizeDefaultRoute(route, cartridgeId) {
  assertPlainObject(route, 'world cartridge defaultRoute');
  const query = route.query && typeof route.query === 'object' && !Array.isArray(route.query)
    ? { ...route.query }
    : {};
  if (!query.world_cartridge) query.world_cartridge = cartridgeId;
  return {
    tab: route.tab || 'worlds',
    query,
  };
}

function normalizeGraduation(graduation) {
  assertPlainObject(graduation, 'world cartridge graduation');
  const modes = stringList(graduation.modes);
  for (const mode of WORLD_CARTRIDGE_GRADUATION_MODES) {
    if (!modes.includes(mode)) {
      throw new Error(`world cartridge graduation missing mode: ${mode}`);
    }
  }
  const currentMode = graduation.currentMode || modes[0];
  if (!WORLD_CARTRIDGE_GRADUATION_MODES.includes(currentMode)) {
    throw new Error(`world cartridge graduation currentMode is unknown: ${currentMode}`);
  }
  return {
    currentMode,
    modes,
    notes: stringList(graduation.notes),
  };
}

function normalizeWitnesses(witnesses) {
  return objectList(witnesses).map((witness, index) => {
    if (witness.schema !== WORLD_CARTRIDGE_WITNESS_SCHEMA) {
      throw new Error(`world cartridge witness ${index} schema mismatch: ${witness.schema || 'missing'}`);
    }
    if (!witness.route) {
      throw new Error(`world cartridge witness ${index} must include route`);
    }
    return witness;
  });
}

export function normalizeWorldCartridgeManifest(manifest, options = {}) {
  assertPlainObject(manifest, 'world cartridge manifest');
  if (manifest.schema !== WORLD_CARTRIDGE_MANIFEST_SCHEMA) {
    throw new Error(`world cartridge manifest schema mismatch: expected ${WORLD_CARTRIDGE_MANIFEST_SCHEMA} but got ${manifest.schema || 'missing'}`);
  }
  if (!manifest.id) throw new Error('world cartridge manifest must include id');
  if (!manifest.title) throw new Error('world cartridge manifest must include title');
  assertPlainObject(manifest.authority, 'world cartridge authority');
  if (!manifest.authority.fixtureIdentity) {
    throw new Error('fixture-backed cartridges must name stable fixture identity');
  }
  if (manifest.authority.displayAuthority === 'live_cartridge') {
    throw new Error(`${manifest.id} fixture cartridge cannot claim live display authority`);
  }
  const slug = manifest.slug || manifest.id;
  const files = {
    manifestPath: options.manifestPath || null,
    rootDir: options.rootDir || null,
    composition: manifest.files?.composition || 'composition.js',
    graduation: manifest.files?.graduation || 'graduation.md',
    witnesses: manifest.files?.witnesses || 'witnesses/',
  };
  return {
    schema: WORLD_CARTRIDGE_MANIFEST_SCHEMA,
    id: manifest.id,
    slug,
    title: manifest.title,
    summary: {
      tagline: manifest.summary?.tagline || '',
      creatureFamilies: stringList(manifest.summary?.creatureFamilies),
      surfaces: stringList(manifest.summary?.surfaces),
    },
    audience: stringList(manifest.audience),
    authority: clone(manifest.authority),
    lineage: clone(manifest.lineage || {}),
    defaultChamber: manifest.defaultChamber || null,
    defaultRoute: normalizeDefaultRoute(manifest.defaultRoute || {}, manifest.id),
    sourceBridges: objectList(manifest.sourceBridges),
    affordanceBindings: objectList(manifest.affordanceBindings),
    generationBasins: objectList(manifest.generationBasins),
    sceneRecipes: objectList(manifest.sceneRecipes),
    graduation: normalizeGraduation(manifest.graduation || {}),
    witnesses: normalizeWitnesses(manifest.witnesses || []),
    files,
  };
}

export function loadWorldCartridgeFromDirectory(directory) {
  const manifestPath = join(directory, 'world.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`world cartridge manifest missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return normalizeWorldCartridgeManifest(manifest, {
    manifestPath,
    rootDir: directory,
  });
}

function cartridgeSummary(cartridge, rootDir) {
  return {
    schema: WORLD_CARTRIDGE_MANIFEST_SCHEMA,
    id: cartridge.id,
    slug: cartridge.slug,
    title: cartridge.title,
    summary: clone(cartridge.summary),
    authority: clone(cartridge.authority),
    defaultChamber: cartridge.defaultChamber,
    defaultRoute: clone(cartridge.defaultRoute),
    graduation: clone(cartridge.graduation),
    sourceBridges: clone(cartridge.sourceBridges),
    affordanceBindings: clone(cartridge.affordanceBindings),
    generationBasins: clone(cartridge.generationBasins),
    witnessCount: cartridge.witnesses.length,
    path: rootDir && cartridge.files.rootDir ? relative(rootDir, cartridge.files.rootDir) || '.' : cartridge.slug,
  };
}

export function buildWorldCartridgeIndex(options = {}) {
  const rootDir = options.rootDir || join(new URL('.', import.meta.url).pathname, 'worlds');
  const errors = [];
  const cartridges = [];
  if (!existsSync(rootDir)) {
    return {
      schema: WORLD_CARTRIDGE_INDEX_SCHEMA,
      discoveryRoute: WORLD_CARTRIDGE_DISCOVERY_ROUTE,
      rootDir,
      cartridges,
      errors: [{ path: rootDir, error: 'world cartridges root missing' }],
    };
  }
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(rootDir, entry.name);
    try {
      cartridges.push(cartridgeSummary(loadWorldCartridgeFromDirectory(directory), rootDir));
    } catch (error) {
      errors.push({ path: directory, error: error.message });
    }
  }
  cartridges.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema: WORLD_CARTRIDGE_INDEX_SCHEMA,
    discoveryRoute: WORLD_CARTRIDGE_DISCOVERY_ROUTE,
    rootDir,
    cartridges,
    errors,
  };
}
