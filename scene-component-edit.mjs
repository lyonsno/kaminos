// Domain owners supply components; the app retains mode, selection and transform grammar.
// Child contexts share the scene owner; only the top context handles input.
export function createSceneComponentEdit({selected,cancel,refresh}){
 const owners=new Map();let stack=[],leaving=false;
 const current=()=>stack.at(-1);
 function exit(){
  if(!stack.length||leaving)return;leaving=true;
  try{cancel();while(stack.length)stack.pop().adapter.exit();refresh();}finally{leaving=false;}
 }
 function active(){if(stack.length&&!(stack[0].adapter.isCurrent?.()??(selected()===stack[0].id)))exit();return !!stack.length;}
 function back(){
  if(!active()||leaving)return false;
  if(stack.length===1){exit();return true;}
  leaving=true;try{cancel();stack.pop().adapter.exit();refresh();}finally{leaving=false;}return true;
 }
 function enterChild(){
  if(!active())return false;const parent=current(),adapter=parent.adapter.child?.();if(!adapter)return false;
  if(!['target','enter','exit'].every(k=>typeof adapter[k]==='function'))throw Error('Child editing requires target, enter and exit');
  cancel();adapter.enter();stack.push({id:parent.id,adapter});refresh();return true;
 }
 function target(){if(!active())return null;const value=current().adapter.target();return value?{...value,ownerId:current().id}:null;}
 return {
  active,target,exit,back,
  scope(){return active()?current().adapter.scope?.()??null:null;},
  ownsTransforms(){return active()&&!current().adapter.scope;},
  resolve(id){const value=target();return value?.id===id?value:null;},
  toggle(id){
   if(active())return enterChild()||back();
   const adapter=owners.get(id);if(!adapter)return false;
   cancel();stack=[{id,adapter}];try{adapter.enter();refresh();return true;}catch(error){exit();throw error;}
  },
  pick(event,context){if(!active())return false;current().adapter.pick?.(event,context);return true;},
  selectAll(action){if(active())current().adapter.selectAll?.(action);},
  remove(){if(!active()||!current().adapter.remove)return false;cancel();try{current().adapter.remove();return true;}finally{refresh();}},
  register(id,adapter){
   if(!id||owners.has(id)||!['target','enter','exit'].every(k=>typeof adapter?.[k]==='function'))throw Error('Component editing requires one adapter per scene object');
   owners.set(id,adapter);let disposed=false;
   return {
    active:()=>!disposed&&stack[0]?.id===id&&selected()===id,
    enter(){if(disposed)throw Error('Component adapter disposed');if(selected()!==id)throw Error('Select the component owner first');if(stack[0]?.id===id)return true;exit();cancel();adapter.enter();stack=[{id,adapter}];refresh();return true;},
    enterChild(){if(disposed||stack[0]?.id!==id)throw Error('Enter the component owner first');return enterChild();},
    back(){if(stack[0]?.id!==id)return false;return back();},
    changed(change=()=>{}){if(disposed)throw Error('Component adapter disposed');cancel();change();refresh();},
    dispose(){if(disposed)return;if(stack[0]?.id===id)exit();owners.delete(id);disposed=true;},
   };
  },
 };
}
