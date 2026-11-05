import {checkedBurnable} from './scene-burning-settings.mjs';
import {sceneRecordDomains} from './scene-record-domains.mjs';
import {checkedObjectCollision,canCollideWithFire} from './scene-collider.mjs';
import {checkedGiProxySetting} from './scene-gi-proxy-settings.mjs';
import {checkedRepetition} from './scene-repetition.mjs';

const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

// Domain contributions own payloads and constructors. This service owns the
// common envelope and dispatch; each application supplies its actual mounts.
export function createSceneRecordOperations({domains=sceneRecordDomains,readers={},loaders={}}={}) {
  const types=new Map(),sources=new Map();
  for(const domain of domains) {
    if(!domain||typeof domain.type!=='string'||typeof domain.fields!=='function')throw Error('Scene record domain requires a type and fields operation');
    const table=domain.source===undefined?types:sources,key=domain.source===undefined?domain.type:JSON.stringify([domain.type,domain.source]);
    if(table.has(key))throw Error('Duplicate scene record domain: '+key);
    table.set(key,Object.freeze({...domain}));
  }
  const domainFor=record=>sources.get(JSON.stringify([record?.type??'glb',record?.source]))??types.get(record?.type??'glb');
  const properties=record=>({...structuredClone(domainFor(record)?.fields(record)??{}),...(record.burnable!=null?{burnable:checkedBurnable(record)}:{})});
  const installed=[...types.values(),...sources.values()];
  function describe(object,metadata) {
    const owners=installed.filter(domain=>domain.recognize?.(object));
    if(owners.length>1)throw Error('Scene root has conflicting source owners');
    return owners.length?{...metadata,...owners[0].capture({object,...metadata},{metadata,readers})}:metadata;
  }

  function normalize(raw) {
    if(!raw||typeof raw!=='object')throw Error('Scene object record must be an object');
    const domain=domainFor(raw),record=domain?.check?domain.check(raw):raw;
    if(domain?.documentOnly)return record;
    const id=String(record.id||record.fileName||record.source||'object');
    return {
      id,source:record.source??null,type:record.type??'glb',fileName:record.fileName??'object.glb',
      label:record.label??record.fileName??id,groupId:record.groupId??null,createdAt:record.createdAt??null,
      transform:copy(record.transform??{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),
      materials:copy(record.materials??null),splat:copy(record.splat??null),image:copy(record.image??null),
      ...(record.generation?{generation:copy(record.generation)}:{}),
      ...(record.assetOrigin?{assetOrigin:copy(record.assetOrigin)}:{}),
      renderRoute:record.renderRoute??null,renderCapabilities:copy(record.renderCapabilities??null),renderHandoffSchema:record.renderHandoffSchema??null,
      ...(record.emission?{emission:copy(record.emission)}:{}),
      ...((canCollideWithFire(record)||record.collision!=null)?{collision:checkedObjectCollision(record)}:{}),
      ...(record.giProxy!=null?{giProxy:checkedGiProxySetting({...record,type:record.type??'glb'},record.giProxy)}:{}),
      ...(record.burnable!=null?{burnable:checkedBurnable(record)}:{}),
      ...(record.repetition?{repetition:checkedRepetition(record.repetition)}:{}),
      ...(record.arrivalLeveling&&typeof record.arrivalLeveling==='object'?{arrivalLeveling:copy(record.arrivalLeveling)}:{}),
      ...properties(record),
    };
  }

  function serialize(entry) {
    const object=entry.object,metadata=describe(object,object?.userData?.kaminosSceneObject??entry);
    const value={id:entry.id,source:metadata.source??entry.source,type:metadata.type??entry.type,
      fileName:metadata.fileName??entry.fileName,label:metadata.label??entry.label,
      groupId:metadata.groupId??entry.groupId??null,createdAt:metadata.createdAt??entry.createdAt,
      transform:readers.transform(object),sceneTransform:null,materials:readers.materials(object),
      splat:metadata.splat??entry.splat??null,image:metadata.image??entry.image??null,
      ...((metadata.generation??entry.generation)?{generation:structuredClone(metadata.generation??entry.generation)}:{}),
      ...((metadata.assetOrigin??entry.assetOrigin)?{assetOrigin:structuredClone(metadata.assetOrigin??entry.assetOrigin)}:{}),
      renderRoute:metadata.renderRoute??entry.renderRoute??null,renderCapabilities:metadata.renderCapabilities??entry.renderCapabilities??null,
      renderHandoffSchema:metadata.renderHandoffSchema??entry.renderHandoffSchema??null,localLiquidEmitter:null,
      ...(object?.userData?.kaminosLeveling?{arrivalLeveling:structuredClone(object.userData.kaminosLeveling)}:{}),
      ...(canCollideWithFire(entry)?{collision:checkedObjectCollision(entry)}:{}),
      ...(entry.giProxy?{giProxy:structuredClone(entry.giProxy)}:{}),
      ...(entry.burnable?{burnable:structuredClone(entry.burnable)}:{}),
      ...(entry.repetition?{repetition:checkedRepetition(entry.repetition)}:{}),
      ...properties({...metadata,...entry}),
    };
    return {...value,...domainFor(value)?.capture?.(entry,{readers,metadata})};
  }

  function reloadable(record) {
    try{return domainFor(record)?.reloadable?.(record)===true;}catch{return false;}
  }
  function assertReloadable(records) {
    for(const record of records) {
      if(!domainFor(record)?.documentOnly && !reloadable(record))throw Error(`Scene object "${record.fileName||record.id}" must be re-dropped; source "${record.source}" is not reloadable`);
    }
  }
  async function load(record,options={}) {
    if(!record?.source)throw Error('Scene object missing source');
    const domain=domainFor(record);
    if(!reloadable(record)||typeof domain?.load!=='function')throw Error(`Scene object "${record.fileName||record.id}" must be re-dropped; source "${record.source}" is not reloadable`);
    return domain.load(record,loaders,options);
  }
  return Object.freeze({normalize,properties,describe,serialize,reloadable,assertReloadable,load});
}

export const defaultSceneRecordOperations=createSceneRecordOperations();
export const normalizeSceneObjectRecord=defaultSceneRecordOperations.normalize;
