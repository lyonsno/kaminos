import * as THREE from '../lib/three.webgpu.js';
import {createLocalSceneVisibility} from '../scene-local-visibility.mjs';
import {createBvhReproject} from '../scene-bvh-reproject.mjs';
export async function runResidentLightFixture(){
 const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
 const owned=[],rows=[];let reproject;
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial({alphaTest:.5}));
 mesh.castShadow=true;mesh.material.opacityNode=THREE.TSL.float(1);scene.add(mesh);
 const texture=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
 let revision=0;
 const descriptor={texture,device,initial:new Uint32Array([1,0,0,0,0,0,0,1]),dimensions:[2,2,2],bounds:new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5))};
 const visibility=createLocalSceneVisibility({readCoverage:m=>m===mesh?{owner:mesh,read:()=>({...descriptor,revision})}:null});
 const geometry=visibility.snapshot(scene).geometry;
 const buffer=(values)=>{const b=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,values);return b;};
 const nodes=buffer(geometry.nodes),triangles=buffer(geometry.triangles),staging=device.createBuffer({size:triangles.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(staging);
 try{
  device.pushErrorScope('validation');reproject=createBvhReproject(device,{geometry,nodes,triangles});
  for(const [name,cells,x] of [['full',[0,7],0],['consumed',[7],0],['moved',[7],3],['reset',[0,7],3]]){
   const pixels=new Uint16Array(32);for(const cell of cells)pixels[cell*4+3]=0x3c00;
   device.queue.writeTexture({texture},pixels,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);revision++;mesh.position.x=x;
   visibility.snapshot(scene);const encoder=device.createCommandEncoder();
   if(!reproject.encode(encoder,{translate:[0,0,0],scale:1},geometry.matrices))throw Error('Resident coverage failed to invalidate visibility');
   encoder.copyBufferToBuffer(triangles,0,staging,0,triangles.size);device.queue.submit([encoder.finish()]);reproject.commit();
   await staging.mapAsync(GPUMapMode.READ);const values=new Float32Array(staging.getMappedRange()),active=[];
   for(let i=0;i<geometry.triangleCount;i++){const at=i*12;if(Math.hypot(...values.slice(at+4,at+7))>0){active.push(values[at+3]-1);if(values[at]<x-.50001||values[at]>x+.50001)throw Error('Resident light proxy did not follow mesh pose');}}
   staging.unmap();if(active.length!==cells.length*12||active.some(cell=>!cells.includes(cell)))throw Error('Consumed material retained ghost light triangles');
   rows.push({name,activeTriangles:active.length,cells,x,localBuilds:visibility.snapshot(scene).localBuilds});
  }
  await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(error.message);
  if(rows.some(row=>row.localBuilds!==1))throw Error('Resident occupancy rebuilt CPU topology');
  return {status:'passed',route:'native-webgpu-resident-material-to-light-bvh',rows,runtimeReadbacks:0,evidenceReadbacks:rows.length};
 }finally{reproject?.destroy();for(const r of owned)r.destroy();mesh.geometry.dispose();mesh.material.dispose();device.destroy();}
}
