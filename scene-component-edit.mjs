// Domain owners supply components; the app retains mode, selection and transform grammar.
export function createSceneComponentEdit({selected,cancel,refresh}){
 const owners=new Map();let current=null,leaving=false;
 function exit(){
  if(!current||leaving)return;leaving=true;
  try{cancel();const owner=current;current=null;owner.adapter.exit();refresh();}finally{leaving=false;}
 }
 function active(){if(current&&selected()!==current.id)exit();return !!current;}
 function target(){if(!active())return null;const value=current.adapter.target();return value?{...value,ownerId:current.id}:null;}
 return {
  active,target,exit,
  context(){return active()?{ownerId:current.id}:null;},
  resolve(id){const value=target();return value?.id===id?value:null;},
  toggle(id){
   if(active()){exit();return true;}
   const adapter=owners.get(id);if(!adapter)return false;
   cancel();adapter.enter();current={id,adapter};refresh();return true;
  },
  pick(event,context){if(!active())return false;current.adapter.pick?.(event,context);return true;},
  hover(event,context){if(!active())return false;current.adapter.hover?.(event,context);return true;},
  cancel(){return active()&&current.adapter.cancel?.()===true;},
  selectAll(action){if(active())current.adapter.selectAll?.(action);},
  register(id,adapter){
   if(!id||owners.has(id)||!['target','enter','exit'].every(k=>typeof adapter?.[k]==='function'))throw Error('Component editing requires one adapter per scene object');
   owners.set(id,adapter);let disposed=false;
   return {
    enter(){if(disposed)throw Error('Component adapter disposed');if(selected()!==id)throw Error('Select the component owner first');if(current?.id===id)return;exit();cancel();adapter.enter();current={id,adapter};refresh();},
    changed(change=()=>{}){if(disposed)throw Error('Component adapter disposed');cancel();change();refresh();},
    dispose(){if(disposed)return;if(current?.id===id)exit();owners.delete(id);disposed=true;},
   };
  },
 };
}
