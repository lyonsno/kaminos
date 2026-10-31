// Reconcile activity of a borrowed runtime. Retirement stops its work without
// destroying shared GPU/scene services or the retained simulation state.
export function createSceneSimulationActivity({prototype,wanted}) {
 let latest=null;
 return function sync() {
  const runtime=prototype(),active=!!runtime&&Boolean(wanted());
  if(!runtime){
   const previous=latest;latest=null;
   return previous?Promise.resolve(previous.runtime.setActive(false)):Promise.resolve();
  }
  if(latest?.runtime===runtime&&latest.active===active&&(latest.pending||runtime.isActive()===active))return latest.promise;
  const previous=latest,request={runtime,active,pending:true,promise:null};latest=request;
  const retirement=previous&&previous.runtime!==runtime?Promise.resolve(previous.runtime.setActive(false)):Promise.resolve();
  request.promise=Promise.all([retirement,Promise.resolve(runtime.setActive(active))]).then(async()=>{
   if(runtime.isActive()&&(prototype()!==runtime||!wanted()))await runtime.setActive(false);
  }).finally(()=>{request.pending=false;});
  return request.promise;
 };
}
