// A temporary borrower of the page's native field, for scenes without ordinary
// fire. Preparation owns resources; presentation and admission only switch use.
export function createMountedWorkshopFire({ordinary,epoch,acquire}){
 let resource=null,pending=null,disposed=false,withdrawn=false,visible=false,requested=false,emitting=false,error=null,version=0;
 let serial=Promise.resolve(),frame=null;
 const valid=()=>!disposed&&!withdrawn&&!ordinary();
 const read=()=>({phase:disposed?'disposed':error?'failed':pending?'preparing':resource?'prepared':'unprepared',visible,requested,emitting,error});
 async function release(){const old=resource;resource=null;if(old){old.setEmission(false);await old.setActive(false);await old.dispose();}}
 function reconcile(){
  const run=serial.catch(()=>{}).then(async()=>{
   if(!valid()){await release();if(ordinary()){error='The workshop cannot borrow an ordinary flame field.';throw Error(error);}return;}
   if(!resource)return;
   if(frame)resource.setFrame(frame);
   resource.setEmission(visible&&requested&&emitting);
   await resource.setActive(visible&&requested);
  });serial=run;return run;
 }
 const api={read,
  prepare(){
   if(!valid())return Promise.reject(Error(ordinary()?'The workshop cannot borrow an ordinary flame field.':'Workshop fire is withdrawn'));
   if(resource)return Promise.resolve(read());if(pending)return pending;
   const documentEpoch=epoch(),token=version;error=null;
   pending=Promise.resolve().then(acquire).then(async next=>{
    if(!valid()||documentEpoch!==epoch()||token!==version){await next.dispose();throw Error('The document changed during workshop fire preparation.');}
    resource=next;resource.setEmission(false);await resource.setActive(false);return read();
   }).catch(e=>{error=e.message;throw e;}).finally(()=>{pending=null;});return pending;
  },
  present(value,nextFrame=frame){const next=Boolean(value),changed=next!==visible;visible=next;frame=nextFrame;if(resource&&valid()&&frame)resource.setFrame(frame);return changed||!valid()?reconcile():serial;},
  setActive(value){requested=Boolean(value);if(requested&&!resource)return Promise.reject(Error(error||'Workshop fire is still preparing'));return reconcile();},
  setEmission(value){emitting=Boolean(value);if(resource&&valid())resource.setEmission(visible&&requested&&emitting);},
  async withdraw(){withdrawn=true;version++;requested=false;emitting=false;await serial.catch(()=>{});await release();await pending?.catch(()=>{});},
  async dispose(){if(disposed)return;disposed=true;await api.withdraw();},
 };
 return api;
}
