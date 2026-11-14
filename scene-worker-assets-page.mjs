import {installAuthoringAssets} from './authoring-assets.mjs';
import {installKleinImageGeneration} from './authoring-image-generation-ui.mjs';
import {installBrowseLayout} from './authoring-browse-layout.mjs';
import {installGenerateLayout} from './authoring-generate-layout.mjs';

export function createSceneWorkerAssetsController({page,changed=()=>{}}){
 let state={roots:[],root:'generated-meshes',path:'',entries:[],selected:null,preparation:null,loading:false,adding:false,error:null,results:[]},revision=-1,pending=0;
 const read=options=>options?.selectionOnly?{selected:state.selected}:{...state,loading:state.loading||pending>0};
 async function call(operation,input){
  pending++;changed(read());
  try{const reply=await page.request(operation,input).completion;const value=reply.output?.value??reply.output;
   if(!Number.isInteger(value?.revision)||!value.state||!Array.isArray(value.state.entries))throw Error('Worker asset response did not contain its catalog state');
   if(value.revision>=revision){revision=value.revision;state=value.state;}
   return !state.error;
  }catch(error){state={...state,error:error.message};throw error;}
  finally{pending--;changed(read());}
 }
 return {read,ensure:()=>call('assets.ensure'),refresh:()=>call('assets.refresh'),browse:(root,path='')=>call('assets.browse',{root,path}),select:entry=>call('assets.select',{entry}),
  generation:()=>({status:'unavailable',error:'Mesh generation is not yet connected to this worker preview.'}),
  preparesInput:()=>false,stop:()=>false};
}

export function installSceneWorkerAssetsDrawer({document,owner,report=()=>{}}){
 let ui,imageUi,layout,browse;
 const render=()=>{ui?.render(controller.read());imageUi?.render();layout?.render();browse?.render(controller.read());};
 const controller=createSceneWorkerAssetsController({page:owner.page,changed:render});
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
