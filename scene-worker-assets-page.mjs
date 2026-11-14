import {installAuthoringAssets} from './authoring-assets.mjs';
import {installKleinImageGeneration} from './authoring-image-generation-ui.mjs';
import {installBrowseLayout} from './authoring-browse-layout.mjs';
import {installGenerateLayout} from './authoring-generate-layout.mjs';

export function createSceneWorkerAssetsController({page,changed=()=>{},report=()=>{}}){
 let state={roots:[],root:'generated-meshes',path:'',entries:[],selected:null,preparation:null,loading:false,adding:false,error:null,results:[]},revision=-1,pending=0;
 const read=options=>options?.selectionOnly?{selected:state.selected}:{...state,loading:state.loading||pending>0};
 const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function validState(value){
  return record(value)&&Array.isArray(value.roots)&&value.roots.every(root=>record(root)&&typeof root.id==='string')
   &&Array.isArray(value.entries)&&value.entries.every(entry=>record(entry)&&(value.root!=='agent-work'||(record(entry.agent)&&typeof entry.agent.id==='string')))
   &&Array.isArray(value.results)&&value.results.every(record)&&(value.selected===null||record(value.selected))
   &&typeof value.root==='string'&&typeof value.path==='string'&&typeof value.loading==='boolean'&&typeof value.adding==='boolean'
   &&(value.error===null||typeof value.error==='string');
 }
 function notify(){try{changed(read());}catch(error){state={...state,error:'Asset drawer presentation failed: '+String(error?.message??error)};try{report(state.error);}catch{/* reporting cannot prevent recovery either */}}}

 async function call(operation,input){
  pending++;
  try{notify();const reply=await page.request(operation,input).completion;const value=reply.output?.value??reply.output;
   if(!Number.isInteger(value?.revision)||!validState(value.state))throw Error('Worker asset response did not contain its catalog state');
   if(value.revision>=revision){revision=value.revision;state=value.state;}
   return !state.error;
  }catch(error){state={...state,error:error.message};throw error;}
  finally{pending--;notify();}
 }
 return {read,ensure:()=>call('assets.ensure'),refresh:()=>call('assets.refresh'),browse:(root,path='')=>call('assets.browse',{root,path}),select:entry=>call('assets.select',{entry}),
  generation:()=>({status:'unavailable',error:'Mesh generation is not yet connected to this worker preview.'}),
  preparesInput:()=>false,stop:()=>false};
}

export function installSceneWorkerAssetsDrawer({document,owner,report=()=>{}}){
 let ui,imageUi,layout,browse;
 const render=()=>{ui?.render(controller.read());imageUi?.render();layout?.render();browse?.render(controller.read());};
 const controller=createSceneWorkerAssetsController({page:owner.page,changed:render,report});
 const reason='Mesh generation is not yet connected to this worker preview.';
 ui=installAuthoringAssets({document,controller,edits:owner.editor.edits,
  capabilities:{add:false,upload:false,meshHistory:false,meshPreviews:false,meshUnavailableReason:reason}});
 const selectSaved=async entry=>{
  if(entry)try{await controller.select({...entry,kind:'image'});}catch(error){report('Image saved; selection unavailable: '+error.message);}
  return entry;
 };
 const images={...owner.image,run:async input=>selectSaved(await owner.image.run(input)),retryOutput:async id=>selectSaved(await owner.image.retryOutput(id)),retryPersistence:async()=>selectSaved(await owner.image.retryPersistence())};
 imageUi=installKleinImageGeneration({document,controller:images,assets:controller,meshBusy:()=>false});
 layout=installGenerateLayout({document,selected:()=>controller.read({selectionOnly:true}).selected,imageState:()=>owner.image.read(),meshUnavailableReason:reason});
 browse=installBrowseLayout({document,controller,inScene:()=>new Set((owner.read().ui?.objects??[]).map(row=>row.source)),open:mode=>ui.open(mode),canAdd:false});
 owner.image.subscribe(render);render();
 const open=mode=>{const result=ui.open(mode);Promise.resolve(result).catch(error=>report(error.message));return result;};
 return Object.freeze({...controller,open,close:()=>ui.close(),panel:()=>ui.state(),images});
}
