import {checkedViewportDisplay} from './viewport-display-settings.mjs';
import {checkedCameraView} from './scene-camera-views.mjs';
import {resolveSceneGIControlState} from './scene-gi-settings.mjs';
export const PREFERENCES_SCHEMA='kaminos.preferences.v1';
const copy=value=>structuredClone(value);
const sections=['environment','postprocessing','camera','sceneCamera','editorDisplay','backdrop','backdropBrightness'];
// These consumers restore through fixed HTML range controls. Admission must
// preserve the stored value through their clamping and step sanitization.
export const SCENE_DEFAULT_RANGES={
 'postprocessing.ao.radius':{label:'AO radius',min:.5,max:20,step:.1},
 'postprocessing.ao.intensity':{label:'AO intensity',min:0,max:3,step:.05},
 'postprocessing.ao.scale':{label:'AO scale',min:.1,max:5,step:.05},
 'postprocessing.ao.thickness':{label:'AO thickness',min:.1,max:5,step:.05},
 'postprocessing.ao.falloff':{label:'AO falloff',min:0,max:1,step:.01},
 'postprocessing.dof.focus':{label:'Depth of field focus',min:.5,max:10,step:.1},
 'postprocessing.dof.aperture':{label:'Depth of field aperture',min:.0001,max:.01,step:.0001},
 'postprocessing.dof.maxblur':{label:'Depth of field maximum blur',min:0,max:.05,step:.001},
 backdropBrightness:{label:'Backdrop brightness',min:.1,max:2,step:.05},
};
const membership=['objects','groups','composition','localLiquid','selectionIds','activeObjectId','activeFieldId','sceneId','cameraViews','volumePrimitives'];
function finiteTree(value){if(typeof value==='number'&&!Number.isFinite(value))throw Error('Preferences need finite numbers');if(value&&typeof value==='object')for(const item of Object.values(value))finiteTree(item);}
export function checkedSceneDefaults(raw){
 if(raw===null)return null;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid scene defaults');
 if(membership.some(key=>Object.hasOwn(raw,key)))throw Error('Preferences cannot contain scene objects or identity');
 const value=copy(raw);finiteTree(value);
 for(const [path,{label,min,max,step}] of Object.entries(SCENE_DEFAULT_RANGES)){
  const number=path.split('.').reduce((value,key)=>value?.[key],value);
  if(number===undefined)continue;
  const ticks=(number-min)/step;
  if(typeof number!=='number'||number<min||number>max||Math.abs(ticks-Math.round(ticks))>1e-7)throw Error(`${label} must be between ${min} and ${max}, in steps of ${step}; the scene cannot preserve this value`);
 }

 if(value.camera)Object.assign(value.camera,checkedCameraView(value.camera));
 if(value.editorDisplay){value.editorDisplay=checkedViewportDisplay(value.editorDisplay);if(value.editorDisplay.hiddenIds.length)throw Error('Default display cannot refer to hidden scene objects');}
 if(value.sceneCamera){const aspect=value.sceneCamera.aspect;if(!Array.isArray(aspect)||aspect.length!==2||!aspect.every(n=>Number.isFinite(n)&&n>0)||value.sceneCamera.activeId!=null)throw Error('Default output needs a positive aspect and no active scene camera');}
 if(value.postprocessing?.sceneGI)resolveSceneGIControlState(value.postprocessing.sceneGI);
 if(value.environment){
  const env=value.environment;if(env.backgroundBlur>1)throw Error('Default environment blur must be between 0 and 1');if(typeof env.name!=='string'||!env.name)throw Error('Choose a default environment');
  for(const key of ['exposure','intensity','backgroundBlur','backgroundBrightness','backgroundContrast'])if(Object.hasOwn(env,key)&&(typeof env[key]!=='number'||env[key]<0))throw Error('Invalid default environment '+key);
 }
 return value;
}
export function sceneDefaultsFromDocument(document){
 const result={};for(const key of sections)if(document[key]!==undefined)result[key]=copy(document[key]);
 if(result.editorDisplay)result.editorDisplay.hiddenIds=[];
 if(result.sceneCamera)result.sceneCamera.activeId=null;
 return checkedSceneDefaults(result);
}
export function checkedPreferences(raw){
 if(raw?.schema!==PREFERENCES_SCHEMA)throw Error('Unsupported preferences document');
 if(![null,'trackpad','mouse'].includes(raw.navigationInput??null))throw Error('Invalid navigation preference');
 return {...copy(raw),navigationInput:raw.navigationInput??null,sceneDefaults:checkedSceneDefaults(raw.sceneDefaults??null)};
}
export function sceneDefaultsApplyToLocation(value){
 const url=new URL(value,'http://localhost');
 return [...url.searchParams,...new URLSearchParams(url.hash.slice(1))].every(([key])=>['workspace','authoring'].includes(key));
}
export function newSceneDocument(factory,defaults){
 const document=copy(factory),value=checkedSceneDefaults(defaults);
 // A settings template is never a scene copy, including future scene identities.
 for(const key of membership)delete document[key];
 Object.assign(document,{objects:[],groups:[],composition:null,localLiquid:null,activeObjectId:null,activeGroupId:null,activeFieldId:null,selectionIds:[],cameraViews:null,volumePrimitives:{schema:'kaminos.volume-primitives.v0',primitives:[]},label:'Untitled scene'});
 for(const key of sections)if(value&&Object.hasOwn(value,key))document[key]=copy(value[key]);
 if(document.sceneCamera)document.sceneCamera.activeId=null;
 if(document.editorDisplay)document.editorDisplay.hiddenIds=[];
 document.viewport=null;return document;
}
export function createUserPreferences({request=(...args)=>fetch(...args),changed=()=>{}}={}){
 let receipt=null,error=null;
 async function exchange(body){
  const response=await request('/api/preferences',body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let result;try{result=await response.json();}catch{throw Error('Preferences are unavailable on this server');}
  if(!response.ok)throw Error(result.error||`Preferences HTTP ${response.status}`);
  if(!Object.hasOwn(result,'revision')||!(result.revision===null||typeof result.revision==='string'))throw Error('Preferences response has no revision');
  return {...result,preferences:checkedPreferences(result.preferences)};
 }
 const state=()=>({available:receipt!==null,error,receipt:copy(receipt)});
 return {
  state,
  async load(){try{receipt=await exchange();error=null;changed(state());return copy(receipt.preferences);}catch(e){error=e.message;changed(state());throw e;}},
  async save(value){if(!receipt)throw Error('Load Preferences before saving');const next=checkedPreferences(value);try{receipt=await exchange({preferences:next,revision:receipt.revision});error=null;changed(state());return copy(receipt.preferences);}catch(e){error=e.message;changed(state());throw e;}},
 };
}
