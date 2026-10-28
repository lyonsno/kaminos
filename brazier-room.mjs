import {isSurfaceAssetSource,surfaceFieldURL,surfaceAssetSources} from './surface-asset-source.mjs';
import {Mesh,BufferGeometry,BufferAttribute,MeshBasicNodeMaterial,DoubleSide,TSL} from './lib/three.webgpu.js';
import {loadSurfaceFields} from './experiments/surface-fields.experiment.mjs';
import {createDeferredSurfaceSplats} from './deferred-surface-splats.mjs';
export async function loadBrazierRoom(base){
 let splats,proxy,shadowBase;let fetcher=fetch;
 if(isSurfaceAssetSource(base)){
  const response=await fetch(base);if(!response.ok)throw Error('Stored surface asset unavailable');const manifest=await response.json(),sources=surfaceAssetSources(base,manifest);
  fetcher=async url=>{const expected=sources.files.get(String(url));if(!expected)throw Error('Undeclared surface payload');const r=await fetch(url);if(!r.ok)return r;const bytes=await r.clone().arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==expected.bytes||hash!==expected.sha256)throw Error('Stored surface payload identity mismatch');return r;};
  base=sources.base;shadowBase=sources.shadowBase;
 }
 try{
  const field=await loadSurfaceFields(base,fetcher);splats=createDeferredSurfaceSplats(field.data,field.meta,field.footprints);splats.set({mode:'opaque'});splats.root.scale.setScalar(8);splats.root.position.y=1.25;
  shadowBase??=surfaceFieldURL(base,'../shadow-proxy/');const get=async name=>{const r=await fetcher(surfaceFieldURL(shadowBase,name));if(!r.ok)throw Error('Missing shadow geometry '+name);return r;};
  const meta=await(await get('report.json')).json();if(!meta.ok)throw Error('Shadow proxy preparation failed');
  const buffers=await Promise.all(['positions.f32','triangles.u32'].map(async n=>{const b=await(await get(n)).arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==meta.files[n])throw Error('Shadow proxy hash mismatch');return b;}));
  const vertices=new Float32Array(buffers[0]),indices=new Uint32Array(buffers[1]);if(vertices.length!==meta.vertices*3||indices.length!==meta.triangles*3||!vertices.every(Number.isFinite)||indices.some(x=>x>=meta.vertices))throw Error('Invalid shadow proxy geometry');
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(vertices,3));geometry.setIndex(new BufferAttribute(indices,1));
  const material=new MeshBasicNodeMaterial({side:DoubleSide});material.maskNode=TSL.bool(false);
  proxy=new Mesh(geometry,material);proxy.name='Room shadow geometry';proxy.castShadow=true;proxy.userData.provenance={source:shadowBase,triangles:meta.triangles,sourceTriangles:meta.sourceTriangles,approximation:true,visible:false,hashes:meta.files};proxy.userData.kaminosAODepthMaterial=material;splats.root.add(proxy);

  const dispose=()=>{proxy?.geometry.dispose();proxy?.material.dispose();splats?.dispose();};
  splats.root.userData.disposeBrazierRoom=dispose;
  return {root:splats.root,dispose,read:splats.read};
 }catch(error){proxy?.geometry.dispose();proxy?.material.dispose();splats?.dispose();throw error;}
}
