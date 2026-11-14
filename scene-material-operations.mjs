import {checkMaterialParameters} from './scene-material-recipes.mjs';

// The native inspector and worker share recipe/assignment semantics. Each
// consumer supplies its own admitted apply and resource-preparation boundary.
export function createSceneMaterialOperations({materials,definitions,selected,apply,
 assertAvailable=()=>{},readSlot=()=>null,prepare=run=>run()}){
 const registry=new Map(definitions.map(d=>[d.id,d])),pendingSources=new Map();
 const id=()=>globalThis.crypto.randomUUID();
 function selectedById(objectId){const entry=objectId?selected(objectId):selected();if(!entry)throw Error('Select a mesh');return entry;}
 function applied(value,label,result){const pending=apply(value,label);return pending&&typeof pending.then==='function'?Promise.resolve(pending).then(()=>result):result;}
 const api={
  read:()=>materials.document(),
  slots:objectId=>materials.slots(selectedById(objectId)).map(({key,label,recipeId})=>({key,label,recipeId})),
  create({objectId,slot:requested,implementation='asset-surface',name,parameters:requestedParameters}={}){
   const entry=selectedById(objectId),slots=materials.slots(entry),slot=requested!==undefined?slots.find(s=>s.key===requested):(slots.find(s=>s.key===readSlot())||slots[0]);if(!slot)throw Error('Choose a material slot');
   if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');
   const definition=registry.get(implementation);if(!definition)throw Error('Material implementation unavailable');
   if(definition.prepare)return (async()=>{
    const parameters=await prepare(async()=>{
     const value=checkMaterialParameters(definition,requestedParameters??await definition.defaults());
     await definition.prepare(value);return value;
    });assertAvailable();
    if(selectedById(entry.id).object!==entry.object)throw Error('Material target changed while loading');
    return createRecipe(parameters);
   })();
   return createRecipe(checkMaterialParameters(definition,requestedParameters??(implementation==='kiln-glaze'?{}:{color:'#'+(slot.base.color?.getHexString()??'92979c'),roughness:slot.base.roughness??.55,metalness:slot.base.metalness??0})));
   function createRecipe(parameters){
   const recipe={id:id(),name:name||slot.base.name||`${entry.label||'Surface'} finish`,implementation,version:definition.version,parameters};
   const next=materials.read();next.recipes.push(recipe);next.bindings=next.bindings.filter(b=>b.objectId!==entry.id||b.slot!==slot.key);next.bindings.push({objectId:entry.id,slot:slot.key,recipeId:recipe.id});return applied(next,'Create material',recipe.id);
   }
  },
  edit(recipeId,patch){
   if(!patch||typeof patch!=='object')throw Error('Material edit requires a parameter patch');
   const next=materials.read(),recipe=next.recipes.find(r=>r.id===recipeId);if(!recipe)throw Error('Material missing');
   const before=structuredClone(recipe),definition=registry.get(recipe.implementation);
   if(patch.name!==undefined)recipe.name=patch.name;if(patch.parameters)recipe.parameters={...recipe.parameters,...patch.parameters};
   if(definition.prepare&&definition.resourceKey?.(before.parameters)!==definition.resourceKey?.(recipe.parameters)){
    assertAvailable();materials.check(next);const token={};pendingSources.set(recipeId,token);
    return (async()=>{try{
     await prepare(()=>definition.prepare(recipe.parameters));
     if(pendingSources.get(recipeId)!==token)return false;
     const current=materials.read(),index=current.recipes.findIndex(r=>r.id===recipeId);
     if(JSON.stringify(current.recipes[index])!==JSON.stringify(before))throw Error('Material changed while loading its checkpoint; choose the checkpoint again');
     current.recipes[index]=recipe;return apply(current,'Change material checkpoint');
    }finally{if(pendingSources.get(recipeId)===token)pendingSources.delete(recipeId);}})();
   }
   return apply(next,'Edit material');
  },
  assign({objectId,slot,recipeId}={}){const entry=selectedById(objectId);if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');if(!materials.slots(entry).some(s=>s.key===slot))throw Error('Material slot missing');const next=materials.read();next.bindings=next.bindings.filter(b=>b.objectId!==entry.id||b.slot!==slot);if(recipeId)next.bindings.push({objectId:entry.id,slot,recipeId});return apply(next,'Assign material');},
  makeUnique({objectId,slot}={}){const entry=selectedById(objectId);if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');const next=materials.read(),binding=next.bindings.find(b=>b.objectId===entry.id&&b.slot===slot);if(!binding)throw Error('Assign a material first');const recipe=structuredClone(next.recipes.find(r=>r.id===binding.recipeId));recipe.id=id();recipe.name+=' copy';next.recipes.push(recipe);binding.recipeId=recipe.id;return applied(next,'Make material unique',recipe.id);},
 };
 return Object.freeze(api);
}
