// Native placement stays synchronous; asynchronous domain construction settles
// before its insertion enters history. A failed construction owns only its copies.
export function createDuplicateCommit({edits,ready,ids,commit,cancel,cancelPlacement=()=>{},onError=()=>{}}){
 const owned=new Set(ids);let stopped=false,accepted=false,resolved=!ready,started=false;
 const owns=entry=>owned.has(entry.id)||[...owned].some(id=>entry.id.endsWith(':'+id))
  ||entry.id==='@scene-selection'&&[entry.before,entry.after].some(value=>value?.ids?.some(id=>owned.has(id)))
  ||entry.id==='@selection-transform'&&[entry.before,entry.after].some(value=>Object.keys(value?.roots??{}).some(id=>owned.has(id)));
 async function reject(error){
  if(stopped)return;stopped=true;
  try{
   if(edits.state().active&&owns(edits.state().active))cancelPlacement();
   if(edits.state().active||edits.state().replaying)await new Promise(resolve=>{const unsubscribe=edits.subscribe(state=>{if(!state.active&&!state.replaying){unsubscribe();resolve();}});});
   edits.discard(owns);await cancel();
  }catch(cleanup){error=new AggregateError([error,cleanup],'Duplicate initialization and cleanup failed');}
  onError(error);
 }
 async function insert(){if(stopped||started)return;started=true;try{if(ready){if(edits.state().active||edits.state().replaying)await new Promise(resolve=>{const unsubscribe=edits.subscribe(state=>{if(!state.active&&!state.replaying){unsubscribe();resolve();}});});if(stopped)return;edits.discard(owns);}await commit();stopped=true;}catch(error){void reject(error);}}
 if(ready)Promise.resolve(ready).then(()=>{resolved=true;if(accepted)insert();},reject);
 return ({commit:keep})=>{if(stopped)return;if(!keep){stopped=true;return cancel();}accepted=true;if(resolved)insert();};
}
