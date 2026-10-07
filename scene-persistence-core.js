import {RIM_LIGHT_ID,checkedRimRecipe,rimRecipePose,checkedSceneLightRecord} from './scene-rim-light.mjs';
import {PROCEDURAL_MESH_TYPE,PROCEDURAL_MESH_SOURCE,checkedProceduralMesh} from './scene-geometry.mjs';
import {GROUP_TYPE,identityGroupPose,checkedGroupPose} from './scene-group.mjs';
import {BURNER_BED_TYPE,BURNER_BED_SOURCE,BURNER_ASSEMBLY_TYPE,checkedBurnerBed,checkedAssemblyPose} from './burner-assembly.mjs';
import { normalizeComposition, normalizeSceneCapture } from './scene-authoring.mjs';
import { FLAME_EMITTER_ID, FLAME_EMITTER_TYPE, FLAME_EMITTER_SOURCE, normalizeFlameEmitterPose,
  flameDomainTranslationForPose, normalizeFlameDomainTranslation, flamePoseInDomain } from './scene-flame-emitter.mjs';
import { LOCAL_LIQUID_EMITTER_SOURCE, LOCAL_LIQUID_EMITTER_TYPE, normalizeLocalLiquidSetup } from './local-liquid-setup.mjs';
export const SCENE_SCHEMA = 'kaminos.scene.v1';
export const VOLUME_PRIMITIVE_SCHEMA = 'kaminos.volume-primitives.v0';
export const SCENE_VERSION = 7;

function cloneJson(value) {
  if (value === undefined) return undefined;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function normalizeSceneObjectRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('Scene object record must be an object');
  if(record.type==='light')record=checkedSceneLightRecord(record);
  const id = String(record.id || record.fileName || record.source || 'object');
  if (record.type === FLAME_EMITTER_TYPE && (id !== FLAME_EMITTER_ID || record.source !== FLAME_EMITTER_SOURCE)) {
    throw new Error('Unsupported flame source identity');
  }
  if (record.type === BURNER_BED_TYPE || record.type==='burner-bed' || record.type===PROCEDURAL_MESH_TYPE) record=checkedProceduralMesh(record);
  return {
    id,
    ...(record.type==='light'?{light:cloneJson(record.light)}:{}),
    ...(record.type === PROCEDURAL_MESH_TYPE ? {geometry:cloneJson(record.geometry),surface:cloneJson(record.surface)} : {}),
    source: record.source ?? null,
    type: record.type ?? 'glb',
    fileName: record.fileName ?? 'object.glb',
    label: record.label ?? record.fileName ?? id,
    groupId: record.groupId ?? null,
    createdAt: record.createdAt ?? null,
    transform: record.type === FLAME_EMITTER_TYPE ? normalizeFlameEmitterPose(record.transform) : cloneJson(record.transform ?? {
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
    ...(record.type === LOCAL_LIQUID_EMITTER_TYPE && record.source === LOCAL_LIQUID_EMITTER_SOURCE
      ? { localLiquidEmitter: cloneJson(record.localLiquidEmitter) } : {}),
    // Arrival leveling (stored/leveled orientation) keeps Undo Leveling
    // available after reopen; the page validates it when restoring.
    ...(record.arrivalLeveling && typeof record.arrivalLeveling === 'object'
      ? { arrivalLeveling: cloneJson(record.arrivalLeveling) } : {}),
  };
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
    type:GROUP_TYPE,transform:checkedGroupPose(record.transform || identityGroupPose()),
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
  const records=Array.isArray(data?.objects)?data.objects.map(normalizeSceneObjectRecord)
    :data?.model?.source?[normalizeSceneObjectRecord(sceneObjectToLegacyModel(data))]:[];
  if(data?.version<7 && data.environment?.rimLight?.enabled && !records.some(r=>r.id===RIM_LIGHT_ID)){
    const light={...checkedRimRecipe(data.environment.rimLight),kind:'spot',role:'rim'};
    records.push(normalizeSceneObjectRecord({id:RIM_LIGHT_ID,type:'light',source:'kaminos:scene-spot-light',label:'Rim light',fileName:'Spot light',light,transform:rimRecipePose(light)}));
  }
  return records;
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
  return getSceneObjectRecords(data).length > 0 || hasVolumePrimitives(data) || !!normalizeComposition(data.composition)
    || !!normalizeLocalLiquidSetup(data.localLiquid);
}

export function isReloadableSceneObjectRecord(record) {
  if(record?.type==='light' && record.source==='kaminos:scene-spot-light'){try{if(record.light?.kind!=='spot')return false;checkedSceneLightRecord(record);return true;}catch{return false;}}
  if(record?.type===PROCEDURAL_MESH_TYPE && record.source===PROCEDURAL_MESH_SOURCE){try{checkedProceduralMesh(record);return true;}catch{return false;}}

  const type = record?.type || 'glb';
  const source = record?.source;
  if (type === BURNER_BED_TYPE) return source === BURNER_BED_SOURCE;
  if (type === FLAME_EMITTER_TYPE) return record.id === FLAME_EMITTER_ID && source === FLAME_EMITTER_SOURCE;
  if (type === LOCAL_LIQUID_EMITTER_TYPE) return source === LOCAL_LIQUID_EMITTER_SOURCE;
  if (!['glb', 'pbr', 'splat', 'image'].includes(type) || typeof source !== 'string') return false;
  if (type === 'pbr') return source.startsWith('demos/');
  if (type === 'splat') return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://');
  if (type === 'image') return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('demos/');
  return source.startsWith('/api/') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('demos/');
}

export function planSceneRestore(data) {
  if (!sceneDocumentIsLoadable(data)) throw new Error('Invalid scene format');
  const objects = getSceneObjectRecords(data);
  const flameSources = objects.filter(record => record.type === FLAME_EMITTER_TYPE);
  if (flameSources.length > 1) throw new Error('The current flame domain supports one authored source');
  if (flameSources.length && !normalizeComposition(data.composition)) throw new Error('Flame source requires its saved flame composition');
  const flameDomainTranslation = flameSources.length
    ? (data.flameDomainTranslation === undefined
      ? flameDomainTranslationForPose(flameSources[0].transform)
      : normalizeFlameDomainTranslation(data.flameDomainTranslation))
    : null;
  if (flameSources.length && !flamePoseInDomain(flameSources[0].transform, flameDomainTranslation)) {
    throw new Error('Saved flame source lies outside its authored simulation domain');
  }
  const localLiquid = normalizeLocalLiquidSetup(data.localLiquid);
  if (objects.some(record => record.type === LOCAL_LIQUID_EMITTER_TYPE) && !localLiquid) {
    throw new Error('Authored water emitters require a saved local liquid domain');
  }
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
    flameDomainTranslation,
    flameSourcePresent: flameSources.length > 0 || (data.version < 6 && !!data.composition),
    localLiquid,
  };
}

export function buildSceneDocument({
  timestamp = new Date().toISOString(),
  objects = [],
  groups = [],
  activeObjectId = null,
  activeGroupId = null,
  activeFieldId = null,
  volumePrimitives = { schema: VOLUME_PRIMITIVE_SCHEMA, primitives: [] },
  provenance = null,
  composition = null,
  flameDomainTranslation = undefined,
  localLiquid = null,
  capture = null,
  camera = null,
  environment = null,
  postprocessing = null,
  backdrop = false,
  backdropBrightness = undefined,
} = {}) {
  const sceneObjects = objects.map(normalizeSceneObjectRecord);
  const liquidSetup = normalizeLocalLiquidSetup(localLiquid);
  if (sceneObjects.some(record => record.type === LOCAL_LIQUID_EMITTER_TYPE) && !liquidSetup) {
    throw new Error('Authored water emitters require a saved local liquid domain');
  }
  const sceneGroups = getSceneGroupRecords({ groups }, sceneObjects);
  const activeObject = sceneObjects.find(obj => obj.id === activeObjectId) || sceneObjects[0] || null;
  const activeGroup = sceneGroups.find(group => group.id === activeGroupId) || null;
  const flameSource = sceneObjects.find(object => object.type === FLAME_EMITTER_TYPE);
  const authoredFlameDomain = flameSource
    ? (flameDomainTranslation === undefined
      ? flameDomainTranslationForPose(flameSource.transform)
      : normalizeFlameDomainTranslation(flameDomainTranslation))
    : null;
  if (flameSource && !flamePoseInDomain(flameSource.transform, authoredFlameDomain)) {
    throw new Error('Flame source lies outside its authored simulation domain');
  }
  const document = {
    schema: SCENE_SCHEMA,
    version: SCENE_VERSION,
    timestamp,
    objects: sceneObjects,
    groups: sceneGroups,
    activeObjectId: activeObject?.id || activeObjectId || null,
    activeGroupId: activeGroup?.id || null,
    activeFieldId: ['flame-field','water-field'].includes(activeFieldId)?activeFieldId:null,
    model: activeObject ? {
      source: activeObject.source,
      type: activeObject.type,
      fileName: activeObject.fileName,
    } : null,
    provenance: cloneJson(provenance),
    composition: normalizeComposition(composition),
    ...(flameSource ? { flameDomainTranslation: authoredFlameDomain } : {}),
    localLiquid: liquidSetup,
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
