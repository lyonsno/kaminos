import {createAuthoringAssets} from './authoring-assets.mjs';

// Catalog parsing, caching and selection stay with the worker's application
// state. The existing drawer consumes plain projections through these commands.
export function createSceneWorkerAssets({request=async url=>{
 const response=await fetch(url);if(!response.ok)throw Error(`Asset request failed (${response.status})`);return response.json();
}}={}){
 let revision=0;const controller=createAuthoringAssets({request,changed:()=>revision++});
 const snapshot=()=>({revision,state:controller.read()});
 const operation=action=>async(input,context)=>{context.assertCurrent();await action(input);context.assertCurrent();return snapshot();};
 return {commands:{
  'assets.read':operation(()=>{}),
  'assets.refresh':operation(()=>controller.refresh()),
  'assets.ensure':operation(()=>controller.ensure()),
  'assets.browse':operation(({root,path})=>controller.browse(root,path)),
  'assets.select':operation(({entry})=>controller.select(entry)),
 }};
}
