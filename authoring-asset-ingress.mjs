import {createAuthoringImageServingOptions} from './authoring-image-serving.mjs';

// Persist uploads before scene admission. Both a local GLB and a generated mesh
// can then enter the same scene-owned import operation with a durable source.
export function createAuthoringAssetIngress({request=globalThis.fetch}={}){
 const images=createAuthoringImageServingOptions({request});
 return {uploadImage:(file,options)=>images.deliver(file,null,options),
  async uploadMesh(file,{assertCurrent=()=>{},signal}={}){
   assertCurrent();const bytes=await file.arrayBuffer();assertCurrent();
   const digest=await crypto.subtle.digest('SHA-256',bytes);assertCurrent();
   const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
   const response=await request('/api/ingest-mesh',{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:bytes,signal});
   const receipt=await response.json();assertCurrent();
   if(!response.ok||receipt?.schema!=='kaminos.generated-mesh.v0'||receipt.sha256!==sha256||receipt.bytes!==bytes.byteLength||receipt.source!==`/api/read?root=generated-meshes&path=${sha256}.glb`)throw Error(receipt?.error||'Mesh storage returned a different artifact');
   return {kind:'mesh',name:file.name,label:file.name.replace(/\.glb$/i,''),root_id:'generated-meshes',source:receipt.source,sha256,bytes:receipt.bytes};
  },
 };
}
