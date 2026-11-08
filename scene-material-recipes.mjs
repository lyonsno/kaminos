// Authored identity and parameters are JSON. Programs and GPU resources stay code-owned.
const copy=value=>structuredClone(value);
const color=(label,value)=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error(`${label} requires a hex color`);return value;};
const number=(label,value,min,max)=>{if(!Number.isFinite(value)||value<min||value>max)throw Error(`${label} must be between ${min} and ${max}`);return value;};
const surfaceFields=[{key:'color',label:'Color',type:'color',default:'#92979c'},{key:'roughness',label:'Roughness',type:'number',min:0,max:1,step:.01,default:.55},{key:'metalness',label:'Metallic',type:'number',min:0,max:1,step:.01,default:.05}];
export const materialDefinitions=[
 {id:'asset-surface',version:1,title:'Asset surface',description:'Preserves this slot’s source textures and shading; overrides its finish.',fields:surfaceFields},
 {id:'standard-surface',version:1,title:'Standard surface',description:'A complete standard surface, independent of the source textures.',fields:surfaceFields},
 {id:'kiln-glaze',version:1,title:'Kiln glaze',description:'Code-authored ceramic glaze: fired color variation, glaze coverage, micro relief and clear coat.',fields:[
  {key:'clay',label:'Clay',type:'color',default:'#43251d'},{key:'glaze',label:'Glaze',type:'color',default:'#4aafaa'},
  {key:'coverage',label:'Glaze coverage',type:'number',min:0,max:1,step:.01,default:.7},
  {key:'scale',label:'Firing pattern scale',type:'number',min:.1,max:100,step:.1,default:5},
  {key:'relief',label:'Micro relief',type:'number',min:0,max:1,step:.01,default:.15},
  {key:'roughness',label:'Glaze roughness',type:'number',min:0,max:1,step:.01,default:.2}]}];
export function checkMaterialParameters(definition,raw={}) {
 if(definition.check)return definition.check(copy(raw));
 const result={...raw};
 for(const field of definition.fields){const value=raw[field.key]??field.default;result[field.key]=field.type==='color'?color(field.label,value):number(field.label,value,field.min,field.max);}
 return result;
}
export function checkedMaterialDocument(value={recipes:[],bindings:[]},definitions=materialDefinitions) {
 if(!Array.isArray(value.recipes)||!Array.isArray(value.bindings))throw Error('Material recipes and bindings must be arrays');
 const registry=new Map(definitions.map(d=>[d.id,d])),ids=new Set(),slots=new Set();
 const recipes=value.recipes.map(raw=>{
  if(typeof raw.id!=='string'||!raw.id||ids.has(raw.id))throw Error('Duplicate or invalid material identity');ids.add(raw.id);
  const definition=registry.get(raw.implementation);if(!definition)throw Error('Material implementation unavailable: '+raw.implementation);
  if(raw.version!==definition.version)throw Error('Material implementation version unavailable: '+raw.implementation);
  if(typeof raw.name!=='string'||!raw.name.trim())throw Error('Material name is required');
  return {...copy(raw),parameters:checkMaterialParameters(definition,raw.parameters)};
 });
 const bindings=value.bindings.map(raw=>{
  if(typeof raw.objectId!=='string'||!raw.objectId||typeof raw.slot!=='string'||!/^(?:\.|\d+(?:\/\d+)*):\d+$/.test(raw.slot))throw Error('Invalid material slot');
  if(!ids.has(raw.recipeId))throw Error('Material recipe missing: '+raw.recipeId);
  const key=JSON.stringify([raw.objectId,raw.slot]);if(slots.has(key))throw Error('Duplicate material slot binding');slots.add(key);
  return {objectId:raw.objectId,slot:raw.slot,recipeId:raw.recipeId};
 });
 return {recipes,bindings};
}
export function materialSlots(root) {
 const result=[];
 function visit(object,path){
  if(object.userData?.kaminosEditorOnly||object.userData?.kaminosRepetitionCopy)return;
  if(object.isMesh&&object.material){const array=Array.isArray(object.material);[].concat(object.material).forEach((material,index)=>{
   if(material)result.push({key:`${path||'.'}:${index}`,label:`${object.name||'Surface'}${material.name?' · '+material.name:array?` · slot ${index+1}`:''}`,mesh:object,index,material,
    set:value=>{if(array)object.material[index]=value;else object.material=value;}});
  });}
  object.children?.forEach((child,index)=>visit(child,path?`${path}/${index}`:String(index)));
 }
 if(root)visit(root,'');return result;
}
export function createSceneMaterials({entries,definitions,changed=()=>{}}) {
 let state={recipes:[],bindings:[]};const active=new Map();
 const registry=new Map(definitions.map(d=>[d.id,d]));
 const key=b=>JSON.stringify([b.objectId,b.slot]);
 const check=value=>checkedMaterialDocument(value,definitions);
 const release=runtime=>{runtime.slot.set(runtime.base);runtime.program.dispose();};
 function write(raw){
  const next=check(raw),objects=new Map(entries().map(e=>[e.id,e])),recipes=new Map(next.recipes.map(r=>[r.id,r]));
  const staged=new Map(),updates=[];
  try{
   for(const binding of next.bindings){
    const entry=objects.get(binding.objectId);if(!entry)continue; // Object history retains absent assignments.
    const slot=materialSlots(entry.object).find(s=>s.key===binding.slot);if(!slot)throw Error(`Material slot ${binding.slot} is absent on ${entry.label||entry.id}`);
    const previous=active.get(key(binding)),recipe=recipes.get(binding.recipeId);
    if(previous?.slot.mesh===slot.mesh&&previous.recipe.implementation===recipe.implementation&&previous.recipe.version===recipe.version){
     staged.set(key(binding),previous);if(JSON.stringify(previous.recipe.parameters)!==JSON.stringify(recipe.parameters))updates.push({previous,recipe});
    }else{
     const base=previous?.slot.mesh===slot.mesh?previous.base:slot.material;
     const definition=registry.get(recipe.implementation);
     if(!definition.create)throw Error('Material runtime unavailable: '+recipe.implementation);
     const program=definition.create({base,parameters:copy(recipe.parameters)});
     if(!program?.material||typeof program.update!=='function'||typeof program.dispose!=='function')throw Error('Invalid material program: '+recipe.implementation);
     staged.set(key(binding),{slot,base,program,recipe});
    }
   }
   for(const {previous,recipe}of updates)previous.program.update(copy(recipe.parameters));
  }catch(error){
   for(const {previous}of updates)previous.program.update(copy(previous.recipe.parameters));
   for(const [id,runtime]of staged)if(runtime!==active.get(id))runtime.program.dispose();throw error;
  }
  for(const [id,runtime]of active)if(staged.get(id)!==runtime)release(runtime);
  for(const binding of next.bindings){const runtime=staged.get(key(binding));if(runtime){runtime.slot.set(runtime.program.material);runtime.recipe=recipes.get(binding.recipeId);}}
  active.clear();for(const [id,runtime]of staged)active.set(id,runtime);state=next;changed();
 }
 const read=()=>copy(state);
 return {read,write,check,sync:()=>write(state),recipe:id=>copy(state.recipes.find(r=>r.id===id)??null),
  slots:entry=>materialSlots(entry?.object).map(slot=>({...slot,base:active.get(key({objectId:entry.id,slot:slot.key}))?.base??slot.material,recipeId:state.bindings.find(b=>b.objectId===entry.id&&b.slot===slot.key)?.recipeId??null})),
  bindings:id=>copy(state.bindings.filter(b=>b.objectId===id).map(({objectId,...binding})=>binding)),
  restoreBindings(entry,bindings=[]){write({...state,bindings:[...state.bindings.filter(b=>b.objectId!==entry.id),...bindings.map(b=>({...b,objectId:entry.id}))]});},
  document(){const ids=new Set(entries().map(e=>e.id));return {recipes:copy(state.recipes),bindings:copy(state.bindings.filter(b=>ids.has(b.objectId)))};},
  withSource(object,action){const owned=[...active.values()].filter(r=>r.slot.mesh===object||isWithin(r.slot.mesh,object));for(const r of owned)r.slot.set(r.base);try{return action();}finally{for(const r of owned)r.slot.set(r.program.material);}},
  releaseObject(object){for(const [id,runtime]of active)if(runtime.slot.mesh===object||isWithin(runtime.slot.mesh,object)){release(runtime);active.delete(id);}},
  clear(){for(const runtime of active.values())release(runtime);active.clear();state={recipes:[],bindings:[]};},
 };
}
function isWithin(object,root){for(let node=object;node;node=node.parent)if(node===root)return true;return false;}
