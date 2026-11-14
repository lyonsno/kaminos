import {createAuthoringAssets} from './authoring-assets.mjs';
import {createAuthoringAssetIngress} from './authoring-asset-ingress.mjs';

// Catalog parsing, caching and selection stay with the worker's application
// state. The existing drawer consumes plain projections through these commands.
export function createSceneWorkerAssets({request=async url=>{
 const response=await fetch(url);if(!response.ok)throw Error(`Asset request failed (${response.status})`);return response.json();
},uploadImage,uploadMesh}={}){
 const serving=createAuthoringAssetIngress();
 let revision=0;const controller=createAuthoringAssets({request,uploadImage:uploadImage??serving.uploadImage,changed:()=>revision++});
 const snapshot=()=>({revision,state:controller.read()});
 const operation=action=>async(input,context)=>{context.assertCurrent();await action(input);context.assertCurrent();return snapshot();};
 return {commands:{
  'assets.read':operation(()=>{}),
  'assets.refresh':operation(()=>controller.refresh()),
  'assets.ensure':operation(()=>controller.ensure()),
  'assets.browse':operation(input=>{const {root,path}=input??{};return controller.browse(root,path);}),
  'assets.select':operation(input=>{
   const entry=input?.entry;if(!entry)return controller.select(entry);
   const root=entry.root??entry.root_id,label=entry.label??entry.display?.title??entry.name;
   return controller.select({...entry,...(root?{root}:{}),...(label?{label}:{})});
  }),
  async 'assets.upload'(input,context){
   context.assertCurrent();const file=input?.file;
   if(typeof file?.name!=='string'||!(file.bytes instanceof ArrayBuffer))throw Error('Asset upload requires a named file and its bytes');
   const local=new File([file.bytes],file.name,{type:file.type??''}),options={assertCurrent:()=>context.assertCurrent(),signal:context.signal},before=revision;
   const entry=/\.glb$/i.test(file.name)?await (uploadMesh??serving.uploadMesh)(local,options):await controller.upload(local,options);
   context.assertCurrent();if(/\.glb$/i.test(file.name)&&revision===before)controller.select(entry);
   context.assertCurrent();return {...snapshot(),entry};
  },
 }};
}
