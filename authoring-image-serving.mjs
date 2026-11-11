import {authoringImageWeightRoot} from './authoring-image-operation.mjs';

// Ordinary server services shared by page uploads and worker-owned generation.
// History, selection and preparation stay with the page consuming the saved entry.
export function createAuthoringImageServingOptions({request=globalThis.fetch}={}){
 return {
  async weights(model){
   const response=await request('/api/runtime-config',{cache:'no-store'});
   return authoringImageWeightRoot(response.ok?await response.json():{},model);
  },
  async deliver(file,provenance,{assertCurrent=()=>{}}={}){
   assertCurrent();
   const body=await file.arrayBuffer();assertCurrent();
   const response=await request('/api/ingest-image?'+new URLSearchParams({name:file.name}),{method:'POST',body});
   assertCurrent();const value=await response.json();assertCurrent();
   if(!response.ok||value?.schema!=='kaminos.asset-ingest.v0'||value.kind!=='image'||!value.entry?.source)throw Error(value?.error||'Image storage failed');
   return provenance==null?value.entry:{...value.entry,provenance:structuredClone(provenance)};
  },
 };
}
