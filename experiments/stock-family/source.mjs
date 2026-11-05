import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BufferAttribute} from '../../lib/three.core.js';
import {fitStockSource,validateStockSource} from './model.mjs';
import {disposeStockMaterial} from './lifecycle.mjs';

export const stockDigest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function loadStockSource(source,{fit=false}={}){
  const response=await fetch(source.url,{cache:'no-store'});if(!response.ok)throw Error('Stock source HTTP '+response.status);
  const bytes=await response.arrayBuffer();if(await stockDigest(bytes)!==source.sha256)throw Error('Stock source digest mismatch');
  const gltf=await new GLTFLoader().parseAsync(bytes,''),meshes=[];gltf.scene.traverse(n=>{if(n.isMesh)meshes.push(n);});
  let referenceGeometry;
  try{
    if(meshes.length!==1||meshes[0].isSkinnedMesh||Array.isArray(meshes[0].material))throw Error('Stock fitting requires one rigid mesh/material');
    const donor=meshes[0];donor.updateWorldMatrix(true,false);
    if(!donor.matrixWorld.equals(new donor.matrixWorld.constructor()))throw Error('Stock fitting requires baked source coordinates');
    const geometry=donor.geometry;
    if(!geometry.attributes.normal||!geometry.attributes.uv||geometry.attributes.position.isInterleavedBufferAttribute||geometry.attributes.normal.isInterleavedBufferAttribute)throw Error('Source needs ordinary positions, normals and UVs');
    let descriptor=structuredClone(source);
    if(source.fit||fit){
      const axis=source.fit?.axis??'z',arc=source.fit?.arc,result=fitStockSource(geometry.attributes.position.array,geometry.attributes.normal.array,axis,arc);
      if(result.referencePositions){
        referenceGeometry=geometry.clone();referenceGeometry.attributes.position.array.set(result.referencePositions);referenceGeometry.attributes.normal.array.set(result.referenceNormals);
        referenceGeometry.computeBoundingBox();referenceGeometry.computeBoundingSphere();
      }
      geometry.attributes.position.array.set(result.positions);geometry.attributes.normal.array.set(result.normals);
      if(result.restAxial)geometry.setAttribute('stockRestAxial',new BufferAttribute(result.restAxial,1));
      geometry.userData.stockRestCurve=result.restCurve??null;
      if(fit){const {mouths,...rest}=descriptor;descriptor={...rest,fit:{axis,...(arc===undefined?{}:{arc:structuredClone(arc)})},profile:result.profile};}
    }
    validateStockSource(descriptor);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const box=geometry.boundingBox,p=descriptor.profile;
    if(box.min.z<p.min-1e-6||box.max.z>p.max+1e-6||box.min.x<p.xMin-1e-6||box.max.x>p.xMax+1e-6)throw Error('Source geometry is outside its fitted profile');
    return {source:descriptor,geometry,referenceGeometry,material:donor.material};
  }catch(error){referenceGeometry?.dispose();for(const mesh of meshes){mesh.geometry.dispose();for(const material of [mesh.material].flat())disposeStockMaterial(material);}throw error;}
}
