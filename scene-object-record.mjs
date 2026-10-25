import {checkedBurnable} from './scene-burning-settings.mjs';
import {canCollideWithFire,checkedObjectCollision} from './scene-collider.mjs';
import {giProxySettingFor} from './scene-gi-proxy-settings.mjs';
import {checkedRepetition} from './scene-repetition.mjs';
import {LOCAL_LIQUID_EMITTER_TYPE} from './local-liquid-setup.mjs';
import {FLAME_EMITTER_TYPE} from './scene-flame-emitter.mjs';

// Record construction is separate from admission into the running scene.
// Domain schemas keep their existing validators and serialized representations.
export function createSceneObjectRecord(object, metadata, {id, sceneTransform = null}) {
  const record = {
    id,
    object,
    source: metadata.source ?? null,
    type: metadata.type ?? null,
    fileName: metadata.fileName ?? 'object',
    label: metadata.label ?? metadata.fileName ?? id,
    groupId: metadata.groupId ?? null,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    splat: metadata.splat ?? null,
    image: metadata.image ?? null,
    renderRoute: metadata.renderRoute ?? null,
    renderCapabilities: metadata.renderCapabilities ?? null,
    renderHandoffSchema: metadata.renderHandoffSchema ?? null,
    sceneTransform,
    generation:metadata.generation?structuredClone(metadata.generation):null,
    assetOrigin:metadata.assetOrigin?structuredClone(metadata.assetOrigin):null,
    collision:checkedObjectCollision(metadata,Object.hasOwn(metadata,'collision')?metadata.collision:metadata.id==='kiln'&&canCollideWithFire(metadata)?{domainId:'flame-field',enabled:true}:null),
    localLiquidEmitter: metadata.type === LOCAL_LIQUID_EMITTER_TYPE ? structuredClone(metadata.localLiquidEmitter) : null,
    ...(metadata.type===FLAME_EMITTER_TYPE?{emissionEnabled:metadata.emissionEnabled!==false,...(metadata.emission?{emission:structuredClone(metadata.emission)}:{})}:{}),
    burnable:checkedBurnable(metadata),
    giProxy:giProxySettingFor({type:metadata.type,giProxy:metadata.giProxy}),
    ...(metadata.repetition?{repetition:checkedRepetition(metadata.repetition)}:{}),
  };
  object.userData.kaminosSceneObject = {
    id: record.id,
    source: record.source,
    type: record.type,
    fileName: record.fileName,
    label: record.label,
    groupId: record.groupId,
    createdAt: record.createdAt,
    splat: record.splat,
    image: record.image,
    generation:record.generation,
    collision:record.collision,
    burnable:record.burnable,
    giProxy:record.giProxy?structuredClone(record.giProxy):null,
    renderRoute: record.renderRoute,
    renderCapabilities: record.renderCapabilities,
    renderHandoffSchema: record.renderHandoffSchema,
    sceneTransform: record.sceneTransform,
    localLiquidEmitter: record.localLiquidEmitter,
    ...(record.type===FLAME_EMITTER_TYPE?{emissionEnabled:record.emissionEnabled,...(record.emission?{emission:record.emission}:{})}:{}),
  };
  return record;
}
