export const ENVIRONMENT_RECIPE_FIELDS=Object.freeze(['exposure','intensity','rotation','backgroundBrightness','backgroundContrast','backgroundBlur']);
const own=(value,key)=>Object.hasOwn(value,key);
export function environmentDefaults(presets,name){
 const preset=presets[name];if(!preset)throw Error(`Unknown environment ${name}`);
 return {exposure:preset.exposure,intensity:preset.intensity,rotation:0,backgroundBrightness:.6,backgroundContrast:1,backgroundBlur:.4};
}
export function normalizeEnvironmentRecipe(presets,name,recipe={}){
 if(!recipe||typeof recipe!=='object'||Array.isArray(recipe))throw Error('Invalid environment recipe');
 const defaults=environmentDefaults(presets,name),next={};
 for(const key of ENVIRONMENT_RECIPE_FIELDS){
  const value=recipe[key]===undefined?defaults[key]:recipe[key];
  if(typeof value!=='number'||!Number.isFinite(value)||(key!=='rotation'&&value<0))throw Error(`Invalid environment ${name} ${key}`);
  if(key==='backgroundBlur'&&value>1)throw Error('Background blur must be between 0 and 1');
  next[key]=value;
 }
 return next;
}
export function normalizeEnvironmentRecipes(presets,recipes={}){
 if(!recipes||typeof recipes!=='object'||Array.isArray(recipes))throw Error('Invalid environment recipes');
 return Object.fromEntries(Object.entries(recipes).filter(([name])=>own(presets,name)).map(([name,recipe])=>[name,normalizeEnvironmentRecipe(presets,name,recipe)]));
}
// Accepted authored values are independent of controls, renderer resources and
// async HDR decoding. The latter consumes this state at actual publication.
export function createSceneEnvironmentState({presets,defaultName='studio'}={}){
 const catalog=structuredClone(presets),listeners=new Set();
 let snapshot;
 const freeze=(name,recipe,showBackground,recipes)=>Object.freeze({name,...Object.freeze({...recipe}),showBackground,
  recipes:Object.freeze(Object.fromEntries(Object.entries(recipes).map(([id,value])=>[id,Object.freeze({...value})])))});
 function publish(name,recipe,showBackground,recipes){
  snapshot=freeze(name,recipe,showBackground,recipes);
  for(const listener of listeners)listener(snapshot);
  return snapshot;
 }
 publish(null,normalizeEnvironmentRecipe(catalog,defaultName),true,{});
 const recipe=()=>Object.fromEntries(ENVIRONMENT_RECIPE_FIELDS.map(key=>[key,snapshot[key]]));
 function checkedPatch(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Invalid environment patch');
  for(const key of Object.keys(patch))if(!ENVIRONMENT_RECIPE_FIELDS.includes(key)&&key!=='showBackground')throw Error(`Unknown environment parameter ${key}`);
  const showBackground=own(patch,'showBackground')?patch.showBackground:snapshot.showBackground;
  if(typeof showBackground!=='boolean')throw Error('Invalid environment background visibility');
  return {...normalizeEnvironmentRecipe(catalog,snapshot.name??defaultName,{...recipe(),...patch}),showBackground};
 }
 const api={
  read:()=>snapshot,recipe,
  document:()=>structuredClone(snapshot),
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  defaults:name=>environmentDefaults(catalog,name),
  select(name){
   const next=normalizeEnvironmentRecipe(catalog,name,snapshot.recipes[name]);
   return publish(name,next,snapshot.showBackground,{...snapshot.recipes,[name]:next});
  },
  check:checkedPatch,
  patch(patch){
   const {showBackground,...next}=checkedPatch(patch);
   return publish(snapshot.name,next,showBackground,{...snapshot.recipes,...(snapshot.name?{[snapshot.name]:next}:{})});
  },
  reset(){return api.patch(api.defaults(snapshot.name??defaultName));},
  restoreRecipes(recipes){return publish(snapshot.name,recipe(),snapshot.showBackground,normalizeEnvironmentRecipes(catalog,recipes));},
  restoreDocument(value){
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid scene environment');
   const name=value.name||defaultName,recipes=normalizeEnvironmentRecipes(catalog,value.recipes);
   const next=normalizeEnvironmentRecipe(catalog,name,{...value,exposure:value.exposure??1.5,intensity:value.intensity??1,rotation:value.rotation??0});
   const showBackground=value.showBackground??false;if(typeof showBackground!=='boolean')throw Error('Invalid environment background visibility');
   return publish(name,next,showBackground,{...recipes,[name]:next});
  },
 };
 return Object.freeze(api);
}
