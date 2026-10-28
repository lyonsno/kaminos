import {defaultSceneRecordOperations,normalizeSceneObjectRecord} from './scene-record-operations.mjs';
import {checkedRepetition} from './scene-repetition.mjs';
import {checkedViewportDisplay} from './viewport-display-settings.mjs';
import {checkedObjectCollision,canCollideWithFire,checkSceneCollisionReferences} from './scene-collider.mjs';
import {FIRE_DOMAIN_TYPE,checkedFireDomainRecord,checkedFireSourceRecord,authorFireObjects,readFireObjects,fireRenderingSettings} from './scene-fire-domain.mjs';
import {legacyRimLightRecord} from './scene-spot-light.mjs';
import {GROUP_TYPE,identityGroupPose,checkedGroupPose} from './scene-group.mjs';
import { normalizeComposition, normalizeSceneCapture } from './scene-authoring.mjs';
import { FLAME_EMITTER_ID, FLAME_EMITTER_TYPE, FLAME_EMITTER_SOURCE, normalizeFlameEmitterPose,
  flameDomainTranslationForPose, normalizeFlameDomainTranslation, normalizeFlameDomainScale, flamePoseInDomain,flameDomainControlsFromSettings } from './scene-flame-emitter.mjs';
import { LOCAL_LIQUID_EMITTER_SOURCE, LOCAL_LIQUID_EMITTER_TYPE, normalizeLocalLiquidSetup } from './local-liquid-setup.mjs';
import {normalizeCameraViews} from './scene-camera-views.mjs';
import {CAMERA_TYPE,normalizeSceneCamera,normalizeCameraViewport} from './scene-camera.mjs';
export const SCENE_SCHEMA = 'kaminos.scene.v1';
export const VOLUME_PRIMITIVE_SCHEMA = 'kaminos.volume-primitives.v0';
export const SCENE_VERSION = 12;

function cloneJson(value) {
  if (value === undefined) return undefined;
  return value === null ? null : JSON.parse(JSON.stringify(value));
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
    ...(record.repetition?{repetition:checkedRepetition(record.repetition)}:{}),
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
  if(data?.version<7 && data.environment?.rimLight?.enabled && !records.some(r=>r.id==='@rim-light')){
    records.push(normalizeSceneObjectRecord(legacyRimLightRecord(data.environment.rimLight)));
  }
  if(data?.version<10 && (data.composition || records.some(record=>record.type===FIRE_DOMAIN_TYPE))) {
    const kiln=records.find(record=>record.id==='kiln'&&canCollideWithFire(record));
    const raw=data.objects?.find(record=>record.id==='kiln');
    if(kiln && !Object.hasOwn(raw??{},'collision'))kiln.collision={domainId:'flame-field',enabled:true};
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
  return defaultSceneRecordOperations.reloadable(record);
}

export function planSceneRestore(data, { allowEmpty = false } = {}) {
  if(Number(data?.version)>SCENE_VERSION)throw Error('Scene version requires a newer authoring client');
  if (!sceneDocumentIsLoadable(data) && !(allowEmpty && Number.isInteger(data?.version) && data.version > 0)) throw new Error('Invalid scene format');
  const authoredObjects = getSceneObjectRecords(data);
  checkSceneCollisionReferences(authoredObjects,{implicitFireDomain:data.version<9&&!!normalizeComposition(data.composition)});
  const fire = authoredObjects.some(o=>o.type===FIRE_DOMAIN_TYPE)?readFireObjects(authoredObjects,data.fireRendering):null;
  if(data.version>=9 && data.composition && !fire)throw Error('Saved fire domain is missing');
  if(fire)data={...data,flameDomainTranslation:fire.frame.translation,flameDomainScale:fire.frame.scale,flameDomainFollowSource:fire.frame.followSource};
  const objects = authoredObjects.filter(o=>o.type!==FIRE_DOMAIN_TYPE);
  const flameSources = objects.filter(record => record.type === FLAME_EMITTER_TYPE);
  const flameIds=new Set();for(const record of flameSources){if(flameIds.has(record.id))throw Error('Duplicate flame source identity');flameIds.add(record.id);}
  if (flameSources.length && !normalizeComposition(data.composition)) throw new Error('Flame source requires its saved flame composition');
  const flameDomainTranslation = (flameSources.length || normalizeComposition(data.composition))
    ? (data.flameDomainTranslation === undefined
      ? (flameSources.length ? flameDomainTranslationForPose(flameSources[0].transform,flameDomainControlsFromSettings(fire?.settings)) : [0,0,0])
      : normalizeFlameDomainTranslation(data.flameDomainTranslation))
    : null;
  const flameDomainScale = normalizeFlameDomainScale(data.flameDomainScale);
  const flameDomainFollowSource = data.flameDomainFollowSource ?? true;
  if (typeof flameDomainFollowSource !== 'boolean') throw new Error('Flame domain follow-source must be Boolean');
  if (flameSources.length && flameDomainFollowSource && !flamePoseInDomain(flameSources[0].transform, flameDomainTranslation, flameDomainScale,flameDomainControlsFromSettings(fire?.settings))) {
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
  const activeObjectId = requestedActiveId || (Array.isArray(data.selectionIds)?null:objects.at(-1)?.id || null);
  return {
    schema: data.schema || null,
    cameraViews: normalizeCameraViews(data.cameraViews),
    sceneCamera:normalizeSceneCamera(data.sceneCamera,objects),
    editorDisplay:data.editorDisplay==null?null:checkedViewportDisplay(data.editorDisplay),
    viewport:normalizeCameraViewport(data.viewport,normalizeSceneCamera(data.sceneCamera,objects)),
    version: data.version,
    authoredObjects,fireSettings:fire?.settings??null,fireDomain:fire?.domain??null,
    objects,
    groups,
    activeObjectId,
    activeGroupId: requestedActiveGroupId,
    volumePrimitives: normalizeVolumePrimitiveState(data.volumePrimitives),
    hasVolumePrimitiveScene: hasVolumePrimitives(data),
    composition: normalizeComposition(data.composition),
    flameDomainTranslation, flameDomainScale, flameDomainFollowSource,
    flameSources:cloneJson(flameSources),
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
  activeFieldId = null, selectionIds = null,
  volumePrimitives = { schema: VOLUME_PRIMITIVE_SCHEMA, primitives: [] },
  provenance = null,
  composition = null,
  fireSettings = null,
  flameDomainTranslation = undefined,
  flameDomainScale = 1,
  flameDomainFollowSource = true,
  localLiquid = null,
  capture = null,
  camera = null,
  cameraViews = null,
  sceneCamera = null,
  viewport = null,
  editorDisplay = null,
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
  const activeObject = sceneObjects.find(obj => obj.id === activeObjectId) || (Array.isArray(selectionIds)?null:sceneObjects[0] || null);
  const activeGroup = sceneGroups.find(group => group.id === activeGroupId) || null;
  const flameSource = sceneObjects.find(object => object.type === FLAME_EMITTER_TYPE);
  const authoredFlameDomain = (flameSource || normalizeComposition(composition))
    ? (flameDomainTranslation === undefined
      ? (flameSource ? flameDomainTranslationForPose(flameSource.transform,flameDomainControlsFromSettings(fireSettings)) : [0,0,0])
      : normalizeFlameDomainTranslation(flameDomainTranslation))
    : null;
  flameDomainScale = normalizeFlameDomainScale(flameDomainScale);
  if (typeof flameDomainFollowSource !== 'boolean') throw new Error('Flame domain follow-source must be Boolean');
  if (flameSource && flameDomainFollowSource && !flamePoseInDomain(flameSource.transform, authoredFlameDomain, flameDomainScale,flameDomainControlsFromSettings(fireSettings))) {
    throw new Error('Flame source lies outside its authored simulation domain');
  }
  const document = {
    schema: SCENE_SCHEMA,
    version: sceneObjects.some(o=>o.flameAttachment)?12:sceneObjects.some(o=>o.repetition)||sceneGroups.some(g=>g.repetition)?11:fireSettings?10:8,
    timestamp,
    objects: fireSettings ? authorFireObjects(sceneObjects,fireSettings,{translation:authoredFlameDomain,scale:flameDomainScale,followSource:flameDomainFollowSource,collision:composition?.route?.volume_collision==='kiln'}) : sceneObjects,
    ...(fireSettings?{fireRendering:fireRenderingSettings(fireSettings)}:{}),
    groups: sceneGroups,
    activeObjectId: activeObject?.id || activeObjectId || null,
    activeGroupId: activeGroup?.id || null,
    activeFieldId: ['flame-field','water-field'].includes(activeFieldId)?activeFieldId:null,
    ...(Array.isArray(selectionIds)?{selectionIds:[...selectionIds]}:{}),
    model: activeObject ? {
      source: activeObject.source,
      type: activeObject.type,
      fileName: activeObject.fileName,
    } : null,
    provenance: cloneJson(provenance),
    composition: normalizeComposition(composition),
    ...(!fireSettings && authoredFlameDomain ? { flameDomainTranslation: authoredFlameDomain, flameDomainScale, flameDomainFollowSource } : {}),
    localLiquid: liquidSetup,
    capture: normalizeSceneCapture(capture),
    transform: cloneJson(activeObject?.transform ?? null),
    camera: cloneJson(camera),
    cameraViews: normalizeCameraViews(cameraViews),
    sceneCamera:normalizeSceneCamera(sceneCamera,sceneObjects),
    ...(editorDisplay==null?{}:{editorDisplay:checkedViewportDisplay(editorDisplay)}),
    viewport:normalizeCameraViewport(viewport,normalizeSceneCamera(sceneCamera,sceneObjects)),
    environment: cloneJson(environment),
    volumePrimitives: normalizeVolumePrimitiveState(volumePrimitives),
    materials: cloneJson(activeObject?.materials ?? null),
    postprocessing: cloneJson(postprocessing),
    backdrop: !!backdrop,
  };
  if (backdropBrightness !== undefined) document.backdropBrightness = backdropBrightness;
  checkSceneCollisionReferences(document.objects);
  return document;
}
