import vm from 'node:vm';

// Domain-unit fixture adapter. These tests deliberately stub the scene service
// while exercising extracted page consumers. Ownership/integration tests use
// createWorkingScene itself; this double is not evidence for its invariants.
export function sceneContext(context, options) {
  if (!context.workingScene) {
    context.sceneObjects ??= [];
    context.sceneGroups ??= [];
    context.sceneSelection ??= {ids:[],activeId:null};
    const retained=context.retainedSceneMembershipObjects ?? new Map();
    const disposers=context.retainedSceneMembershipDisposers ?? new WeakMap();
    const service={
      get objects(){return context.sceneObjects;},
      get groups(){return context.sceneGroups;},
      get selection(){return context.sceneSelection;},
      get activeObjectId(){return context.activeSceneObjectId??null;},
      get activeGroupId(){return context.activeSceneGroupId??null;},
      get activeFieldId(){return context.activeSceneFieldId??null;},
      get generation(){return context.sceneMutationToken??0;},
      find:id=>context.sceneObjects.find(row=>row.id===id),
      findRoot:root=>context.sceneObjects.find(row=>row.object===root),
      replaceObjects:rows=>context.sceneObjects=rows,
      put(record,{index=null}={}){context.sceneObjects=context.sceneObjects.filter(row=>row.id!==record.id);context.sceneObjects.splice(index??context.sceneObjects.length,0,record);return record;},
      forget(id){const row=service.find(id);context.sceneObjects=context.sceneObjects.filter(row=>row.id!==id);return row;},
      move(id,index){return service.put(service.find(id),{index});},
      reorder:ids=>context.sceneObjects=ids.map(service.find),
      setGroups(rows){context.sceneGroups=structuredClone(rows);for(const row of context.sceneObjects){row.groupId=rows.find(g=>g.objectIds.includes(row.id))?.id??null;if(row.object?.userData?.kaminosSceneObject)row.object.userData.kaminosSceneObject.groupId=row.groupId;}},
      updateGroup(id,patch){const group=context.sceneGroups.find(g=>g.id===id);Object.assign(group,patch);return group;},
      pruneGroups(){service.setGroups(context.sceneGroups.map(g=>({...g,objectIds:g.objectIds.filter(id=>service.find(id))})).filter(g=>g.objectIds.length));},
      select(ids,activeId=ids.at(-1)??null){context.sceneSelection={ids:[...ids],activeId};context.activeSceneFieldId=['flame-field','water-field'].includes(activeId)?activeId:null;context.activeSceneGroupId=activeId?.startsWith('@group:')?activeId.slice(7):null;context.activeSceneObjectId=context.activeSceneFieldId||context.activeSceneGroupId?null:activeId;},
      pruneSelection({fields=[]}={}){const ids=context.sceneSelection.ids.filter(id=>service.find(id)||context.sceneGroups.some(g=>'@group:'+g.id===id)||fields.includes(id));service.select(ids,ids.includes(context.sceneSelection.activeId)?context.sceneSelection.activeId:ids.at(-1)??null);},
      clearSelection(){service.select([]);},
      clearMembership(){context.sceneObjects=[];context.sceneGroups=[];service.clearSelection();},
      invalidateArrivals(){return context.sceneMutationToken=(context.sceneMutationToken??0)+1;},
      arrival(){const generation=service.generation;return {isCurrent:()=>service.generation===generation,assertCurrent(){if(service.generation!==generation)throw Error('Scene changed while preparing the asset');}};},
      retain(row,dispose){retained.set(row.id,row);if(dispose)disposers.set(row.object,dispose);},
      retained:id=>retained.get(id),retainedObjects:()=>[...retained.values()],
      releaseUnreferenced(referenced,dispose){for(const [id,row] of retained){if(referenced(id))continue;retained.delete(id);const release=disposers.get(row.object)||dispose;disposers.delete(row.object);if(!context.sceneObjects.some(item=>item.id===id&&item.object===row.object))release(row.object,row);}},
    };
    context.workingScene=service;
  }
  context.sceneMembership ??= {
    retainForHistory(id,target){context.compoundRetentionTargets?.set(id,target);},
    clearHistoryTargets(){for(const id of context.sceneMembershipEditTargets??[])context.scenePlacementTools.edits.unregister(id);context.sceneMembershipEditTargets?.clear();context.compoundRetentionTargets?.clear();},
  };
  return vm.createContext(context,options);
}

export function runInSceneContext(code, context, options) {
  return vm.runInContext(code,sceneContext(context),options);
}
