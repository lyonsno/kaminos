// Whole-scene transitions compose the same registry and domain constructors as
// individual edits. Preview suspension retains identity; replacement ends it.
export function createSceneLifecycle({scene,roots,records,groups,selection,context={}}){
  const current=id=>id===null||scene.loads.isCurrent(id);
  let pendingClears=0;
  async function clear({loadRequestId=null}={}){
    if(loadRequestId!==null&&!current(loadRequestId))return false;
    if(loadRequestId===null)scene.loads.invalidate();
    const request=scene.loads.current(),generation=scene.invalidateArrivals();
    pendingClears++;
    try{
      // Keep the current scene intact until its admitted rendering has settled.
      await context.retire?.();
      if(!scene.loads.isCurrent(request)||scene.generation!==generation)return false;
      context.beforeClear?.();
      const rows=[...scene.objects,...scene.suspendedObjects()];
      scene.discardSuspendedMembership();
      context.clearDomains?.();
      const released=new Set();
      for(const entry of rows){if(released.has(entry.object))continue;released.add(entry.object);roots.detach(entry);roots.dispose(entry.object);}
      context.clearTransient?.(released);
      scene.clearMembership();context.cleared?.();
      return true;
    }finally{pendingClears--;}
  }
  async function replace(values,{loadRequestId=null,activeId=null,groups:nextGroups=[],activeGroupId=null,setup=null}={}){
    if(!current(loadRequestId))return false;
    if(!await clear({loadRequestId}))return false;
    context.beginLoad?.(setup);
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
    }catch(error){if(!current(loadRequestId))return false;await clear({loadRequestId});throw error;}
  }
  function capturePreview(){return context.capturePreview?.()??{};}
  async function previewTransition(change){
    const request=scene.loads.current(),generation=scene.invalidateArrivals();
    const isCurrent=()=>scene.loads.isCurrent(request)&&scene.generation===generation;
    pendingClears++;
    try{
      await context.retire?.();
      if(!isCurrent())return false;
      await change(isCurrent);
      return isCurrent();
    }finally{pendingClears--;}
  }
  function suspendPreview(){return previewTransition(()=>{
    const snapshot=scene.suspendMembership();
    for(const entry of snapshot.objects)roots.mount(entry,false);
    context.previewDetached?.();
  });}
  function resumePreview(saved){return previewTransition(async isCurrent=>{
    const snapshot=scene.resumeMembership();
    for(const entry of scene.objects){roots.mount(entry,true);roots.resumed?.(entry);}
    context.restorePreview?.(saved);
    if(snapshot.selection.ids.length)selection.set(snapshot.selection.ids,snapshot.selection.activeId);
    else if(saved.activeSceneFieldId)selection.set([saved.activeSceneFieldId],saved.activeSceneFieldId);
    else selection.object(null);
    await context.previewResumed?.(saved,{isCurrent});
  });}
  return Object.freeze({get clearing(){return pendingClears>0;},clear,replace,capturePreview,suspendPreview,resumePreview});
}
