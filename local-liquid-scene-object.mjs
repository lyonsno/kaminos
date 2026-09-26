import {
  LOCAL_LIQUID_EMITTER_SCHEMA,
  LOCAL_LIQUID_EMITTER_SOURCE,
  LOCAL_LIQUID_EMITTER_TYPE,
  defaultLocalLiquidSetup,
  localLiquidInletPacket,
  normalizeLocalLiquidEmitter,
  normalizeLocalLiquidEmitterPose,
  normalizeLocalLiquidSetup,
} from './local-liquid-setup.mjs';

const clone = value => structuredClone(value);

export function createLocalLiquidEmitterSceneRecord({
  id,
  transform,
  settings = { schema: LOCAL_LIQUID_EMITTER_SCHEMA, baseRadius: 0.08, strength: 1.15, rate: 1200 },
  label = 'Water emitter',
  fileName = label,
  groupId = null,
  createdAt = new Date().toISOString(),
} = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Water emitter requires a stable scene object id');
  const pose = normalizeLocalLiquidEmitterPose(transform);
  const emitter = normalizeLocalLiquidEmitter(settings, pose);
  return {
    id,
    source: LOCAL_LIQUID_EMITTER_SOURCE,
    type: LOCAL_LIQUID_EMITTER_TYPE,
    fileName,
    label,
    groupId,
    createdAt,
    transform: pose,
    localLiquidEmitter: emitter,
  };
}

export function isLocalLiquidEmitterSceneRecord(record) {
  return record?.type === LOCAL_LIQUID_EMITTER_TYPE
    && record?.source === LOCAL_LIQUID_EMITTER_SOURCE
    && typeof record?.id === 'string'
    && !!record.id;
}

export function createLocalLiquidEmitterObject(THREE, input) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.CylinderGeometry || !THREE?.MeshStandardMaterial) {
    throw new Error('Water emitter scene objects require the current host Three.js constructors');
  }
  const savedRecord = input?.type === LOCAL_LIQUID_EMITTER_TYPE
    || input?.source === LOCAL_LIQUID_EMITTER_SOURCE
    || Object.hasOwn(input || {}, 'localLiquidEmitter');
  if (savedRecord && !isLocalLiquidEmitterSceneRecord(input)) {
    throw new Error('Malformed authored water emitter scene object; stable id, type, and source identity are required');
  }
  if (savedRecord && (!input.localLiquidEmitter || typeof input.localLiquidEmitter !== 'object')) {
    throw new Error(`Authored water emitter "${input.id}" is missing its saved settings`);
  }
  const record = createLocalLiquidEmitterSceneRecord({
    ...input,
    settings: savedRecord ? input.localLiquidEmitter : input?.settings,
  });
  const object = new THREE.Group();
  object.name = record.label;
  object.position.fromArray(record.transform.position);
  object.rotation.set(...record.transform.rotation);
  object.scale.fromArray(record.transform.scale);

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a8588, metalness: 0.22, roughness: 0.42 });
  const nozzleMaterial = new THREE.MeshStandardMaterial({ color: 0xd0e7e4, metalness: 0.12, roughness: 0.28 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.072, 0.2, 18), bodyMaterial);
  body.rotation.x = Math.PI / 2;
  body.position.z = -0.07;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.052, 0.04, 18), nozzleMaterial);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 0.04;
  object.add(body, nozzle);
  object.userData.kaminosSceneObject = {
    id: record.id,
    source: record.source,
    type: record.type,
    fileName: record.fileName,
    label: record.label,
    groupId: record.groupId,
    createdAt: record.createdAt,
    localLiquidEmitter: clone(record.localLiquidEmitter),
  };
  return { object, record };
}

export function normalizeLocalLiquidSceneDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Authored liquid scene document must be an object');
  }
  if (Object.hasOwn(document, 'objects') && !Array.isArray(document.objects)) {
    throw new Error('Authored scene objects must be an array when present');
  }
  const objects = document.objects || [];
  const hasDomain = Object.hasOwn(document, 'localLiquid') && document.localLiquid != null;
  const setup = hasDomain ? normalizeLocalLiquidSetup(document.localLiquid) : null;
  const claimedEmitters = objects.filter(record => record?.type === LOCAL_LIQUID_EMITTER_TYPE
    || record?.source === LOCAL_LIQUID_EMITTER_SOURCE
    || (Object.hasOwn(record || {}, 'localLiquidEmitter') && record.localLiquidEmitter != null));
  for (const record of claimedEmitters) {
    if (!isLocalLiquidEmitterSceneRecord(record)) {
      throw new Error('Malformed authored water emitter scene object; stable id, type, and source identity are required');
    }
    if (!record.localLiquidEmitter || typeof record.localLiquidEmitter !== 'object') {
      throw new Error(`Authored water emitter "${record.id}" is missing its saved settings`);
    }
  }
  const emitters = claimedEmitters.map(record => createLocalLiquidEmitterSceneRecord({
    id: record.id,
    transform: record.transform,
    settings: record.localLiquidEmitter,
    label: record.label,
    fileName: record.fileName,
    groupId: record.groupId,
    createdAt: record.createdAt,
  }));
  if (emitters.length && !setup) {
    throw new Error('Authored water emitters require a saved local liquid domain');
  }
  const sceneIdCounts = new Map();
  for (const record of objects) {
    if (typeof record?.id === 'string') sceneIdCounts.set(record.id, (sceneIdCounts.get(record.id) || 0) + 1);
  }
  if (new Set(emitters.map(record => record.id)).size !== emitters.length
      || emitters.some(record => sceneIdCounts.get(record.id) !== 1)) {
    throw new Error('Authored water emitter scene object ids must be unique across the scene');
  }
  if (setup?.legacySource && emitters.length === 0) {
    const source = setup.legacySource;
    const occupiedIds = new Set(objects.map(record => record?.id).filter(id => typeof id === 'string'));
    let legacyId = 'local-liquid-emitter-legacy';
    for (let suffix = 2; occupiedIds.has(legacyId); suffix += 1) {
      legacyId = `local-liquid-emitter-legacy-${suffix}`;
    }
    emitters.push(createLocalLiquidEmitterSceneRecord({
      id: legacyId,
      transform: {
        position: [source.x, source.y, source.z],
        rotation: [Math.atan2(0.25, 1), 0, 0],
        scale: [1, 1, 1],
      },
      settings: {
        schema: LOCAL_LIQUID_EMITTER_SCHEMA,
        baseRadius: source.radius,
        strength: source.strength,
        rate: source.rate,
      },
    }));
  }
  const authoredDomain = setup?.legacySource
    ? (({ legacySource, ...domain }) => domain)(setup)
    : setup;
  if (authoredDomain && emitters.length) localLiquidInletPacket(authoredDomain, emitters, 1);
  return { setup: authoredDomain, emitters };
}

export function localLiquidRuntimeSourceState(document, generation = 1) {
  const { setup, emitters } = normalizeLocalLiquidSceneDocument(document);
  return {
    domain: setup ? clone(setup) : null,
    emitters: clone(emitters),
    // Empty authored membership is an explicit stop-injection update. Keeping
    // a null packet here would let the mounted host retain a deleted inlet.
    inletPacket: setup ? localLiquidInletPacket(setup, emitters, generation) : null,
    participation: setup ? 'authored-domain-present' : 'no-authored-domain',
  };
}

export function defaultLocalLiquidSceneDomain() {
  return defaultLocalLiquidSetup();
}
