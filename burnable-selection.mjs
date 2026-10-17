import {resolveBurnableTarget} from './burnable-target.mjs';

export function createBurnableSelection({objects,create,changed=()=>{}}){
 let current=null,id=null,busy=false,disposed=false;
 async function set({objectId,enabled=true}){
  if(disposed)throw Error('Burnable selection is disposed');
  if(busy)throw Error('Burnable target is changing');
  if(typeof enabled!=='boolean')throw Error('Burnable enabled must be Boolean');
  if(enabled)resolveBurnableTarget(objects(),objectId);
  if(enabled&&id===objectId||!enabled&&id!==objectId)return read();
  busy=true;
  try{
   const previous=current;current=null;id=null;changed(null);
   await previous?.dispose();
   if(enabled){const instance=await create(objectId);if(disposed){await instance.dispose();throw Error('Burnable selection is disposed');}current=instance;id=objectId;changed(instance);}
   return read();
  }finally{busy=false;}
 }
 const read=()=>({objectId:id,busy,active:!!current,state:current?.read()??null});
 return {set,read,get:()=>current,async dispose(){disposed=true;const instance=current;current=null;id=null;changed(null);await instance?.dispose();}};
}
