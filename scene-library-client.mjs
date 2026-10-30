import {planSceneRestore} from './scene-persistence-core.js';

async function responseJSON(request,url,options){
 const response=await request(url,options),value=await response.json();
 if(!response.ok)throw Error(value?.error||`Saved scenes: HTTP ${response.status}`);
 return value;
}
// Load and Generate browse the same local and other-server stores. Importing
// retains the source and gives this server its own ordinary scene document.
export async function chooseSavedSceneFromLibrary({grFetchApi,pickSavedScene,request=fetch,browseFile}){
 const discovery = new AbortController();
 const discover = (url, options) => request(url, {...options, signal: discovery.signal});
 async function* localScenes(){
  const initial=await responseJSON(discover,'/api/scene-catalogue');
  if(!Array.isArray(initial.scenes))throw Error('Saved scene catalogue response is incomplete');
  yield initial.scenes;
  if(initial.scenes.some(scene=>scene.metadata==='pending')){
   const refreshed=await responseJSON(discover,'/api/scene-catalogue?metadata=1');
   if(!Array.isArray(refreshed.scenes))throw Error('Saved scene catalogue response is incomplete');
   yield refreshed.scenes;
  }
 }
 const more=responseJSON(discover,'/api/scene-library').then(library=>{if(!Array.isArray(library.stores))throw Error('Saved scene library response is incomplete');return library.stores.flatMap(store=>store.scenes.filter(scene=>!scene.error).map(scene=>({...scene,store:{id:store.id,label:store.label}})));});
 // A consumer may cancel before the catalog finishes. The picker still gets
 // the original promise and displays its error; cancellation leaves no orphan.
 more.catch(()=>{});
 let choice;
 try {choice=await pickSavedScene({scenes:[],local:localScenes(),more});}
 finally {discovery.abort();}
 if(!choice)return null;
 if(choice==='browse'){
  if(!browseFile)return choice;
  const file=await browseFile();if(!file)return null;
  const document=JSON.parse(await file.text());planSceneRestore(document);
  const saved=await responseJSON(request,'/api/save-scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...document,_filename:null,_saveAsName:null,_overwrite:false})});
  if(typeof saved.saved!=='string')throw Error('Scene import did not retain a saved filename');
  return {name:saved.saved,document,dependencies:[],from:file.name};
 }
 if(choice.store){
  const imported=await responseJSON(request,'/api/scene-library-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store:choice.store.id,name:choice.name})});
  if(typeof imported.saved!=='string'||!imported.document)throw Error('Scene import did not retain a saved document');
  return {name:imported.saved,document:imported.document,dependencies:imported.dependencies||[],from:choice.store.label};
 }
 const document=await grFetchApi('read',{root:'scenes',path:choice.name});if(!document||document.error)throw Error(`Could not read ${choice.name}: ${document?.error||'unavailable'}`);
 return {name:choice.name,document,dependencies:[],from:null};
}
export function pickSceneFile(document){return new Promise(resolve=>{
 const input=document.createElement('input');input.type='file';input.accept='.kaminos.json,application/json';input.hidden=true;
 const finish=file=>{input.remove();resolve(file??null);};input.addEventListener('change',()=>finish(input.files[0]),{once:true});input.addEventListener('cancel',()=>finish(null),{once:true});document.body.append(input);input.click();
});}
