import * as THREE from '../lib/three.webgpu.js';
import {createLocalSceneVisibility} from '../scene-local-visibility.mjs';
import {createBvhReproject} from '../scene-bvh-reproject.mjs';
export async function runResidentLightFixture(){
 const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
 const owned=[],rows=[];let reproject;
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial({alphaTest:.5}));
 mesh.castShadow=true;mesh.material.opacityNode=THREE.TSL.float(1);scene.add(mesh);
 const texture=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
 const second=mesh.clone();second.position.x=5;scene.add(second);
 const secondTexture=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(secondTexture);
 let revision=0;
 const descriptor={texture,device,initial:new Uint32Array([1,0,0,0,0,0,0,1]),dimensions:[2,2,2],bounds:new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5))};
 const visibility=createLocalSceneVisibility({readCoverage:m=>m===mesh?{owner:mesh,read:()=>({...descriptor,revision})}:m===second?{owner:second,read:()=>({...descriptor,texture:secondTexture,revision})}:null});
 const geometry=visibility.snapshot(scene).geometry;
 const buffer=(values)=>{const b=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,values);return b;};
 const nodes=buffer(geometry.nodes),triangles=buffer(geometry.triangles),staging=device.createBuffer({size:triangles.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(staging);
 try{
  device.pushErrorScope('validation');reproject=createBvhReproject(device,{geometry,nodes,triangles});
  for(const [name,cells,otherCells,x] of [['full',[0,7],[0,7],0],['consumed',[7],[0,7],0],['moved',[7],[0],3],['reset',[0,7],[],3]]){
   const pixels=new Uint16Array(32);for(const cell of cells)pixels[cell*4+3]=0x3c00;
   device.queue.writeTexture({texture},pixels,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);revision++;mesh.position.x=x;
   const otherPixels=new Uint16Array(32);for(const cell of otherCells)otherPixels[cell*4+3]=0x3c00;
   device.queue.writeTexture({texture:secondTexture},otherPixels,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);
   visibility.snapshot(scene);const encoder=device.createCommandEncoder();
   if(!reproject.encode(encoder,{translate:[0,0,0],scale:1},geometry.matrices))throw Error('Resident coverage failed to invalidate visibility');
   encoder.copyBufferToBuffer(triangles,0,staging,0,triangles.size);device.queue.submit([encoder.finish()]);reproject.commit();
   await staging.mapAsync(GPUMapMode.READ);const values=new Float32Array(staging.getMappedRange()),active=[[],[]],raw=Array.from(values);
   for(let i=0;i<geometry.triangleCount;i++){const at=i*12,owner=geometry.owners[geometry.nodeCount+i],position=owner===0?x:5;if(Math.hypot(...values.slice(at+4,at+7))>0){active[owner].push(values[at+3]-1);if(values[at]<position-.50001||values[at]>position+.50001)throw Error('Resident light proxy did not follow mesh pose');}}
   staging.unmap();
   rows.push({name,activeTriangles:active.map(a=>a.length),cells:[cells,otherCells],x,localBuilds:visibility.snapshot(scene).localBuilds,raw});
   for(const [owner,expected]of [cells,otherCells].entries())if(active[owner].length!==expected.length*12||active[owner].some(cell=>!expected.includes(cell)))throw Error('Consumed material retained ghost light triangles or sampled another object');
  }
  await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(error.message);
  if(rows.some(row=>row.localBuilds!==2))throw Error('Resident occupancy rebuilt CPU topology');
  return {status:'passed',route:'native-webgpu-resident-material-to-light-bvh',rows,runtimeReadbacks:0,evidenceReadbacks:rows.length};
 }finally{reproject?.destroy();for(const r of owned)r.destroy();mesh.geometry.dispose();mesh.material.dispose();device.destroy();}
}
