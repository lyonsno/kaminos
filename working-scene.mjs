import { createSceneLoadRequests } from './scene-load-generation.mjs';
import { checkedSelection } from './scene-selection.mjs';

// The authored registry and its live roots share one lifetime. Domain records
// remain domain-owned; membership, group topology, selection and admission do
// not. Reads expose immutable topology, never an array a consumer can splice.
export function createWorkingScene() {
  let objects = Object.freeze([]), groups = Object.freeze([]);
  let selection = freezeSelection(checkedSelection([]));
  let generation = 0;
  const loads = createSceneLoadRequests();
  const retained = new Map(), disposers = new WeakMap();

  function freezeSelection(value) {
    return Object.freeze({ids:Object.freeze([...value.ids]),activeId:value.activeId});
  }
  function freezeData(value) {
    if(value && typeof value==='object') {
      for(const child of Object.values(value))freezeData(child);
      Object.freeze(value);
    }
    return value;
  }
  function checkedObjects(rows) {
    const ids = new Set(), roots = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id || !row.object || ids.has(row.id) || roots.has(row.object)) {
        throw Error('Scene membership requires unique object IDs and roots');
      }
      ids.add(row.id); roots.add(row.object);
    }
    for(const row of rows) {
      Object.defineProperty(row,'id',{value:row.id,writable:false,configurable:false,enumerable:true});
      Object.defineProperty(row,'object',{value:row.object,writable:false,configurable:false,enumerable:true});
    }
    return Object.freeze([...rows]);
  }
  function setGroups(next) {
    const ids = new Set(), members = new Set(), present = new Set(objects.map(row=>row.id));
    const checked = next.map(group => {
      if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) || !Array.isArray(group.objectIds)) throw Error('Invalid scene group identity');
      ids.add(group.id);
      const objectIds = [...new Set(group.objectIds)];
      for (const id of objectIds) {
        if (!present.has(id) || members.has(id)) throw Error('Scene group contains an absent or already grouped object');
        members.add(id);
      }
      return freezeData({...structuredClone(group),objectIds});
    }).filter(group=>group.objectIds.length);
    groups = Object.freeze(checked);
    for (const row of objects) {
      row.groupId = groups.find(group=>group.objectIds.includes(row.id))?.id ?? null;
      if(row.object.userData?.kaminosSceneObject)row.object.userData.kaminosSceneObject.groupId=row.groupId;
    }
    return groups;
  }
  function pruneGroups() {
    const present = new Set(objects.map(row=>row.id));
    return setGroups(groups.map(group=>({...group,objectIds:group.objectIds.filter(id=>present.has(id))})));
  }
  function select(ids,activeId=ids.at(-1)??null,fields=[]) {
    const valid=new Set([...objects.map(row=>row.id),...groups.map(group=>'@group:'+group.id),...fields]);
    if(ids.some(id=>!valid.has(id)))throw Error('Selection contains an absent scene item');
    selection=freezeSelection(checkedSelection(ids,activeId));
    return selection;
  }
  function pruneSelection({fields=[]}={}) {
    const valid=new Set([...objects.map(row=>row.id),...groups.map(group=>'@group:'+group.id),...fields]);
    const ids=selection.ids.filter(id=>valid.has(id));
    return select(ids,ids.includes(selection.activeId)?selection.activeId:ids.at(-1)??null,fields);
  }
  const api = {
    get objects(){return objects;}, get groups(){return groups;}, get selection(){return selection;},
    get activeFieldId(){return ['flame-field','water-field'].includes(selection.activeId)?selection.activeId:null;},
    get activeGroupId(){return selection.activeId?.startsWith('@group:')?selection.activeId.slice(7):null;},
    get activeObjectId(){return api.activeFieldId||api.activeGroupId?null:selection.activeId;},
    get generation(){return generation;}, loads,
    find:id=>objects.find(row=>row.id===id), findRoot:root=>objects.find(row=>row.object===root),
    put(record,{index=null}={}) {
      const next=objects.filter(row=>row.id!==record.id);
      next.splice(index===null?next.length:Math.min(index,next.length),0,record);
      objects=checkedObjects(next);return record;
    },
    forget(id) {
      const record=api.find(id);if(!record)return undefined;
      objects=Object.freeze(objects.filter(row=>row!==record));
      pruneGroups();pruneSelection({fields:['flame-field','water-field']});return record;
    },
    replaceObjects(rows){objects=checkedObjects(rows);return objects;},
    reorder(ids){
      if(ids.length!==objects.length||new Set(ids).size!==ids.length||ids.some(id=>!api.find(id)))throw Error('Scene order must contain every current member once');
      objects=Object.freeze(ids.map(id=>api.find(id)));return objects;
    },
    move(id,index){const record=api.find(id);if(!record)throw Error('Scene member is absent');return api.put(record,{index});},
    setGroups,pruneGroups,select,pruneSelection,
    updateGroup(id,patch){const group=groups.find(row=>row.id===id);if(!group)throw Error('Scene group is absent');setGroups(groups.map(row=>row.id===id?{...row,...patch,id}:row));return groups.find(row=>row.id===id);},
    clearSelection(){selection=freezeSelection(checkedSelection([]));},
    invalidateArrivals(){return ++generation;},
    arrival(){
      const expected=generation;
      return Object.freeze({isCurrent:()=>generation===expected,assertCurrent(){if(generation!==expected)throw Error('Scene changed while preparing the asset; the saved artifact remains available');}});
    },
    retain(record,dispose){retained.set(record.id,record);if(dispose)disposers.set(record.object,dispose);},
    retained:id=>retained.get(id),
    retainedObjects:()=>[...retained.values()],
    releaseUnreferenced(isReferenced,dispose){
      for(const [id,record] of retained){
        if(isReferenced(id))continue;
        retained.delete(id);
        const release=disposers.get(record.object)||dispose;disposers.delete(record.object);
        if(!objects.some(row=>row.id===id&&row.object===record.object))release(record.object,record);
      }
    },
    clearMembership(){objects=Object.freeze([]);groups=Object.freeze([]);api.clearSelection();},
  };
  return Object.freeze(api);
}
