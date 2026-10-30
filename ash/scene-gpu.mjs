import {Box3,Vector3,Matrix4,Mesh} from '../lib/three.core.js';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';
import {sceneTiles} from './scene-plan.mjs';

// Object-local occupancy survives rigid motion. Geometry is conservatively
// voxelized by the shared producer; live poses resample only affected ash tiles.
export function createAshSceneSolids({device,layout:p,collision,headers}){
 const t=p.tiles,cache=new Map(),boundsCache=new WeakMap(),pendingDirty=new Set();let builds=0,updates=0,lastTiles=0,disposed=false,geometryRevision=0;
 const jobs=device.createBuffer({label:'ash moved-solid tile addresses',size:(t.count+1)*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const dummy=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
 const blank=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const code=`
 const B:u32=${t.width}u;const V:u32=${t.cellsPerTile}u;const G:u32=${t.groupsPerTile}u;
 const TD=vec3<u32>(${t.dims.map(n=>n+'u')});const D=vec3<u32>(${p.dims.map(n=>n+'u')});
 const O=vec3<f32>(${p.origin.map(n=>Number(n).toFixed(12))});const S:f32=${p.cellSize.toFixed(12)};
 struct Pose {inverse:mat4x4<f32>,local:vec4<f32>}
 @group(0) @binding(0) var<storage,read_write> solid:array<u32>;
 @group(0) @binding(1) var<storage,read_write> headers:array<atomic<u32>>;
 @group(0) @binding(2) var<storage,read> jobs:array<u32>;
 @group(0) @binding(3) var shape:texture_3d<u32>;
 @group(0) @binding(4) var<uniform> pose:Pose;
 fn tc(i:u32)->vec3<u32>{return vec3<u32>(i%TD.x,(i/TD.x)%TD.y,i/(TD.x*TD.y));}
 fn ti(c:vec3<u32>)->u32{return c.x+TD.x*(c.y+TD.y*c.z);}
 fn cell(wg:u32,lid:u32)->vec3<u32>{let i=(wg%G)*64u+lid;return tc(jobs[1u+wg/G])*B+vec3<u32>(i%B,(i/B)%B,i/(B*B));}
 @compute @workgroup_size(64) fn clear(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let local=(w.x%G)*64u+l.x;if(local>=V){return;}let c=cell(w.x,l.x);
  if(all(c<D)){solid[c.x+D.x*(c.y+D.y*c.z)]=0u;}
  if(local==0u){let a=vec3<i32>(tc(jobs[1u+w.x/G]));
   for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let q=a+vec3<i32>(x,y,z);if(all(q>=vec3<i32>(0))&&all(q<vec3<i32>(TD))){let i=ti(vec3<u32>(q))*8u;atomicStore(&headers[i],1u);atomicStore(&headers[i+2u],1u);}
   }}}
  }
 }
 @compute @workgroup_size(64) fn stamp(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  if((w.x%G)*64u+l.x>=V){return;}let c=cell(w.x,l.x);if(any(c>=D)){return;}
  let world=O+(vec3<f32>(c)+vec3<f32>(.5))*S;
  let point=(pose.inverse*vec4<f32>(world,1)).xyz;let q=vec3<i32>(floor((point-pose.local.xyz)/pose.local.w));
  if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(textureDimensions(shape)))){return;}
  if(textureLoad(shape,q,0).x!=0u){solid[c.x+D.x*(c.y+D.y*c.z)]=2u;}
 }`;
 const module=device.createShaderModule({label:'ash moving scene occupancy',code});
 const bindLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},
  {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindLayout]});
 const pipelines=Object.fromEntries(['clear','stamp'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}})]));
 const group=(texture,uniform)=>device.createBindGroup({layout:bindLayout,entries:[{binding:0,resource:{buffer:collision}},{binding:1,resource:{buffer:headers}},{binding:2,resource:{buffer:jobs}},{binding:3,resource:texture.createView()},{binding:4,resource:{buffer:uniform}}]});
 const clearGroup=group(dummy,blank);
 const destroy=m=>{m.texture.destroy();m.uniform.destroy();};
 function geometry(mesh){
  const g=mesh.geometry,a=g?.getAttribute('position'),i=g?.getIndex();
  if(!a)throw Error(`Ash collision requires triangles: ${mesh.name}`);
  if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(v=>v!==0))throw Error(`Ash collision requires evaluated rigid geometry: ${mesh.name}`);
  const scale=new Vector3().setFromMatrixScale(mesh.matrixWorld),largest=Math.max(...scale.toArray().map(Math.abs));
  if(!Number.isFinite(largest)||largest<=0||Math.abs(mesh.matrixWorld.determinant())<1e-12)throw Error(`Ash collision requires an invertible transform: ${mesh.name}`);
  // Quantize the local sampling resolution so translations/rotations never
  // rerasterize; growing scale earns a finer shape when it crosses a cell.
  const version=[a,a.version??a.data?.version??0,i,i?.version??0,a.count,i?.count??0];let cached=boundsCache.get(g);
  if(!cached||version.some((v,k)=>v!==cached.version[k])){
   g.computeBoundingBox();let h=2166136261,j=2246822519;
   // Content identity survives scene reconstruction; geometry UUIDs do not.
   const bits=new DataView(new ArrayBuffer(8)),mix=v=>{bits.setFloat64(0,v,true);for(let b=0;b<8;b++){h=Math.imul(h^bits.getUint8(b),16777619);j=Math.imul(j^bits.getUint8(b),3266489917);}};
   mix(a.count);for(let v=0;v<a.count;v++){mix(a.getX(v));mix(a.getY(v));mix(a.getZ(v));}mix(i?.count??0);if(i)for(let v=0;v<i.count;v++)mix(i.getX(v));
   cached={version,bounds:g.boundingBox.clone(),revision:++geometryRevision,digest:(h>>>0).toString(16)+':'+(j>>>0).toString(16)};boundsCache.set(g,cached);
  }
  const bounds=cached.bounds,size=bounds.getSize(new Vector3());
  const grid=Math.max(4,Math.ceil(Math.max(...size.toArray())*largest/p.cellSize-1e-8)+4),step=Math.max(...size.toArray())/(grid-4);
  if(!(step>0))throw Error(`Ash collision has zero extent: ${mesh.name}`);
  const center=bounds.getCenter(new Vector3()),extent=grid*step,origin=center.clone().addScalar(-extent/2);
  const key=[g.uuid,cached.revision,grid].join(':');const identity=[cached.digest,a.count,i?.count??0,grid].join(':');
  return {key,identity,grid,step,origin,center,bounds};
 }
 function build(mesh,spec){
  const {grid,step,origin,center,bounds}=spec,bytes=grid**3*4;
  if(grid>device.limits.maxTextureDimension3D||bytes+4>device.limits.maxStorageBufferBindingSize||bytes+4>device.limits.maxBufferSize||Math.ceil(grid**3/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error(`Ash shape exceeds effective GPU capacity: ${mesh.name} (${grid} cubed)`);
  let producer,texture,uniform;
  try{
   producer=createGpuSceneSolidProducer(device,{grid});const proxy=new Mesh(mesh.geometry,mesh.material);proxy.updateMatrixWorld(true);
   producer.update([{id:mesh.uuid,object:proxy}],{translate:center.toArray(),scale:grid*step/2},{grid,gridHeight:grid});
   texture=device.createTexture({label:'cached local ash solid '+mesh.name,size:[grid,grid,grid],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const e=device.createCommandEncoder();producer.encode(e);e.copyTextureToTexture({texture:producer.texture},{texture},[grid,grid,grid]);device.queue.submit([e.finish()]);
   uniform=device.createBuffer({label:'ash object pose '+mesh.name,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   builds++;return {...spec,texture,uniform,group:group(texture,uniform),box:null,matrix:null,bytes:bytes+80};
  }catch(error){texture?.destroy();uniform?.destroy();throw error;}finally{producer?.destroy();}
 }
 function update(records){
  if(disposed)throw Error('Ash scene collision disposed');
  const meshes=new Map();
  for(const {id,object,key:objectKey=id} of records){object.updateWorldMatrix(true,true);object.traverse(mesh=>{
   if(!mesh.isMesh)return;for(let n=mesh;n;n=n.parent)if(!n.visible||n.userData?.kaminosEditorHelper||n.userData?.kaminosEditorOnly)return;
   meshes.set(mesh.uuid,{mesh,id,objectKey});
  });}
  const dirty=pendingDirty,include=box=>{for(const i of sceneTiles(p,box))dirty.add(i);};
  for(const [key,m] of cache)if(!meshes.has(key)){include(m.box);destroy(m);cache.delete(key);}
  for(const [key,{mesh,id,objectKey}] of meshes){
   const spec=geometry(mesh);let m=cache.get(key);const matrix=mesh.matrixWorld.toArray();
   const worldBox=spec.bounds.clone().expandByScalar(spec.step).applyMatrix4(mesh.matrixWorld),boxNow={min:worldBox.min.toArray(),max:worldBox.max.toArray()};
   if(!sceneTiles(p,boxNow).length){if(m){include(m.box);destroy(m);cache.delete(key);}continue;}
   if(m?.key===spec.key&&matrix.every((v,i)=>Math.abs(v-m.matrix[i])<1e-10)){m.id=id;m.objectKey=objectKey;continue;}
   if(m)include(m.box);
   if(!m||m.key!==spec.key){const next=build(mesh,spec);if(m)destroy(m);m=next;cache.set(key,m);}
   m.id=id;m.objectKey=objectKey;m.name=mesh.name;m.matrix=matrix;
   // Padding includes the conservative local shell at the geometric boundary.
   m.box=boxNow;include(m.box);
   const values=new Float32Array(20);values.set(new Matrix4().copy(mesh.matrixWorld).invert().elements);values.set([...m.origin.toArray(),m.step],16);device.queue.writeBuffer(m.uniform,0,values);
  }
  lastTiles=dirty.size;if(!dirty.size)return false;
  device.queue.writeBuffer(jobs,0,new Uint32Array([dirty.size,...dirty]));
  const encoder=device.createCommandEncoder(),dispatch=(name,bind)=>{const pass=encoder.beginComputePass({label:'ash scene '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(dirty.size*t.groupsPerTile);pass.end();};
  dispatch('clear',clearGroup);
  // Recompose all overlapping members, including unchanged objects, so moving
  // or removing one object cannot erase another object's occupied cells.
  for(const m of cache.values())if(sceneTiles(p,m.box).some(i=>dirty.has(i)))dispatch('stamp',m.group);
  device.queue.submit([encoder.finish()]);dirty.clear();updates++;return true;
 }
 return {update,read:()=>({route:'cached-local-triangle-occupancy',pendingDirtyTiles:pendingDirty.size,shapeBuilds:builds,updates,lastDirtyTiles:lastTiles,allocatedBytes:(t.count+1)*4+84+[...cache.values()].reduce((n,m)=>n+m.bytes,0),members:[...cache.values()].map(m=>({id:m.id,key:m.objectKey,name:m.name,geometry:m.identity,matrix:m.matrix,grid:m.grid}))}),dispose(){if(disposed)return;disposed=true;for(const m of cache.values())destroy(m);cache.clear();jobs.destroy();dummy.destroy();blank.destroy();}};
}
