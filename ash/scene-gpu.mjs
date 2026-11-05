import {Box3,Vector3,Matrix4,Mesh} from '../lib/three.core.js';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';
import {ashDispatchGrid} from './gpu-plan.mjs';
import {sceneTiles} from './scene-plan.mjs';

// Object-local occupancy survives rigid motion. Geometry is conservatively
// voxelized by the shared producer; live poses resample only affected ash tiles.
export function createAshSceneSolids({device,layout:p,collision,headers,collisionOffset=0,headersOffset=0,samplingCellSize=p.cellSize,adaptive=null}){
 const t=p.tiles,cache=new Map(),boundsCache=new WeakMap(),pendingDirty=new Set();let builds=0,updates=0,lastTiles=0,disposed=false,geometryRevision=0;
 let jobsCapacity=t.count+1,jobs=device.createBuffer({label:'ash moved-solid tile addresses',size:jobsCapacity*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const dummy=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
 const blank=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 let code=`
 const ROW:u32=${device.limits.maxComputeWorkgroupsPerDimension}u;
 const B:u32=${t.width}u;const V:u32=${t.cellsPerTile}u;const G:u32=${t.groupsPerTile}u;
 const TD=vec3<u32>(${t.dims.map(n=>n+'u')});const D=vec3<u32>(${p.dims.map(n=>n+'u')});
 const O=vec3<f32>(${p.origin.map(n=>Number(n).toFixed(12))});const S:f32=${p.cellSize.toFixed(12)};
 struct Pose {inverse:mat4x4<f32>,local:vec4<f32>,tiles:vec4<u32>,burner0:vec4<f32>,burner1:vec4<f32>}
 @group(0) @binding(0) var<storage,read_write> solid:array<u32>;
 @group(0) @binding(1) var<storage,read_write> headers:array<atomic<u32>>;
 @group(0) @binding(2) var<storage,read> jobs:array<u32>;
 @group(0) @binding(3) var shape:texture_3d<u32>;
 @group(0) @binding(4) var<uniform> pose:Pose;
 fn tc(i:u32)->vec3<u32>{return vec3<u32>(i%TD.x,(i/TD.x)%TD.y,i/(TD.x*TD.y));}
 fn ti(c:vec3<u32>)->u32{return c.x+TD.x*(c.y+TD.y*c.z);}
 fn cell(base:u32,wg:u32,lid:u32)->vec3<u32>{let i=(wg%G)*64u+lid;return tc(jobs[base+wg/G])*B+vec3<u32>(i%B,(i/B)%B,i/(B*B));}
 fn burner_solid(point:vec3<f32>,localCell:f32,b0:vec4<f32>,b1:vec4<f32>)->bool{
  let rIn=b0.x;let rOut=b0.y;let rings=b0.z;let gFrac=b0.w;
  let gDepth=b1.x;let sectors=b1.y;let thick=b1.z;let rimH=b1.w;
  let halfCell=0.5*localCell;
  let r=length(point.xz);
  if(r>rOut+0.045+halfCell){return false;}
  let yBottom=-thick-halfCell;
  if(point.y<yBottom){return false;}
  if(r>=rOut){return point.y<=max(rimH,-thick+halfCell);}
  if(r<=rIn){return point.y<=max(0.0,-thick+halfCell);}
  let pitch=(rOut-rIn)/rings;
  let grooveW=pitch*gFrac;
  let bedTop=-gDepth+0.001;
  let baseTop=max(bedTop,-thick+halfCell);
  if(point.y<=baseTop){return true;}
  let landTop=select(max(0.0,-thick+halfCell),max(0.0,baseTop+localCell),grooveW>=localCell);
  if(point.y>landTop){return false;}
  if(grooveW<localCell){return true;}
  let u=fract((r-rIn)/pitch);
  if(abs(u-0.5)<gFrac*0.5){return false;}
  let sectorSpan=6.28318530718/sectors;
  let seam=min(0.012,3.14159265359/sectors*0.06);
  if(seam*r>=localCell){
   let phi=atan2(point.x,point.z);
   let phase=fract(phi/sectorSpan)*sectorSpan;
   if(phase<seam*0.5||phase>sectorSpan-seam*0.5){return false;}
  }
  return true;
 }
 @compute @workgroup_size(64) fn clear(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let group=w.x+w.y*ROW;if(group>=jobs[0]*G){return;}let local=(group%G)*64u+l.x;if(local>=V){return;}let c=cell(1u,group,l.x);
  if(all(c<D)){solid[c.x+D.x*(c.y+D.y*c.z)]=0u;}
  if(local==0u){let a=vec3<i32>(tc(jobs[1u+group/G]));
   for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let q=a+vec3<i32>(x,y,z);if(all(q>=vec3<i32>(0))&&all(q<vec3<i32>(TD))){let i=ti(vec3<u32>(q))*8u;atomicStore(&headers[i],1u);atomicStore(&headers[i+2u],1u);}
   }}}
  }
 }
 @compute @workgroup_size(64) fn stamp(@builtin(workgroup_id) w:vec3<u32>,@builtin(local_invocation_id) l:vec3<u32>){
  let group=w.x+w.y*ROW;if(group>=pose.tiles.y*G||(group%G)*64u+l.x>=V){return;}let c=cell(pose.tiles.x,group,l.x);if(any(c>=D)){return;}
  let world=O+(vec3<f32>(c)+vec3<f32>(.5))*S;
  let point=(pose.inverse*vec4<f32>(world,1)).xyz;
  if(pose.tiles.z==1u){
   if(burner_solid(point,pose.local.w,pose.burner0,pose.burner1)){solid[c.x+D.x*(c.y+D.y*c.z)]=2u;}
   return;
  }
  let q=vec3<i32>(floor((point-pose.local.xyz)/pose.local.w));
  if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(textureDimensions(shape)))){return;}
  if(textureLoad(shape,q,0).x!=0u){solid[c.x+D.x*(c.y+D.y*c.z)]=2u;}
 }`;
 const burnerWGSL=code.slice(code.indexOf(' fn burner_solid'),code.indexOf(' @compute'));
 if(adaptive){
  const {layout:ap,arena:map}=adaptive,a=ap.adaptiveArena,dp=ap.pool.pageDims;
  code=code.replace(' @compute @workgroup_size(64) fn clear',`
 @group(0) @binding(5) var<storage,read_write> ashMap:array<atomic<u32>>;
 fn page_of(c:vec3<u32>)->u32{let q=c/4u;return q.x+${dp[0]}u*(q.y+${dp[1]}u*q.z);}
 fn fine_occupied(world:vec3<f32>)->bool{
 let point=(pose.inverse*vec4<f32>(world,1)).xyz;
  if(pose.tiles.z==1u){return burner_solid(point,pose.local.w,pose.burner0,pose.burner1);}
  let q=vec3<i32>(floor((point-pose.local.xyz)/pose.local.w));
  if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(textureDimensions(shape)))){return false;}
  return textureLoad(shape,q,0).x!=0u;
 }
 @compute @workgroup_size(64) fn clear`);
  code=code.replace('solid[c.x+D.x*(c.y+D.y*c.z)]=0u;',`solid[c.x+D.x*(c.y+D.y*c.z)]=0u;
   if(all(c%4u==vec3<u32>(0))){atomicStore(&ashMap[${a.demand}u+page_of(c)],0u);}
   let slot=atomicLoad(&ashMap[${a.map}u+page_of(c)]);if(slot!=0u){atomicOr(&ashMap[${a.flags}u+slot-1u],2u);}`);
  code=code.replace('  let point=(pose.inverse*vec4<f32>(world,1)).xyz;',`  var mask=0u;
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
   let at=O+(vec3<f32>(c)+(vec3<f32>(f32(x),f32(y),f32(z))+.5)*.5)*S;
   if(fine_occupied(at)){mask|=1u<<(x+2u*y+4u*z);}
  }}}
  // Horizontal variation finds ledges/gaps and rejects a uniform horizontal
  // support plane. Compare the four fine columns of the same coarse cell.
  let column=mask&5u;var differs=false;
  for(var z=0u;z<2u;z++){for(var x=0u;x<2u;x++){if(((mask>>(x+4u*z))&5u)!=column){differs=true;}}}
  if(differs){atomicMax(&ashMap[${a.demand}u+page_of(c)],2u);}
  let point=(pose.inverse*vec4<f32>(world,1)).xyz;`);
 }
 const module=device.createShaderModule({label:'ash moving scene occupancy',code});
 const bindLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:3,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},
  {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...(adaptive?[{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]:[])]});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindLayout]});
 const pipelines=Object.fromEntries(['clear','stamp'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}})]));
 const group=(texture,uniform)=>device.createBindGroup({layout:bindLayout,entries:[{binding:0,resource:{buffer:collision,offset:collisionOffset,size:p.count*4}},{binding:1,resource:{buffer:headers,offset:headersOffset,size:t.count*32}},{binding:2,resource:{buffer:jobs}},{binding:3,resource:texture.createView()},{binding:4,resource:{buffer:uniform}},...(adaptive?[{binding:5,resource:{buffer:adaptive.arena}}]:[])]});
 let clearGroup=group(dummy,blank);
 const destroy=m=>{m.texture?.destroy();m.coarseTexture?.destroy();m.uniform.destroy();};
 const maxBytes=Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize);
 const maxCells=Math.min(Math.floor((maxBytes-4)/4),device.limits.maxComputeWorkgroupsPerDimension*64);
 const capacityGrid=Math.min(device.limits.maxTextureDimension3D,Math.floor(Math.cbrt(Math.max(0,maxCells))));
 const maxGrid=Math.min(128,capacityGrid);
 function geometry(mesh,prev=null,checkpoint=null){
  const g=mesh.geometry,a=g?.getAttribute('position'),i=g?.getIndex();
  if(!a)throw Error(`Ash collision requires triangles: ${mesh.name}`);
  if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.some(v=>v!==0))throw Error(`Ash collision requires evaluated rigid geometry: ${mesh.name}`);
  const scale=new Vector3().setFromMatrixScale(mesh.matrixWorld),largest=Math.max(...scale.toArray().map(Math.abs));
  if(!Number.isFinite(largest)||largest<=0||Math.abs(mesh.matrixWorld.determinant())<1e-12)throw Error(`Ash collision requires an invertible transform: ${mesh.name}`);
  const b=mesh.userData?.kaminosAnalyticAnnularBurner;
  if(b){
   const rMax=b.outerRadius+0.045,bounds=new Box3(new Vector3(-rMax,-b.thickness,-rMax),new Vector3(rMax,Math.max(0,b.rimHeight),rMax));
   const step=samplingCellSize/largest,tag=[b.innerRadius,b.outerRadius,b.ringCount,b.grooveFraction,b.grooveDepth,b.sectorCount,b.thickness,b.rimHeight].join(',');
   const key='annular-analytic:'+tag;
   return {analyticBurner:b,key,identity:key,revision:0,grid:0,step,origin:new Vector3(),center:new Vector3(),bounds,fullBounds:bounds,clipped:false,coarseKey:null};
  }
  // Quantize the local sampling resolution so translations/rotations never
  // rerasterize; growing scale earns a finer shape when it crosses a bucket.
  const version=[a,a.version??a.data?.version??0,i,i?.version??0,a.count,i?.count??0];let cached=boundsCache.get(g);
  if(!cached||version.some((v,k)=>v!==cached.version[k])){
   g.computeBoundingBox();let h=2166136261,j=2246822519;
   // Content identity survives scene reconstruction; geometry UUIDs do not.
   const bits=new DataView(new ArrayBuffer(8)),mix=v=>{bits.setFloat64(0,v,true);for(let b=0;b<8;b++){h=Math.imul(h^bits.getUint8(b),16777619);j=Math.imul(j^bits.getUint8(b),3266489917);}};
   mix(a.count);for(let v=0;v<a.count;v++){mix(a.getX(v));mix(a.getY(v));mix(a.getZ(v));}mix(i?.count??0);if(i)for(let v=0;v<i.count;v++)mix(i.getX(v));
   cached={version,bounds:g.boundingBox.clone(),revision:++geometryRevision,digest:(h>>>0).toString(16)+':'+(j>>>0).toString(16)};boundsCache.set(g,cached);
  }
  const fullBounds=cached.bounds,fullSize=fullBounds.getSize(new Vector3()),fullSpan=Math.max(...fullSize.toArray());
  if(!(fullSpan>0))throw Error(`Ash collision has zero extent: ${mesh.name}`);
  // A checkpoint names its original full-mesh sampling grid. Recreate that
  // grid only for matching content and pose; strict restore still compares
  // every identity row before admitting any saved material.
  const prefix=[cached.digest,a.count,i?.count??0].join(':')+':';
  const suffix=typeof checkpoint?.geometry==='string'&&checkpoint.geometry.startsWith(prefix)?checkpoint.geometry.slice(prefix.length):'';
  const savedGrid=/^\d+$/.test(suffix)?Number(suffix):null;
  const samplingGrid=savedGrid>4&&savedGrid<=capacityGrid&&checkpoint.matrix?.length===16&&mesh.matrixWorld.elements.every((v,i)=>v===checkpoint.matrix[i])?savedGrid:null;
  if(prev&&prev.samplingGrid===samplingGrid&&prev.revision===cached.revision&&prev.matrix&&mesh.matrixWorld.elements.every((v,i)=>Math.abs(v-prev.matrix[i])<1e-10))return prev;
  const rawGrid=Math.max(4,Math.ceil(fullSpan*largest/samplingCellSize-1e-8)+4);
  if(maxGrid<4)throw Error(`Ash shape exceeds effective GPU capacity: ${mesh.name} (${rawGrid} cubed)`);
  if(samplingGrid!==null||rawGrid<=maxGrid){
   const grid=samplingGrid??(rawGrid<=32?rawGrid:Math.min(maxGrid,Math.ceil(rawGrid/32)*32)),step=fullSpan/(grid-4);
   const center=fullBounds.getCenter(new Vector3()),extent=grid*step,origin=center.clone().addScalar(-extent/2);
   const key=[g.uuid,cached.revision,grid].join(':'),identity=[cached.digest,a.count,i?.count??0,grid].join(':');
   return {key,identity,samplingGrid,revision:cached.revision,grid,step,origin,center,bounds:fullBounds,fullBounds,clipped:false,coarseKey:null};
  }
  const inv=new Matrix4().copy(mesh.matrixWorld).invert();
  const localBox=pad=>{const w=new Box3(new Vector3(p.origin[0]-pad,p.origin[1]-pad,p.origin[2]-pad),new Vector3(p.origin[0]+p.dims[0]*p.cellSize+pad,p.origin[1]+p.dims[1]*p.cellSize+pad,p.origin[2]+p.dims[2]*p.cellSize+pad)).applyMatrix4(inv);return fullBounds.clone().intersect(w);};
  const reqBounds=localBox(2*samplingCellSize);
  if(reqBounds.isEmpty())return {empty:true,bounds:reqBounds,step:0};
  const padBounds=localBox(8*samplingCellSize);
  const reuseBounds=prev?.clipped&&prev.revision===cached.revision&&prev.bounds.containsBox(reqBounds)&&prev.bounds.getSize(new Vector3()).length()<=padBounds.getSize(new Vector3()).length()*1.6;
  const activeBounds=reuseBounds?prev.bounds.clone():padBounds;
  const activeSpan=Math.max(1e-6,...activeBounds.getSize(new Vector3()).toArray());
  const clipRaw=Math.max(4,Math.ceil(activeSpan*largest/samplingCellSize-1e-8)+4);
  const grid=clipRaw<=32?clipRaw:Math.min(maxGrid,Math.ceil(clipRaw/32)*32);
  const qSpan=Math.max(activeSpan,Math.min(fullSpan,(grid-4)*(samplingCellSize/largest))),step=qSpan/(grid-4);
  const center=activeBounds.getCenter(new Vector3()),extent=grid*step,origin=center.clone().addScalar(-extent/2);
  const isClipped=!activeBounds.min.equals(fullBounds.min)||!activeBounds.max.equals(fullBounds.max);
  const coarseGrid=Math.min(64,maxGrid),coarseStep=fullSpan/(coarseGrid-4),coarseCenter=fullBounds.getCenter(new Vector3()),coarseOrigin=coarseCenter.clone().addScalar(-coarseGrid*coarseStep/2);
  const coarseKey=isClipped?[g.uuid,cached.revision,coarseGrid].join(':'):null;
  const boxTag=isClipped?[...activeBounds.min.toArray(),...activeBounds.max.toArray()].map(v=>v.toFixed(6)).join(','):'full';
  const key=[g.uuid,cached.revision,grid,boxTag].join(':'),identity=[cached.digest,a.count,i?.count??0,grid,boxTag].join(':');
  return {key,identity,samplingGrid,revision:cached.revision,grid,step,origin,center,bounds:activeBounds,fullBounds,clipped:isClipped,coarseKey,coarseGrid,coarseStep,coarseCenter,coarseOrigin};
 }
 function build(mesh,spec,prev=null){
  if(spec.analyticBurner){
   const uniform=device.createBuffer({label:'ash analytic burner '+mesh.name,size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   builds++;return {...spec,texture:null,coarseTexture:null,uniform,group:group(dummy,uniform),box:null,matrix:null,bytes:128};
  }
  const {grid,step,origin,center,bounds,fullBounds,clipped,coarseKey,coarseGrid,coarseStep,coarseCenter,coarseOrigin}=spec,bytes=grid**3*4;
  if(grid>device.limits.maxTextureDimension3D||bytes+4>device.limits.maxStorageBufferBindingSize||bytes+4>device.limits.maxBufferSize||Math.ceil(grid**3/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error(`Ash shape exceeds effective GPU capacity: ${mesh.name} (${grid} cubed)`);
  let producer,coarseProducer,texture,coarseTexture=null,reusedCoarse=false,uniform;
  try{
   const proxy=new Mesh(mesh.geometry,mesh.material);proxy.updateMatrixWorld(true);
   if(clipped){
    if(prev?.coarseTexture&&prev.coarseKey===coarseKey){coarseTexture=prev.coarseTexture;reusedCoarse=true;}
    else{
     coarseProducer=createGpuSceneSolidProducer(device,{grid:coarseGrid});
     coarseProducer.update([{id:mesh.uuid,object:proxy}],{translate:coarseCenter.toArray(),scale:coarseGrid*coarseStep/2},{grid:coarseGrid,gridHeight:coarseGrid});
     coarseTexture=device.createTexture({label:'cached coarse ash solid '+mesh.name,size:[coarseGrid,coarseGrid,coarseGrid],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
     const ce=device.createCommandEncoder();coarseProducer.encode(ce);ce.copyTextureToTexture({texture:coarseProducer.texture},{texture:coarseTexture},[coarseGrid,coarseGrid,coarseGrid]);device.queue.submit([ce.finish()]);
    }
   }
   producer=createGpuSceneSolidProducer(device,{grid});
   const boundaryCap=clipped?{texture:coarseTexture,origin:coarseOrigin.toArray(),step:coarseStep,boundsMin:fullBounds.min.toArray(),boundsMax:fullBounds.max.toArray()}:null;
   producer.update([{id:mesh.uuid,object:proxy}],{translate:center.toArray(),scale:grid*step/2},{grid,gridHeight:grid},{boundaryCap});
   texture=device.createTexture({label:'cached local ash solid '+mesh.name,size:[grid,grid,grid],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const e=device.createCommandEncoder();producer.encode(e);e.copyTextureToTexture({texture:producer.texture},{texture},[grid,grid,grid]);device.queue.submit([e.finish()]);
   uniform=device.createBuffer({label:'ash object pose '+mesh.name,size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   if(reusedCoarse)prev.coarseTexture=null;
   const coarseBytes=coarseTexture?coarseGrid**3*4:0;
   builds++;return {...spec,texture,coarseTexture,uniform,group:group(texture,uniform),box:null,matrix:null,bytes:bytes+coarseBytes+128};
  }catch(error){texture?.destroy();if(!reusedCoarse)coarseTexture?.destroy();uniform?.destroy();throw error;}finally{coarseProducer?.destroy();producer?.destroy();}
 }
 function update(records,{checkpointIdentity=null}={}){
  const checkpoints=new Map((Array.isArray(checkpointIdentity)?checkpointIdentity:[]).map(row=>[row.key,row]));
  if(disposed)throw Error('Ash scene collision disposed');
  const meshes=new Map();
  for(const {id,object,key:objectKey=id} of records){
   const restoreBeauty=object.userData?.kaminosBeautyLodRestore?.()??null;
   try{
    object.updateWorldMatrix(true,true);object.traverse(mesh=>{
     if(!mesh.isMesh)return;for(let n=mesh;n;n=n.parent)if(!n.visible||n.userData?.kaminosEditorHelper||n.userData?.kaminosEditorOnly||n.userData?.kaminosBeautyLodProxy)return;
     meshes.set(mesh.uuid,{mesh,id,objectKey});
    });
   }finally{restoreBeauty?.();}
  }
  const dirty=pendingDirty,include=box=>{for(const i of sceneTiles(p,box))dirty.add(i);};
  for(const [key,m] of cache)if(!meshes.has(key)){include(m.box);destroy(m);cache.delete(key);}
  for(const [key,{mesh,id,objectKey}] of meshes){
   let m=cache.get(key);const spec=geometry(mesh,m,checkpoints.get(objectKey));
   if(spec.empty){if(m){include(m.box);destroy(m);cache.delete(key);}continue;}
   const matrix=mesh.matrixWorld.toArray();
   const worldBox=spec.bounds.clone().expandByScalar(spec.step).applyMatrix4(mesh.matrixWorld),boxNow={min:worldBox.min.toArray(),max:worldBox.max.toArray()};
   if(!sceneTiles(p,boxNow).length){if(m){include(m.box);destroy(m);cache.delete(key);}continue;}
   if(m?.key===spec.key&&matrix.every((v,i)=>Math.abs(v-m.matrix[i])<1e-10)){m.id=id;m.objectKey=objectKey;continue;}
   if(m)include(m.box);
   if(!m||m.key!==spec.key){const next=build(mesh,spec,m);if(m)destroy(m);m=next;cache.set(key,m);}
   m.id=id;m.objectKey=objectKey;m.name=mesh.name;m.matrix=matrix;m.step=spec.step;m.origin=spec.origin;
   // Padding includes the conservative local shell at the geometric boundary.
   m.box=boxNow;include(m.box);
   const values=new Float32Array(20);values.set(new Matrix4().copy(mesh.matrixWorld).invert().elements);values.set([...m.origin.toArray(),m.step],16);device.queue.writeBuffer(m.uniform,0,values);
   if(m.analyticBurner){const b=m.analyticBurner;device.queue.writeBuffer(m.uniform,96,new Float32Array([b.innerRadius,b.outerRadius,b.ringCount,b.grooveFraction,b.grooveDepth,b.sectorCount,b.thickness,b.rimHeight]));}
  }
  lastTiles=dirty.size;if(!dirty.size)return false;
  const packed=[dirty.size,...dirty],stamps=[];
  for(const m of cache.values()){
   const mDirty=sceneTiles(p,m.box).filter(i=>dirty.has(i));
   if(!mDirty.length)continue;
   let offset=1;
   if(mDirty.length<dirty.size){offset=packed.length;packed.push(...mDirty);}
   device.queue.writeBuffer(m.uniform,80,new Uint32Array([offset,mDirty.length,m.analyticBurner?1:0,0]));
   stamps.push({m,tiles:mDirty.length});
  }
  if(packed.length>jobsCapacity){
   jobs.destroy();jobsCapacity=Math.max(packed.length,jobsCapacity*2);
   jobs=device.createBuffer({label:'ash moved-solid tile addresses',size:jobsCapacity*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   clearGroup=group(dummy,blank);for(const m of cache.values())m.group=group(m.texture??dummy,m.uniform);
  }
  device.queue.writeBuffer(jobs,0,new Uint32Array(packed));
  const encoder=device.createCommandEncoder(),dispatch=(name,bind,tiles)=>{const pass=encoder.beginComputePass({label:'ash scene '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(...ashDispatchGrid(tiles*t.groupsPerTile,device.limits.maxComputeWorkgroupsPerDimension));pass.end();};
  dispatch('clear',clearGroup,dirty.size);
  // Recompose all overlapping members, including unchanged objects, so moving
  // or removing one object cannot erase another object's occupied cells.
  for(const {m,tiles} of stamps)dispatch('stamp',m.group,tiles);
  device.queue.submit([encoder.finish()]);dirty.clear();updates++;return true;
 }
 return {update,burnerWGSL,members:()=>[...cache.values()],read:()=>({route:'cached-local-triangle-occupancy',pendingDirtyTiles:pendingDirty.size,shapeBuilds:builds,updates,lastDirtyTiles:lastTiles,allocatedBytes:jobsCapacity*4+100+[...cache.values()].reduce((n,m)=>n+m.bytes,0),members:[...cache.values()].map(m=>({id:m.id,key:m.objectKey,name:m.name,geometry:m.identity,matrix:m.matrix,grid:m.grid}))}),dispose(){if(disposed)return;disposed=true;for(const m of cache.values())destroy(m);cache.clear();jobs.destroy();dummy.destroy();blank.destroy();}};
}
