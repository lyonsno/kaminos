// Whole-scene transitions compose the same registry and domain constructors as
// individual edits. Preview suspension retains identity; replacement ends it.
export function createSceneLifecycle({scene,roots,records,groups,selection,context={}}){
  const current=id=>id===null||scene.loads.isCurrent(id);
  function clear({loadRequestId=null}={}){
    if(!current(loadRequestId)||loadRequestId===null)scene.loads.invalidate();
    context.beforeClear?.();
    scene.invalidateArrivals();
    const rows=[...scene.objects,...scene.suspendedObjects()];
    scene.discardSuspendedMembership();
    context.clearDomains?.();
    const released=new Set();
    for(const entry of rows){if(released.has(entry.object))continue;released.add(entry.object);roots.detach(entry);roots.dispose(entry.object);}
    context.clearTransient?.(released);
    scene.clearMembership();context.cleared?.();
  }
  async function replace(values,{loadRequestId=null,activeId=null,groups:nextGroups=[],activeGroupId=null,setup=null}={}){
    if(!current(loadRequestId))return false;
    clear({loadRequestId});context.beginLoad?.(setup);
    const loaded=[];
    try{
      for(const record of values){
        const object=await records.load(record,loadRequestId);
        if(!current(loadRequestId))return false;
        const entry=scene.find(record.id);
        if(!entry||entry.object!==object)throw Error(`Scene object "${record.id}" did not publish its loaded identity`);
        records.restore(entry,record);loaded.push(record.id);
      }
      await context.loaded?.(setup,loadRequestId);
      if(!current(loadRequestId))return false;
      groups.restore(nextGroups,activeGroupId);
      if(activeGroupId&&scene.groups.some(group=>group.id===activeGroupId))selection.group(activeGroupId);
      else selection.object(activeId&&loaded.includes(activeId)?activeId:loaded.at(-1));
      return true;
    }catch(error){if(!current(loadRequestId))return false;clear({loadRequestId});throw error;}
  }
  function capturePreview(){return context.capturePreview?.()??{};}
  function suspendPreview(){
    scene.invalidateArrivals();const snapshot=scene.suspendMembership();
    for(const entry of snapshot.objects)roots.mount(entry,false);
    context.previewDetached?.();
  }
  function resumePreview(saved){
    scene.invalidateArrivals();const snapshot=scene.resumeMembership();
    for(const entry of scene.objects){roots.mount(entry,true);roots.resumed?.(entry);}
    context.restorePreview?.(saved);
    if(snapshot.selection.ids.length)selection.set(snapshot.selection.ids,snapshot.selection.activeId);
    else if(saved.activeSceneFieldId)selection.set([saved.activeSceneFieldId],saved.activeSceneFieldId);
    else selection.object(null);
    context.previewResumed?.();return true;
  }
  return Object.freeze({clear,replace,capturePreview,suspendPreview,resumePreview});
}
