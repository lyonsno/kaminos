import {resolveBurnableTarget} from './burnable-target.mjs';

export function createBurnableSelection({objects,create,changed=()=>{}}){
 let current=null,id=null,busy=false,disposed=false,transition=null,disposal=null;
 const closed=()=>Object.assign(Error('Burnable selection is disposed'),{code:'BURNABLE_DISPOSED'});
 async function set({objectId,enabled=true}){
  if(disposed)throw Error('Burnable selection is disposed');
  if(busy)throw Error('Burnable target is changing');
  if(typeof enabled!=='boolean')throw Error('Burnable enabled must be Boolean');
  if(enabled)resolveBurnableTarget(objects(),objectId);
  if(enabled&&id===objectId||!enabled&&id!==objectId)return read();
  busy=true;const previous=current;current=null;id=null;changed(null);
  const task=(async()=>{try{
    await previous?.dispose();if(disposed)throw closed();
    if(enabled){const instance=await create(objectId);if(disposed){await instance.dispose();throw closed();}current=instance;id=objectId;changed(instance);}
    return read();
   }finally{busy=false;}})();
  transition=task;task.finally(()=>{if(transition===task)transition=null;}).catch(()=>{});
  return task;
 }
 const read=()=>({objectId:id,busy,active:!!current,state:current?.read()??null});
 return {set,read,get:()=>current,dispose(){
  if(disposal)return disposal;disposed=true;
  disposal=(async()=>{
   const errors=[];try{await transition;}catch(error){if(error.code!=='BURNABLE_DISPOSED')errors.push(error);}
   const instance=current;current=null;id=null;changed(null);
   try{await instance?.dispose();}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'Burnable disposal failed');
  })();return disposal;
 }};
}
