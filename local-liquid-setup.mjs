import { Euler, Vector3 } from './lib/three.core.js';

export const LOCAL_LIQUID_SCHEMA = 'kaminos.local-liquid-setup.v1';
export const LEGACY_LOCAL_LIQUID_SCHEMA = 'kaminos.local-liquid-setup.v0';
export const LOCAL_LIQUID_EMITTER_SCHEMA = 'kaminos.local-liquid-emitter.v1';
export const LOCAL_LIQUID_EMITTER_TYPE = 'local-liquid-emitter';
export const LOCAL_LIQUID_EMITTER_SOURCE = 'kaminos:local-liquid-emitter';
export const LOCAL_LIQUID_EMITTER_CAPACITY = 5;

const clone = value => structuredClone(value);

export function defaultLocalLiquidSetup() {
  return {schema:LOCAL_LIQUID_SCHEMA,support:'retained_analytical_basin',particleCount:49152,densityIterations:3};
}

function checkedTriplet(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw Error(`Local liquid emitter ${name} requires three finite numbers`);
  }
  return [...value];
}

export function normalizeLocalLiquidEmitterPose(value) {
  if (!value || typeof value !== 'object') throw Error('Local liquid emitter transform is required');
  const pose = {
    position: checkedTriplet(value.position, 'position'),
    rotation: checkedTriplet(value.rotation, 'rotation'),
    scale: checkedTriplet(value.scale, 'scale'),
  };
  const scale=pose.scale[0];
  if (!(scale>0) || pose.scale.some(v=>Math.abs(v-scale)>1e-10*scale)) {
    throw Error('Water emitter aperture uses positive uniform scale; use S without an axis');
  }
  return pose;
}

export function normalizeLocalLiquidEmitter(value, pose = null) {
  if (!value || value.schema !== LOCAL_LIQUID_EMITTER_SCHEMA) throw Error('Unsupported local liquid emitter settings');
  for (const key of ['baseRadius','strength','rate']) {
    if (!Number.isFinite(value[key])) throw Error(`Invalid local liquid emitter ${key}`);
  }
  if (value.baseRadius < .035 || value.baseRadius > .18) throw Error('Local liquid emitter baseRadius must be between 0.035 and 0.18');
  if (value.strength < .25 || value.strength > 2.6) throw Error('Local liquid emitter strength must be between 0.25 and 2.6');
  if (value.rate < 0) throw Error('Invalid local liquid emitter rate');
  if (pose) {
    const checked=normalizeLocalLiquidEmitterPose(pose);
    const radius=value.baseRadius*checked.scale[0];
    if (radius < .035 || radius > .18) throw Error('Water emitter aperture must stay between 0.035 and 0.18');
  }
  return {schema:LOCAL_LIQUID_EMITTER_SCHEMA,baseRadius:value.baseRadius,strength:value.strength,rate:value.rate};
}

function normalizeLegacySetup(value) {
  const source=value.source;
  for(const key of ['x','y','z','radius','strength','rate']) {
    if(!Number.isFinite(source?.[key]))throw Error(`Invalid local liquid source.${key}`);
  }
  if(source.radius<.035 || source.radius>.18)throw Error('Local liquid source.radius must be between 0.035 and 0.18');
  if(source.strength<.25 || source.strength>2.6)throw Error('Local liquid source.strength must be between 0.25 and 2.6');
  if(source.rate<0)throw Error('Invalid local liquid source.rate');
  return {...normalizeLocalLiquidSetupCore(value),legacySource:clone(source)};
}

function normalizeLocalLiquidSetupCore(value) {
  if(value.support!=='retained_analytical_basin')throw Error('Unsupported local liquid support');
  for(const key of ['particleCount','densityIterations']) {
    if(!Number.isSafeInteger(value[key]) || value[key]<1)throw Error(`Invalid local liquid ${key}`);
  }
  return {schema:LOCAL_LIQUID_SCHEMA,support:value.support,particleCount:value.particleCount,densityIterations:value.densityIterations};
}

export function normalizeLocalLiquidSetup(value) {
  if(value==null)return null;
  if(typeof value!=='object' || Array.isArray(value))throw Error('Local liquid setup must be an object');
  if(value.schema===LEGACY_LOCAL_LIQUID_SCHEMA)return normalizeLegacySetup(value);
  if(value.schema!==LOCAL_LIQUID_SCHEMA)throw Error('Unsupported local liquid schema');
  if(Object.hasOwn(value,'source'))throw Error('Local liquid source pose belongs to a scene emitter object');
  return normalizeLocalLiquidSetupCore(value);
}

export function legacyLocalLiquidEmitterRecord(source, id='local-liquid-emitter-legacy') {
  const legacy={schema:LEGACY_LOCAL_LIQUID_SCHEMA,support:'retained_analytical_basin',particleCount:1,densityIterations:1,source};
  normalizeLegacySetup(legacy);
  return {id,source:LOCAL_LIQUID_EMITTER_SOURCE,type:LOCAL_LIQUID_EMITTER_TYPE,
    fileName:'Water emitter',label:'Water emitter',groupId:null,createdAt:null,
    transform:{position:[source.x,source.y,source.z],rotation:[Math.atan2(.25,1),0,0],scale:[1,1,1]},
    materials:null,splat:null,image:null,renderRoute:null,renderCapabilities:null,renderHandoffSchema:null,
    localLiquidEmitter:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,baseRadius:source.radius,strength:source.strength,rate:source.rate}};
}

export function localLiquidInletPacket(setup, sceneEmitters = [], generation = 1) {
  const checked=normalizeLocalLiquidSetup(setup);
  if(!checked)throw Error('Local liquid setup is required to create an inlet packet');
  if(checked.legacySource)throw Error('Legacy local liquid source must migrate into a scene emitter before mounting');
  if(!Array.isArray(sceneEmitters))throw Error('Local liquid emitters must be an array');
  if(sceneEmitters.length>LOCAL_LIQUID_EMITTER_CAPACITY) {
    throw Error(`Local liquid emitter count ${sceneEmitters.length} exceeds retained solver capacity ${LOCAL_LIQUID_EMITTER_CAPACITY}`);
  }
  const emitters=sceneEmitters.map((record,index)=>{
    if(record?.type!==LOCAL_LIQUID_EMITTER_TYPE || typeof record.id!=='string' || !record.id) {
      throw Error(`Invalid local liquid emitter scene object at index ${index}`);
    }
    const pose=normalizeLocalLiquidEmitterPose(record.transform);
    const settings=normalizeLocalLiquidEmitter(record.localLiquidEmitter,pose);
    const radius=settings.baseRadius*pose.scale[0];
    const aim=new Vector3(0,0,1).applyEuler(new Euler(...pose.rotation)).normalize().toArray();
    return {id:record.id,active:settings.rate>0,emission_state:settings.rate>0?'jet':'off',
      origin_world:pose.position,aim_world:aim,radius:radius/1.45,strength:settings.strength/1.35,
      // `particleCount` is the scene-wide solver pool. Leaving per-inlet
      // budgets unspecified lets the retained solver share that pool across
      // active emitters instead of reserving the whole pool once per object.
      source_flux_particles_per_second:settings.rate,residence_seconds:20};
  });
  return {packet_id:`kaminos-authored-liquid-${generation}`,route_identity:'kaminos-authored-liquid-source-v1',
    simulation_authority:'live_simulation',authority:{simulation_safe:true,stale:false},emitters};
}
