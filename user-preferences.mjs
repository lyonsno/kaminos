import {checkedViewportDisplay} from './viewport-display-settings.mjs';
import {checkedCameraView} from './scene-camera-views.mjs';
import {resolveSceneGIControlState} from './scene-gi-settings.mjs';
export const PREFERENCES_SCHEMA='kaminos.preferences.v1';
const copy=value=>structuredClone(value);
const sections=['environment','postprocessing','camera','sceneCamera','editorDisplay','backdrop','backdropBrightness'];
const membership=['objects','groups','composition','localLiquid','selectionIds','activeObjectId','activeFieldId','sceneId','cameraViews','volumePrimitives'];
function finiteTree(value){if(typeof value==='number'&&!Number.isFinite(value))throw Error('Preferences need finite numbers');if(value&&typeof value==='object')for(const item of Object.values(value))finiteTree(item);}
export function checkedSceneDefaults(raw){
 if(raw===null)return null;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid scene defaults');
 if(membership.some(key=>Object.hasOwn(raw,key)))throw Error('Preferences cannot contain scene objects or identity');
 const value=copy(raw);finiteTree(value);
 if(value.camera)Object.assign(value.camera,checkedCameraView(value.camera));
 if(value.editorDisplay){value.editorDisplay=checkedViewportDisplay(value.editorDisplay);if(value.editorDisplay.hiddenIds.length)throw Error('Default display cannot refer to hidden scene objects');}
 if(value.sceneCamera){const aspect=value.sceneCamera.aspect;if(!Array.isArray(aspect)||aspect.length!==2||!aspect.every(n=>Number.isFinite(n)&&n>0)||value.sceneCamera.activeId!=null)throw Error('Default output needs a positive aspect and no active scene camera');}
 if(value.postprocessing?.sceneGI)resolveSceneGIControlState(value.postprocessing.sceneGI);
 if(value.environment){
  const env=value.environment;if(typeof env.name!=='string'||!env.name)throw Error('Choose a default environment');
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
