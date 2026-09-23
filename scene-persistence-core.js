import { normalizeComposition, normalizeSceneCapture } from './scene-authoring.mjs';
import {
  LOCAL_LIQUID_EMITTER_CAPACITY, LOCAL_LIQUID_EMITTER_SCHEMA,
  LOCAL_LIQUID_EMITTER_SOURCE, LOCAL_LIQUID_EMITTER_TYPE,
  legacyLocalLiquidEmitterRecord, normalizeLocalLiquidEmitter,
  normalizeLocalLiquidEmitterPose, normalizeLocalLiquidSetup,
} from './local-liquid-setup.mjs';
export const SCENE_SCHEMA = 'kaminos.scene.v1';
export const VOLUME_PRIMITIVE_SCHEMA = 'kaminos.volume-primitives.v0';
export const SCENE_VERSION = 5;

function cloneJson(value) {
  if (value === undefined) return undefined;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function normalizeSceneObjectRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('Scene object record must be an object');
  const id = String(record.id || record.fileName || record.source || 'object');
  const normalized = {
    id,
    source: record.source ?? null,
    type: record.type ?? 'glb',
    fileName: record.fileName ?? 'object.glb',
    label: record.label ?? record.fileName ?? id,
    groupId: record.groupId ?? null,
    createdAt: record.createdAt ?? null,
    transform: cloneJson(record.transform ?? {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }),
    materials: cloneJson(record.materials ?? null),
    splat: cloneJson(record.splat ?? null),
    image: cloneJson(record.image ?? null),
    renderRoute: record.renderRoute ?? null,
    renderCapabilities: cloneJson(record.renderCapabilities ?? null),
    renderHandoffSchema: record.renderHandoffSchema ?? null,
  };
  if (normalized.type === LOCAL_LIQUID_EMITTER_TYPE) {
    if (normalized.source !== LOCAL_LIQUID_EMITTER_SOURCE) throw new Error('Unsupported local liquid emitter source');
    normalized.transform = normalizeLocalLiquidEmitterPose(normalized.transform);
    normalized.localLiquidEmitter = normalizeLocalLiquidEmitter(record.localLiquidEmitter, normalized.transform);
  } else if (record.localLiquidEmitter != null) {
    throw new Error('Local liquid emitter settings require a water emitter scene object');
  }
  return normalized;
}

function prepareLocalLiquidState(objects, setup) {
  let localLiquid = normalizeLocalLiquidSetup(setup);
  const migratedSource = localLiquid?.legacySource || null;
  if (localLiquid?.legacySource) {
    const {legacySource, ...canonical} = localLiquid;
    localLiquid = canonical;
  }
  const sceneObjects = objects.map(normalizeSceneObjectRecord);
  let emitters = sceneObjects.filter(record => record.type === LOCAL_LIQUID_EMITTER_TYPE);
  if (migratedSource && emitters.length === 0) {
    const ids = new Set(sceneObjects.map(record => record.id));
    let id = 'local-liquid-emitter-legacy', suffix = 2;
    while (ids.has(id)) id = `local-liquid-emitter-legacy-${suffix++}`;
    sceneObjects.push(legacyLocalLiquidEmitterRecord(migratedSource, id));
    emitters = sceneObjects.filter(record => record.type === LOCAL_LIQUID_EMITTER_TYPE);
  }
  if (emitters.length > LOCAL_LIQUID_EMITTER_CAPACITY) {
    throw new Error(`Local liquid emitter count ${emitters.length} exceeds retained solver capacity ${LOCAL_LIQUID_EMITTER_CAPACITY}`);
  }
  if (emitters.length && !localLiquid) throw new Error('A local liquid setup is required for a water emitter scene object');
  return {objects: sceneObjects, localLiquid};
}

function normalizeSceneGroupRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('Scene group record must be an object');
  const id = String(record.id || record.label || 'group');
  const objectIds = Array.isArray(record.objectIds)
    ? [...new Set(record.objectIds.map(value => String(value)).filter(Boolean))]
    : [];
  return {
    id,
    label: record.label ?? id,
    objectIds,
    source: record.source ?? null,
    createdAt: record.createdAt ?? null,
  };
}

function normalizeVolumePrimitiveState(state) {
  const primitives = Array.isArray(state)
    ? state
    : (Array.isArray(state?.primitives) ? state.primitives : []);
  return {
    schema: state?.schema || VOLUME_PRIMITIVE_SCHEMA,
    primitives: cloneJson(primitives),
  };
}

export function sceneObjectToLegacyModel(data) {
  return {
    id: 'legacy-model',
    source: data.model.source,
    type: data.model.type,
    fileName: data.model.fileName || 'model.glb',
    label: data.model.fileName || 'legacy model',
    transform: cloneJson(data.transform),
    materials: cloneJson(data.materials),
  };
}

export function getSceneObjectRecords(data) {
  if (Array.isArray(data?.objects)) {
    return data.objects.map(normalizeSceneObjectRecord);
  }
  if (data?.model?.source) {
    return [normalizeSceneObjectRecord(sceneObjectToLegacyModel(data))];
  }
  return [];
}

export function getSceneGroupRecords(data, objectRecords = getSceneObjectRecords(data)) {
  if (!Array.isArray(data?.groups)) return [];
  const objectIds = new Set(objectRecords.map(record => record.id));
  return data.groups
    .map(normalizeSceneGroupRecord)
    .map(group => ({
      ...group,
      objectIds: group.objectIds.filter(id => objectIds.has(id)),
    }))
    .filter(group => group.objectIds.length > 0);
}

export function hasVolumePrimitives(data) {
  return Array.isArray(data?.volumePrimitives?.primitives) && data.volumePrimitives.primitives.length > 0;
}

export function sceneDocumentIsLoadable(data) {
  if (!data?.version) return false;
  const state = prepareLocalLiquidState(getSceneObjectRecords(data), data.localLiquid);
  return state.objects.length > 0 || hasVolumePrimitives(data) || !!normalizeComposition(data.composition) || !!state.localLiquid;
}

export function isReloadableSceneObjectRecord(record) {
  const type = record?.type || 'glb';
  const source = record?.source;
  if (type === LOCAL_LIQUID_EMITTER_TYPE) return source === LOCAL_LIQUID_EMITTER_SOURCE;
  if (!['glb', 'pbr', 'splat', 'image'].includes(type) || typeof source !== 'string') return false;
  if (type === 'pbr') return source.startsWith('demos/');
  if (type === 'splat') return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://');
  if (type === 'image') return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('demos/');
  return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('demos/');
}

export function planSceneRestore(data) {
  if (!sceneDocumentIsLoadable(data)) throw new Error('Invalid scene format');
  const liquid = prepareLocalLiquidState(getSceneObjectRecords(data), data.localLiquid);
  const objects = liquid.objects;
  const groups = getSceneGroupRecords(data, objects);
  const loadedIds = new Set(objects.map(record => record.id));
  const requestedActiveId = data.activeObjectId && loadedIds.has(data.activeObjectId) ? data.activeObjectId : null;
  const requestedActiveGroupId = data.activeGroupId && groups.some(group => group.id === data.activeGroupId) ? data.activeGroupId : null;
  const activeObjectId = requestedActiveId || objects.at(-1)?.id || null;
  return {
    schema: data.schema || null,
    version: data.version,
    objects,
    groups,
    activeObjectId,
    activeGroupId: requestedActiveGroupId,
    volumePrimitives: normalizeVolumePrimitiveState(data.volumePrimitives),
    hasVolumePrimitiveScene: hasVolumePrimitives(data),
    composition: normalizeComposition(data.composition),
    localLiquid: liquid.localLiquid,
  };
}

export function buildSceneDocument({
  timestamp = new Date().toISOString(),
  objects = [],
  groups = [],
  activeObjectId = null,
  activeGroupId = null,
  volumePrimitives = { schema: VOLUME_PRIMITIVE_SCHEMA, primitives: [] },
  provenance = null,
  composition = null,
  localLiquid = null,
  capture = null,
  camera = null,
  environment = null,
  postprocessing = null,
  backdrop = false,
  backdropBrightness = undefined,
} = {}) {
  const liquid = prepareLocalLiquidState(objects, localLiquid);
  const sceneObjects = liquid.objects;
  const sceneGroups = getSceneGroupRecords({ groups }, sceneObjects);
  const activeObject = sceneObjects.find(obj => obj.id === activeObjectId) || sceneObjects[0] || null;
  const activeGroup = sceneGroups.find(group => group.id === activeGroupId) || null;
  const document = {
    schema: SCENE_SCHEMA,
    version: SCENE_VERSION,
    timestamp,
    objects: sceneObjects,
    groups: sceneGroups,
    activeObjectId: activeObject?.id || activeObjectId || null,
    activeGroupId: activeGroup?.id || null,
    model: activeObject ? {
      source: activeObject.source,
      type: activeObject.type,
      fileName: activeObject.fileName,
    } : null,
    provenance: cloneJson(provenance),
    composition: normalizeComposition(composition),
    localLiquid: liquid.localLiquid,
    capture: normalizeSceneCapture(capture),
    transform: cloneJson(activeObject?.transform ?? null),
    camera: cloneJson(camera),
    environment: cloneJson(environment),
    volumePrimitives: normalizeVolumePrimitiveState(volumePrimitives),
    materials: cloneJson(activeObject?.materials ?? null),
    postprocessing: cloneJson(postprocessing),
    backdrop: !!backdrop,
  };
  if (backdropBrightness !== undefined) document.backdropBrightness = backdropBrightness;
  return document;
}
