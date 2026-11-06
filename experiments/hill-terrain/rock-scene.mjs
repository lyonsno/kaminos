import * as THREE from '../../lib/three.core.js';
import {MeshStandardNodeMaterial} from '../../lib/three.webgpu.js';
import {createRockOutcrop,packRockPlanes,raycastRock} from './rock-geometry.mjs';

// One source owns the explicit mesh and the query planes. Existing terrain
// remains another solid; this layer is an initial authored outcrop, not erosion.
export function createRockScene(options={}){
 const root=new THREE.Group();root.name='Plane-defined rock outcrop';
 let source,plain=true,gpuBuffers=null,generation=0;
 const releaseGPU=()=>{gpuBuffers?.planes.destroy();gpuBuffers?.blocks.destroy();gpuBuffers=null;};
 const materials=[0xb0a18b,0xa99984,0xb4a590].map(color=>new MeshStandardNodeMaterial({color,roughness:.94}));
 function rebuild(patch={}){
  const next=createRockOutcrop({...options,...patch});
  for(const ch of [...root.children]){ch.geometry.dispose();root.remove(ch);}
  releaseGPU();generation++;options={origin:next.origin,scale:next.scale,gap:next.gap,wear:next.wear};source=next;
  for(const solid of source.solids){
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(solid.positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(solid.normals,3));geo.computeBoundingBox();geo.computeBoundingSphere();
   const mesh=new THREE.Mesh(geo,materials[solid.bed]);mesh.name=`Rock ${solid.id}`;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  setPlain(plain);return read();
 }
 function setPlain(value){plain=value;for(let i=0;i<materials.length;i++)materials[i].color.set(plain?0xb0a18b:[0xb0a18b,0xa99984,0xb4a590][i]);}
 const read=()=>({kind:source.kind,visible:root.visible,plainMaterial:plain,origin:source.origin,scale:source.scale,gap:source.gap,wear:source.wear,solids:source.solids.length,triangles:source.solids.reduce((n,s)=>n+s.positions.length/9,0),planeCount:source.solids.reduce((n,s)=>n+s.planes.length,0),dynamic:false,contactAdapter:'source-planes; game consumer not integrated'});
 rebuild();
 const gpu=device=>{
  if(gpuBuffers&&gpuBuffers.device!==device)releaseGPU();
  if(!gpuBuffers){
   const packed=packRockPlanes(source.solids);
   const upload=data=>{const b=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);return b;};
   gpuBuffers={device,planes:upload(packed.planes),blocks:upload(packed.blocks)};
  }
  return{planes:gpuBuffers.planes,blocks:gpuBuffers.blocks,blockCount:source.solids.length,generation,coordinateSpace:'hill-local',kind:source.kind};
 };
 return{root,read,rebuild,setPlain,gpu,source:()=>source,packed:()=>packRockPlanes(source.solids),raycast:(o,d)=>raycastRock(source.solids,o,d),dispose(){releaseGPU();for(const m of root.children)m.geometry.dispose();materials.forEach(m=>m.dispose());}};
}
