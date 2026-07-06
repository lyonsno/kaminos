import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const WORLD_CARTRIDGE_INDEX_SCHEMA = 'kaminos.world-cartridges.index.v0';
export const WORLD_CARTRIDGE_MANIFEST_SCHEMA = 'kaminos.world-cartridge.manifest.v0';
export const WORLD_CARTRIDGE_WITNESS_SCHEMA = 'kaminos.world-cartridge.witness.v0';
export const WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA = 'kaminos.world-crucible.descriptor.v0';
export const WORLD_CARTRIDGE_SMOKE_WORKBENCH_HELPER_SCHEMA = 'kaminos.world-cartridge.smoke-workbench-helper.v0';
export const WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA = 'kaminos.world-cartridge.first-use-trial.v0';
export const WORLD_CARTRIDGE_DISCOVERY_ROUTE = '/api/world-cartridges';
export const LERMS_TERRARIUM_CARTRIDGE_ID = 'lerms-terrarium';

export const WORLD_CARTRIDGE_GRADUATION_MODES = [
  'remain_in_kaminos_terrarium',
  'port_domain_native',
  'extract_shared_runtime',
  'ship_kaminos_backed_shell',
  'archive_prototype',
];

export const WORLD_CARTRIDGE_FIRST_USE_TRIAL_STEPS = [
  'enter_cartridge',
  'choose_crucible',
  'name_armature',
  'name_handle',
  'run_firing',
  'emit_shard_or_cast',
  'write_receipt',
  'answer_graduation_question',
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

function referenceList(value) {
  return Array.isArray(value)
    ? value
      .filter(item => {
        if (typeof item === 'string') return item.trim();
        return item && typeof item === 'object' && !Array.isArray(item);
      })
      .map(item => (typeof item === 'string' ? { id: item.trim() } : clone(item)))
    : [];
}

function requireNonEmptyReferenceList(value, label) {
  const refs = referenceList(value);
  if (!refs.length) throw new Error(`${label} must include at least one entry`);
  return refs;
}

function requireNonEmptyStringList(value, label) {
  const items = stringList(value);
  if (!items.length) throw new Error(`${label} must include at least one entry`);
  return items;
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

function normalizeFirstUseTrial(firstUseTrial) {
  assertPlainObject(firstUseTrial, 'world cartridge firstUseTrial');
  if (firstUseTrial.schema !== WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA) {
    throw new Error(`world cartridge firstUseTrial schema mismatch: ${firstUseTrial.schema || 'missing'}`);
  }
  if (firstUseTrial.firstMove !== 'choose_crucible') {
    throw new Error('world cartridge firstUseTrial firstMove must be choose_crucible');
  }
  if (!firstUseTrial.entryRoute) {
    throw new Error('world cartridge firstUseTrial must include entryRoute');
  }
  if (!firstUseTrial.chooseCrucible) {
    throw new Error('world cartridge firstUseTrial must include chooseCrucible');
  }
  if (!firstUseTrial.graduationQuestion) {
    throw new Error('world cartridge firstUseTrial must include graduationQuestion');
  }
  const trialSteps = stringList(firstUseTrial.trialSteps);
  for (const step of WORLD_CARTRIDGE_FIRST_USE_TRIAL_STEPS) {
    if (!trialSteps.includes(step)) {
      throw new Error(`world cartridge firstUseTrial missing trial step: ${step}`);
    }
  }
  return {
    schema: WORLD_CARTRIDGE_FIRST_USE_TRIAL_SCHEMA,
    entryRoute: firstUseTrial.entryRoute,
    firstMove: firstUseTrial.firstMove,
    chooseCrucible: firstUseTrial.chooseCrucible,
    trialSteps,
    allowedOutputs: requireNonEmptyStringList(firstUseTrial.allowedOutputs, 'world cartridge firstUseTrial allowedOutputs'),
    failureSignals: stringList(firstUseTrial.failureSignals),
    consumerCoverage: objectList(firstUseTrial.consumerCoverage),
    graduationQuestion: firstUseTrial.graduationQuestion,
  };
}

function normalizeSmokeApparitions(apparitions, crucibleIndex) {
  return objectList(apparitions).map((apparition, index) => {
    if (!apparition.route) {
      throw new Error(`world crucible ${crucibleIndex} smoke apparition ${index} must include route`);
    }
    return apparition;
  });
}

function buildSmokeWorkbenchHelper(offer, {
  cartridgeId,
  crucibleId,
  defaultChamber,
  defaultRoute,
} = {}) {
  const query = new URLSearchParams();
  query.set('kaminos_forge_host', 'live');
  const chamber = defaultChamber || defaultRoute?.query?.world_chamber;
  if (chamber) query.set('world_chamber', chamber);
  query.set('world_cartridge', cartridgeId);
  query.set('world_crucible', crucibleId);
  query.set('forge_host_smoke_offer', offer.id);
  return {
    schema: WORLD_CARTRIDGE_SMOKE_WORKBENCH_HELPER_SCHEMA,
    routeKind: 'forge-host-smoke-offer-route',
    operatorRoute: `?${query.toString()}`,
    operatorSteps: [
      'open_operator_route',
      'inspect_inline_chamber',
      'capture_smoke_receipt',
      'return_source_owned_firing_or_gap_report',
    ],
    receiptSchema: 'kaminos.forge-host.smoke-receipt.v0',
    docs: [
      'docs/smoke-workbench-for-agents.md',
      'docs/world-cartridge-first-use-workflow.md',
    ],
  };
}

function normalizeSmokeOffers(offers, crucibleIndex, context = {}) {
  return objectList(offers).map((offer, index) => {
    if (!offer.id) {
      throw new Error(`world crucible ${crucibleIndex} smoke offer ${index} must include id`);
    }
    if (!offer.route) {
      throw new Error(`world crucible ${crucibleIndex} smoke offer ${index} must include route`);
    }
    if (!offer.authority) {
      throw new Error(`world crucible ${crucibleIndex} smoke offer ${index} must include authority`);
    }
    if (!offer.outputClass) {
      throw new Error(`world crucible ${crucibleIndex} smoke offer ${index} must include outputClass`);
    }
    return {
      ...clone(offer),
      smokeWorkbench: buildSmokeWorkbenchHelper(offer, context),
    };
  });
}

function normalizeCrucibles(crucibles, context = {}) {
  return objectList(crucibles).map((crucible, index) => {
    if (crucible.schema !== WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA) {
      throw new Error(`world crucible ${index} schema mismatch: ${crucible.schema || 'missing'}`);
    }
    if (!crucible.id) throw new Error(`world crucible ${index} must include id`);
    if (!crucible.title) throw new Error(`world crucible ${index} must include title`);
    if (!crucible.role) throw new Error(`world crucible ${index} must include role`);
    if (!crucible.status) throw new Error(`world crucible ${index} must include status`);
    if (!crucible.makingIntent) throw new Error(`world crucible ${index} must include makingIntent`);
    if (!crucible.consumerCanStartBy) throw new Error(`world crucible ${index} must include consumerCanStartBy`);
    if (!crucible.graduationQuestion) throw new Error(`world crucible ${index} must include graduationQuestion`);
    if (!WORLD_CARTRIDGE_GRADUATION_MODES.includes(crucible.graduationMode)) {
      throw new Error(`world crucible ${index} graduationMode is unknown: ${crucible.graduationMode || 'missing'}`);
    }
    const stewardship = crucible.stewardship || crucible.custody;
    assertPlainObject(stewardship, `world crucible ${index} stewardship`);
    if (!stewardship.owner) throw new Error(`world crucible ${index} stewardship must include owner`);
    assertPlainObject(crucible.sourceOwnership, `world crucible ${index} sourceOwnership`);
    if (!crucible.sourceOwnership.owner) throw new Error(`world crucible ${index} sourceOwnership must include owner`);
    return {
      schema: WORLD_CRUCIBLE_DESCRIPTOR_SCHEMA,
      id: crucible.id,
      title: crucible.title,
      role: crucible.role,
      status: crucible.status,
      makingIntent: crucible.makingIntent,
      consumerCanStartBy: crucible.consumerCanStartBy,
      armatures: requireNonEmptyReferenceList(crucible.armatures, `world crucible ${index} armatures`),
      handles: requireNonEmptyReferenceList(crucible.handles, `world crucible ${index} handles`),
      firings: requireNonEmptyReferenceList(crucible.firings, `world crucible ${index} firings`),
      shards: requireNonEmptyReferenceList(crucible.shards, `world crucible ${index} shards`),
      casts: requireNonEmptyReferenceList(crucible.casts, `world crucible ${index} casts`),
      receipts: requireNonEmptyReferenceList(crucible.receipts, `world crucible ${index} receipts`),
      smokeApparitions: normalizeSmokeApparitions(crucible.smokeApparitions, index),
      smokeOffers: normalizeSmokeOffers(crucible.smokeOffers, index, {
        ...context,
        crucibleId: crucible.id,
      }),
      graduationMode: crucible.graduationMode,
      graduationQuestion: crucible.graduationQuestion,
      stewardship: clone(stewardship),
      sourceOwnership: clone(crucible.sourceOwnership),
      custody: clone(stewardship),
    };
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
  const defaultRoute = normalizeDefaultRoute(manifest.defaultRoute || {}, manifest.id);
  const defaultChamber = manifest.defaultChamber || defaultRoute.query.world_chamber || null;
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
    defaultChamber,
    defaultRoute,
    sourceBridges: objectList(manifest.sourceBridges),
    affordanceBindings: objectList(manifest.affordanceBindings),
    generationBasins: objectList(manifest.generationBasins),
    sceneRecipes: objectList(manifest.sceneRecipes),
    firstUseTrial: normalizeFirstUseTrial(manifest.firstUseTrial || {}),
    crucibles: normalizeCrucibles(manifest.crucibles || [], {
      cartridgeId: manifest.id,
      defaultChamber,
      defaultRoute,
    }),
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
    firstUseTrial: clone(cartridge.firstUseTrial),
    crucibles: clone(cartridge.crucibles),
    crucibleCount: cartridge.crucibles.length,
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
