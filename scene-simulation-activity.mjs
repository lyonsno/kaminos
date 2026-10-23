// Reconcile editor visibility through the retained runtime's existing activity
// seam. A GPU initialization already in flight must not revive a hidden field.
export function createSceneSimulationActivity({prototype,wanted}) {
 let latest=null;
 return function sync() {
  const runtime=prototype();if(!runtime)return Promise.resolve();
  const active=Boolean(wanted());
  if(latest?.runtime===runtime&&latest.active===active&&(latest.pending||runtime.isActive()===active))return latest.promise;
  const request={runtime,active,pending:true,promise:null};latest=request;
  request.promise=Promise.resolve(runtime.setActive(active)).then(async()=>{
   if(latest!==request&&latest?.runtime===runtime&&!latest.active&&runtime.isActive())await runtime.setActive(false);
  }).finally(()=>{request.pending=false;});
  return request.promise;
 };
}
