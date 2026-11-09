import {neumipDefinition} from './neumip-settings.mjs';
// Authored identity and parameters are JSON. Programs and GPU resources stay code-owned.
const copy=value=>structuredClone(value);
// Keep authored program instances separate from the resident source appearance.
// Texture residency and borrowed geometry must reach the material restored on
// unassignment without imposing source maps on an independent program.
const programSources=new WeakMap();
export const materialProgramSource=material=>programSources.get(material);
export function sourceRecipeMaterial(material){while(programSources.has(material))material=programSources.get(material).source;return material;}
const color=(label,value)=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error(`${label} requires a hex color`);return value;};
const number=(label,value,min,max)=>{if(!Number.isFinite(value)||value<min||value>max)throw Error(`${label} must be between ${min} and ${max}`);return value;};
const surfaceFields=[{key:'color',label:'Color',type:'color',default:'#92979c'},{key:'roughness',label:'Roughness',type:'number',min:0,max:1,step:.01,default:.55},{key:'metalness',label:'Metallic',type:'number',min:0,max:1,step:.01,default:.05}];
export const materialDefinitions=[
 {id:'asset-surface',version:1,preservesSourceMaps:true,title:'Asset surface',description:'Preserves this slot’s source textures and shading; overrides its finish.',fields:surfaceFields},
 {id:'standard-surface',version:1,title:'Standard surface',description:'A complete standard surface, independent of the source textures.',fields:surfaceFields},
 {id:'kiln-glaze',version:1,supportsBurning:false,title:'Kiln glaze',description:'Code-authored ceramic glaze: fired color variation, glaze coverage, micro relief and clear coat.',fields:[
  {key:'clay',label:'Clay',type:'color',default:'#43251d'},{key:'glaze',label:'Glaze',type:'color',default:'#4aafaa'},
  {key:'coverage',label:'Glaze coverage',type:'number',min:0,max:1,step:.01,default:.7},
  {key:'scale',label:'Firing pattern scale',type:'number',min:.1,max:100,step:.1,default:5},
  {key:'relief',label:'Micro relief',type:'number',min:0,max:1,step:.01,default:.15},
  {key:'roughness',label:'Glaze roughness',type:'number',min:0,max:1,step:.01,default:.2}]},neumipDefinition];
export function checkMaterialParameters(definition,raw={}) {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Material parameters must be an object');
 if(definition.check)return definition.check(copy(raw));
 const result={...raw};
 for(const field of definition.fields){const value=raw[field.key]??field.default;result[field.key]=field.type==='color'?color(field.label,value):number(field.label,value,field.min,field.max);}
 return result;
}
export function checkedMaterialDocument(value={recipes:[],bindings:[]},definitions=materialDefinitions) {
 if(!value||typeof value!=='object'||!Array.isArray(value.recipes)||!Array.isArray(value.bindings))throw Error('Material recipes and bindings must be arrays');
 const registry=new Map(definitions.map(d=>[d.id,d])),ids=new Set(),slots=new Set();
 const recipes=value.recipes.map(raw=>{
  if(!raw||typeof raw!=='object')throw Error('Invalid material recipe');
  if(typeof raw.id!=='string'||!raw.id||ids.has(raw.id))throw Error('Duplicate or invalid material identity');ids.add(raw.id);
  const definition=registry.get(raw.implementation);if(!definition)throw Error('Material implementation unavailable: '+raw.implementation);
  if(raw.version!==definition.version)throw Error('Material implementation version unavailable: '+raw.implementation);
  if(typeof raw.name!=='string'||!raw.name.trim())throw Error('Material name is required');
  return {...copy(raw),parameters:checkMaterialParameters(definition,raw.parameters)};
 });
 const bindings=value.bindings.map(raw=>{
  if(!raw||typeof raw!=='object')throw Error('Invalid material binding');
  if(typeof raw.objectId!=='string'||!raw.objectId||typeof raw.slot!=='string'||!/^(?:\.|\d+(?:\/\d+)*):\d+$/.test(raw.slot))throw Error('Invalid material slot');
  if(!ids.has(raw.recipeId))throw Error('Material recipe missing: '+raw.recipeId);
  const key=JSON.stringify([raw.objectId,raw.slot]);if(slots.has(key))throw Error('Duplicate material slot binding');slots.add(key);
  return {objectId:raw.objectId,slot:raw.slot,recipeId:raw.recipeId};
 });
 return {recipes,bindings};
}
export function assertMaterialBurningSupport(library,objectId,definitions=materialDefinitions){
 for(const binding of library.bindings.filter(b=>b.objectId===objectId)){
  const recipe=library.recipes.find(r=>r.id===binding.recipeId),definition=definitions.find(d=>d.id===recipe?.implementation);
  if(definition?.supportsBurning===false)throw Error(`Burning cannot preserve ${definition.title}; assign a supported base material first`);
 }
}
export function materialSlots(root) {
 const result=[];
 function visit(object,path){
  if(object.userData?.kaminosEditorOnly||object.userData?.kaminosEditorHelper||object.userData?.kaminosBeautyLodProxy||object.userData?.kaminosRepetitionCopy)return;
  if(object.isMesh&&object.material){const source=object.userData?.kaminosOriginalMaterial??object.material,array=Array.isArray(source);[].concat(source).forEach((material,index)=>{
   if(material)result.push({key:`${path||'.'}:${index}`,label:`${object.name||'Surface'}${material.name?' · '+material.name:array?` · slot ${index+1}`:''}`,mesh:object,index,material,
    set:value=>{if(array)object.material[index]=value;else object.material=value;if(object.userData?.kaminosOriginalMaterial){if(array)object.userData.kaminosOriginalMaterial[index]=value;else object.userData.kaminosOriginalMaterial=value;}}});
  });}
  object.children?.forEach((child,index)=>visit(child,path?`${path}/${index}`:String(index)));
 }
 if(root)visit(root,'');return result;
}
// Material names or identical source layouts establish correspondence. A remesh
// that merges independently authored surfaces has no lossless slot projection.
function projectSlots(source,derived){
 if(source.length===1)return derived.map(slot=>({slot,source:source[0]}));
 const sameLayout=source.length===derived.length&&source.every((slot,i)=>slot.key===derived[i].key&&slot.base.name===derived[i].base.name);
 return derived.flatMap((slot,i)=>{const matches=source.filter(s=>s.base.name&&s.base.name===slot.base.name);const match=sameLayout?source[i]:matches.length===1?matches[0]:null;return match?[{slot,source:match}]:[];});
}
export function createSceneMaterials({entries,definitions,retainedEntries=()=>[],representations=()=>[],changed=()=>{}}) {
 let state={recipes:[],bindings:[]},unsupported=new WeakSet();const active=new Map();
 const registry=new Map(definitions.map(d=>[d.id,d]));
 const key=b=>JSON.stringify([b.objectId,b.slot]);
 const objectMap=()=>{const result=new Map([...retainedEntries(),...entries()].map(e=>[e.id,e]));for(const runtime of active.values())if(runtime.ownerEntry?.burnable?.enabled&&!result.has(runtime.ownerEntry.id))result.set(runtime.ownerEntry.id,runtime.ownerEntry);return result;};
 const check=value=>{const next=checkedMaterialDocument(value,definitions);assertOwnership(next,objectMap());return next;};
 const release=runtime=>{runtime.slot.set(runtime.base);runtime.program.dispose();};
 const response=recipe=>recipe&&({implementation:recipe.implementation,version:recipe.version,parameters:recipe.parameters});
 function assertOwnership(next,objects){
  for(const entry of objects.values())if(entry.burnable?.enabled){
   assertMaterialBurningSupport(next,entry.id,definitions);
   const selected=value=>value.bindings.filter(b=>b.objectId===entry.id).map(b=>({...b,recipe:response(value.recipes.find(r=>r.id===b.recipeId))}));
   if(JSON.stringify(selected(state))!==JSON.stringify(selected(next)))throw Error(`Disable Burning on ${entry.label||entry.id} before editing its material`);
  }
 }
 function write(raw){
  const next=check(raw),objects=objectMap(),recipes=new Map(next.recipes.map(r=>[r.id,r]));
  assertOwnership(next,objects);
  const targets=[],nextUnsupported=new WeakSet();
  for(const entry of objects.values()){
   const assigned=next.bindings.filter(b=>b.objectId===entry.id);if(!assigned.length)continue;
   const slots=materialSlots(entry.object).map(slot=>({...slot,base:active.get(key({objectId:entry.id,slot:slot.key}))?.base??slot.material}));
   for(const binding of assigned){const slot=slots.find(s=>s.key===binding.slot);if(!slot)throw Error(`Material slot ${binding.slot} is absent on ${entry.label||entry.id}`);targets.push({id:key(binding),entry,slot,recipe:recipes.get(binding.recipeId)});}
   for(const root of representations(entry)){
    const derived=materialSlots(root).map(slot=>({...slot,base:active.get(key({objectId:entry.id,slot:root.uuid+':'+slot.key}))?.base??slot.material}));
    const projection=projectSlots(slots,derived);
    if(assigned.some(b=>!projection.some(p=>p.source.key===b.slot))){nextUnsupported.add(root);continue;}
    for(const pair of projection){const binding=assigned.find(b=>b.slot===pair.source.key);if(binding)targets.push({id:key({objectId:entry.id,slot:root.uuid+':'+pair.slot.key}),entry,slot:pair.slot,recipe:recipes.get(binding.recipeId)});}
   }
  }
  const staged=new Map(),updates=[];
  try{
   for(const {id,entry,slot,recipe} of targets){
    const previous=active.get(id);
    const definition=registry.get(recipe.implementation);
    if(previous?.slot.mesh===slot.mesh&&previous.recipe.implementation===recipe.implementation&&previous.recipe.version===recipe.version&&definition.resourceKey?.(previous.recipe.parameters)===definition.resourceKey?.(recipe.parameters)){
     staged.set(id,previous);if(JSON.stringify(previous.recipe.parameters)!==JSON.stringify(recipe.parameters))updates.push({previous,recipe});
    }else{
     const base=previous?.slot.mesh===slot.mesh?previous.base:slot.base??slot.material,definition=registry.get(recipe.implementation);
     if(!definition.create)throw Error('Material runtime unavailable: '+recipe.implementation);
     const program=definition.create({base,parameters:copy(recipe.parameters),slot});
     if(!program?.material||typeof program.update!=='function'||typeof program.dispose!=='function')throw Error('Invalid material program: '+recipe.implementation);
     programSources.set(program.material,{source:base,preservesMaps:definition.preservesSourceMaps===true});
     staged.set(id,{slot,base,program,recipe,owner:entry.object,ownerEntry:entry});
    }
   }
   for(const {previous,recipe}of updates)previous.program.update(copy(recipe.parameters));
  }catch(error){
   for(const {previous}of updates)previous.program.update(copy(previous.recipe.parameters));
   for(const [id,runtime]of staged)if(runtime!==active.get(id))runtime.program.dispose();throw error;
  }
  for(const [id,runtime]of active)if(staged.get(id)!==runtime)release(runtime);
  for(const target of targets){const runtime=staged.get(target.id);if(runtime){if(!(target.entry.burnable?.enabled&&active.get(target.id)===runtime))runtime.slot.set(runtime.program.material);runtime.recipe=target.recipe;runtime.ownerEntry=target.entry;}}
  active.clear();for(const [id,runtime]of staged)active.set(id,runtime);state=next;unsupported=nextUnsupported;changed();
 }
 const read=()=>copy(state);
 return {read,write,check,async prepare(raw){const next=checkedMaterialDocument(raw,definitions);await Promise.all(next.recipes.map(r=>registry.get(r.implementation).prepare?.(copy(r.parameters))));return next;},sync:()=>write(state),recipe:id=>copy(state.recipes.find(r=>r.id===id)??null),canDisplay:(_root,representation)=>!unsupported.has(representation),
  slots:entry=>materialSlots(entry?.object).map(slot=>({...slot,base:active.get(key({objectId:entry.id,slot:slot.key}))?.base??slot.material,recipeId:state.bindings.find(b=>b.objectId===entry.id&&b.slot===slot.key)?.recipeId??null})),
  validateSlots(id,object){const slots=new Set(materialSlots(object).map(s=>s.key));for(const b of state.bindings)if(b.objectId===id&&!slots.has(b.slot))throw Error(`Geometry would remove assigned material slot ${b.slot}; unassign it first`);},
  bindings:id=>copy(state.bindings.filter(b=>b.objectId===id).map(({objectId,...binding})=>binding)),
  restoreBindings(entry,bindings=[]){write({...state,bindings:[...state.bindings.filter(b=>b.objectId!==entry.id),...bindings.map(b=>({...b,objectId:entry.id}))]});},
  document(){const ids=new Set(entries().map(e=>e.id));return {recipes:copy(state.recipes),bindings:copy(state.bindings.filter(b=>ids.has(b.objectId)))};},
  withSource(object,action){const owned=[...active.values()].filter(r=>r.owner===object);for(const r of owned)r.slot.set(r.base);try{return action();}finally{for(const r of owned)r.slot.set(r.program.material);}},
  releaseObject(object){for(const [id,runtime]of active)if(runtime.owner===object||runtime.slot.mesh===object||isWithin(runtime.slot.mesh,object)){release(runtime);active.delete(id);}},
  clear(){for(const runtime of active.values())release(runtime);active.clear();state={recipes:[],bindings:[]};unsupported=new WeakSet();},
 };
}
function isWithin(object,root){for(let node=object;node;node=node.parent)if(node===root)return true;return false;}
