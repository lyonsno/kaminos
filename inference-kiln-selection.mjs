import {planSceneRestore} from './scene-persistence-core.js';
import {PROMPT_RELIEF_SOURCE} from './inference-kiln-record.mjs';
export const KILN_SELECTION_SCHEMA='kaminos.inference-kiln-selection.v1';
export function checkedKilnSelection(value){
 if(value==null)return null;
 if(value.schema!==KILN_SELECTION_SCHEMA||typeof value.sceneFile!=='string'||!value.sceneFile.endsWith('.kaminos.json')||/[\\/]/.test(value.sceneFile)||value.sceneFile==='..')throw Error('Choose a saved kiln scene');
 if(typeof value.promptObjectId!=='string'||!value.promptObjectId.trim())throw Error('Choose the kiln prompt lettering');
 return {...structuredClone(value)};
}
export function kilnScenePlan(document,selection={}){
 const plan=planSceneRestore(document),prompts=plan.objects.filter(r=>r.source===PROMPT_RELIEF_SOURCE);
 const id=selection.promptObjectId??(prompts.length===1?prompts[0].id:null),prompt=prompts.find(r=>r.id===id);
 if(!prompt)throw Error(prompts.length>1?'Select which lettering is the Generate prompt in Workbench':'This scene has no retained prompt lettering');
 if(!plan.composition||!plan.objects.some(r=>r.type==='flame-emitter'))throw Error('Save a kiln scene with a flame source');
 const supported=['pbr','glb','procedural-mesh','flame-emitter','camera','light'];
 for(const r of plan.objects){if(!supported.includes(r.type)||(r.type==='pbr'&&r.source!==PROMPT_RELIEF_SOURCE))throw Error(`The kiln preview cannot reconstruct ${r.label||r.type}; use an ordinary mesh or GLB`);if(r.repetition)throw Error('Make repeated kiln objects editable before using this scene');}
 return {...plan,promptObjectId:id};
}
// A scene reference lives in the shared preference store, not per-origin
// localStorage. Revision conflicts retain the acknowledged previous selection.
export function createKilnRecipeStore({preferences,request=(...args)=>fetch(...args)}){let current=null,pending=Promise.resolve();
 const serialize=operation=>{const result=pending.catch(()=>{}).then(operation);pending=result;return result;};
 async function scene(selection){const response=await request('/api/read?'+new URLSearchParams({root:'scenes',path:selection.sceneFile}),{cache:'no-store'});if(!response.ok)throw Error('Saved kiln unavailable: '+selection.sceneFile);const document=await response.json();const plan=kilnScenePlan(document,selection);return {selection,document,plan};}
 return {
  read:()=>current?structuredClone(current):null,
  load(){return serialize(async()=>{const prefs=await preferences.load(),selection=checkedKilnSelection(prefs.inferenceKiln);current=selection?await scene(selection):null;return current?structuredClone(current):null;});},
  async chooseScene(sceneFile){const response=await request('/api/read?'+new URLSearchParams({root:'scenes',path:sceneFile}),{cache:'no-store'});if(!response.ok)throw Error('Saved kiln unavailable: '+sceneFile);const document=await response.json(),plan=kilnScenePlan(document);return this.choose({schema:KILN_SELECTION_SCHEMA,sceneFile,promptObjectId:plan.promptObjectId});},
  choose(value){return serialize(async()=>{const selection=checkedKilnSelection(value),next=selection?await scene(selection):null,prefs=await preferences.load();await preferences.save({...prefs,inferenceKiln:selection});current=next;return current?structuredClone(current):null;});},
  async useSaved(result,promptObjectId){if(!result?.ok)throw Error(result?.error||'Save the kiln scene first');const plan=kilnScenePlan(result.document,{promptObjectId});return this.choose({schema:KILN_SELECTION_SCHEMA,sceneFile:result.filename,promptObjectId:plan.promptObjectId});},
 };
}
