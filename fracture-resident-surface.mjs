import * as THREE from './lib/three.webgpu.js';
import {FRACTURE_RESIDENT_HAND_WGSL,residentHandRayBytes} from './fracture-resident-hand.mjs';
import {createCoarseSurfaceMesh,packResidentFractureFaces} from './fracture-coarse-surface.mjs';

// Pose texture pattern from Sinter 6361c31ae; pointer-down reduction from the
// resident Stone 74db0d433 path. Ordinary presentation does not map GPU state.
export const FRACTURE_PRESENT_WGSL=`
struct Params{counts:vec4u,origin:vec4f}
@group(0) @binding(0) var<storage,read> positions:array<vec4f>;
@group(0) @binding(1) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(2) var<storage,read> joints:array<vec4f>;
@group(0) @binding(3) var<uniform> p:Params;
@group(0) @binding(4) var image:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var<storage,read> grip:array<vec4f>;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64) fn present(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>p.counts.x+p.counts.y){return;}
 if(i==p.counts.x+p.counts.y){var handPoint=vec4f(0);for(var cell=0u;cell<p.counts.x;cell++){let command=grip[cell*3u];if(command.x>0.0&&command.w==1.0){handPoint=vec4f(grip[cell*3u+2u].xyz+p.origin.xyz,1);break;}}textureStore(image,vec2i(0,i32(i)),handPoint);return;}
 if(i<p.counts.x){let q=normalize(rotations[i]);textureStore(image,vec2i(0,i32(i)),vec4f(rotate(q,vec3f(1,0,0)),0));textureStore(image,vec2i(1,i32(i)),vec4f(rotate(q,vec3f(0,1,0)),0));textureStore(image,vec2i(2,i32(i)),vec4f(rotate(q,vec3f(0,0,1)),0));textureStore(image,vec2i(3,i32(i)),vec4f(positions[i].xyz+p.origin.xyz,1));}
 else{let alive=bitcast<vec4u>(joints[(i-p.counts.x)*11u]).w;textureStore(image,vec2i(0,i32(i)),vec4f(f32(alive),0,0,0));}
}`;
export const FRACTURE_PICK_WGSL=`
struct Params{counts:vec4u,origin:vec4f}
struct Ray{origin:vec4f,direction:vec4f}
@group(0) @binding(0) var<storage,read> faces:array<vec4f>;
@group(0) @binding(1) var<storage,read> positions:array<vec4f>;
@group(0) @binding(2) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(3) var<storage,read> joints:array<vec4f>;
@group(0) @binding(4) var<uniform> ray:Ray;
@group(0) @binding(5) var<storage,read_write> hit:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> p:Params;
@group(0) @binding(7) var<storage,read> offsets:array<vec4f>;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn intersection(i:u32)->vec3f{
 let a0=faces[i*3u];let b0=faces[i*3u+1u];let c0=faces[i*3u+2u];let bond=u32(b0.w);
 if(bond>0u&&bitcast<vec4u>(joints[(bond-1u)*11u]).w!=0u){return vec3f(-1);}
 let cell=u32(a0.w);let q=normalize(rotations[cell]);let center=positions[cell].xyz+p.origin.xyz+offsets[cell].xyz*p.origin.w;
 let a=rotate(q,a0.xyz)+center;let b=rotate(q,b0.xyz)+center;let c=rotate(q,c0.xyz)+center;
 let e=b-a;let f=c-a;let crossRay=cross(ray.direction.xyz,f);let determinant=dot(e,crossRay);
 if(abs(determinant)<1e-12||(c0.w==0.0&&determinant<0.0)||(c0.w==1.0&&determinant>0.0)){return vec3f(-1);}
 let s=ray.origin.xyz-a;let u=dot(s,crossRay)/determinant;if(u<0.0||u>1.0){return vec3f(-1);}let crossS=cross(s,e);let v=dot(ray.direction.xyz,crossS)/determinant;if(v<0.0||u+v>1.0){return vec3f(-1);}
 return vec3f(dot(f,crossS)/determinant,u,v);
}
@compute @workgroup_size(64) fn clearHit(@builtin(global_invocation_id) id:vec3u){if(id.x==0u){atomicStore(&hit[0],0x7f800000u);atomicStore(&hit[1],0xffffffffu);atomicStore(&hit[2],0u);atomicStore(&hit[3],0u);}}
@compute @workgroup_size(64) fn nearest(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.z){return;}let x=intersection(i);if(x.x>=0.0){atomicMin(&hit[0],bitcast<u32>(x.x));}}
@compute @workgroup_size(64) fn selectFace(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=p.counts.z){return;}let x=intersection(i);if(x.x>=0.0&&bitcast<u32>(x.x)==atomicLoad(&hit[0])){atomicMin(&hit[1],i);}}
fn ordered(v:f32)->u32{let b=bitcast<u32>(v);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
@compute @workgroup_size(1) fn clearBounds(){for(var k=0u;k<3u;k++){atomicStore(&hit[k],0xffffffffu);atomicStore(&hit[k+3u],0u);}}
@compute @workgroup_size(64) fn bounds(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.counts.z){return;}let cell=u32(faces[i*3u].w);let q=normalize(rotations[cell]);let center=positions[cell].xyz+p.origin.xyz+offsets[cell].xyz*p.origin.w;
 for(var v=0u;v<3u;v++){let point=rotate(q,faces[i*3u+v].xyz)+center;for(var k=0u;k<3u;k++){let value=ordered(point[k]);atomicMin(&hit[k],value);atomicMax(&hit[k+3u],value);}}
}
@compute @workgroup_size(1) fn contact(){let face=atomicLoad(&hit[1]);if(face==0xffffffffu){return;}let x=intersection(face);atomicStore(&hit[2],bitcast<u32>(x.y));atomicStore(&hit[3],bitcast<u32>(x.z));}
`;
const materialFields=['color','map','normalMap','normalScale','normalMapType','flatShading','bumpMap','bumpScale','roughness','roughnessMap','metalness','metalnessMap','aoMap','aoMapIntensity','emissive','emissiveMap','emissiveIntensity','side','alphaMap','alphaTest','opacity','transparent'];
export async function createResidentFractureSurface({renderer,prepared,materials,model,partOffsets}){
 const {device,positions,quaternions,joints,origin}=model.resident,n=prepared.cells.length,m=prepared.bonds.length,owned=[],meshes=[],copies=[];
 const packed=packResidentFractureFaces(prepared,materials);let wrapper,handMarker,disposed=false,pickTask=null,boundsTask=null,pickCount=0,boundsCount=0,handGeneration=0,handActive=false;
 const allocate=(label,data,usage)=>{const b=device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 async function dispose(){if(disposed)return;disposed=true;await Promise.allSettled([pickTask,boundsTask]);for(const mesh of meshes){mesh.removeFromParent();mesh.geometry.dispose();}if(handMarker){handMarker.removeFromParent();handMarker.geometry.dispose();handMarker.material.dispose();}for(const material of copies)material.dispose();if(wrapper){delete renderer.backend.get(wrapper).texture;wrapper.dispose();}for(const resource of owned)resource.destroy();}
 try{
  const parameterBytes=new ArrayBuffer(32);new Uint32Array(parameterBytes).set([n,m,packed.owners.length,0]);new Float32Array(parameterBytes).set([...origin,0],4);
  const parameters=allocate('Resident fracture identity',new Uint8Array(parameterBytes),GPUBufferUsage.UNIFORM),faceBuffer=allocate('Fracture original local triangles and ownership',packed.faces,GPUBufferUsage.STORAGE),ray=allocate('Pointer-down ray',new Float32Array(8),GPUBufferUsage.UNIFORM),hit=allocate('Pointer-down contact only',new Uint32Array(6),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),offsetBuffer=allocate('Part inspection offsets',new Float32Array(partOffsets.flatMap((v,i)=>[...v,prepared.cells[i].pinned?1:0])),GPUBufferUsage.STORAGE),boundsBuffer=allocate('Frame object bounds',new Uint32Array(6),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const image=device.createTexture({label:'Fracture resident pose and cap liveness',size:[4,n+m+1],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});owned.push(image);
  wrapper=new THREE.ExternalTexture(image);wrapper.type=THREE.FloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.NearestFilter;
  const compile=async code=>{const module=device.createShaderModule({code});const info=await module.getCompilationInfo();if(info.messages.some(x=>x.type==='error'))throw Error(info.messages.map(x=>x.message).join('\n'));return module;};
  const grip=model.resident.grip??allocate('Inactive presentation hand',new Float32Array(n*12),GPUBufferUsage.STORAGE);
  const presentPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:await compile(FRACTURE_PRESENT_WGSL),entryPoint:'present'}}),presentGroup=device.createBindGroup({layout:presentPipeline.getBindGroupLayout(0),entries:[positions,quaternions,joints,parameters].map((buffer,binding)=>({binding,resource:{buffer}})).concat([{binding:4,resource:image.createView()},{binding:5,resource:{buffer:grip}}])});
  const pickLayout=device.createBindGroupLayout({entries:Array.from({length:8},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[4,6].includes(binding)?'uniform':binding===5?'storage':'read-only-storage'}}))}),layout=device.createPipelineLayout({bindGroupLayouts:[pickLayout]}),pickModule=await compile(FRACTURE_PICK_WGSL),pipelines={};
  for(const entryPoint of ['clearHit','nearest','selectFace','contact','clearBounds','bounds'])pipelines[entryPoint]=await device.createComputePipelineAsync({layout,compute:{module:pickModule,entryPoint}});
  const pickGroup=device.createBindGroup({layout:pickLayout,entries:[faceBuffer,positions,quaternions,joints,ray,hit,parameters,offsetBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const boundsGroup=device.createBindGroup({layout:pickLayout,entries:[faceBuffer,positions,quaternions,joints,ray,boundsBuffer,parameters,offsetBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
  let handGroup,handRay,handPipelines;
  if(model.resident.grip){
   handRay=allocate('Resident pointer intent',new Float32Array(12),GPUBufferUsage.UNIFORM);
   const handState=allocate('Resident hand contact and plane',new Float32Array(8),GPUBufferUsage.STORAGE);
   const entries=Array.from({length:11},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[4,6,10].includes(binding)?'uniform':[5,8,9].includes(binding)?'storage':'read-only-storage'}}));
   const handLayout=device.createBindGroupLayout({entries}),handPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[handLayout]}),module=await compile(FRACTURE_PICK_WGSL+FRACTURE_RESIDENT_HAND_WGSL);
   handPipelines={};for(const entryPoint of ['clearHand','clearHit','nearest','selectFace','startHand','moveHand'])handPipelines[entryPoint]=await device.createComputePipelineAsync({layout:handPipelineLayout,compute:{module,entryPoint}});
   handGroup=device.createBindGroup({layout:handLayout,entries:[faceBuffer,positions,quaternions,joints,ray,hit,parameters,offsetBuffer,model.resident.grip,handState,handRay].map((buffer,binding)=>({binding,resource:{buffer}}))});
  }
  function submitHand(names){const encoder=device.createCommandEncoder();for(const name of names){const pass=encoder.beginComputePass();pass.setPipeline(handPipelines[name]);pass.setBindGroup(0,handGroup);pass.dispatchWorkgroups(name==='clearHand'?Math.ceil(n/64):['nearest','selectFace'].includes(name)?Math.ceil(packed.owners.length/64):1);pass.end();}device.queue.submit([encoder.finish()]);}
  function beginHand(value){if(disposed||!handGroup)throw Error('Resident hand unavailable');const bytes=residentHandRayBytes(value,++handGeneration);model.beginResidentHand();device.queue.writeBuffer(ray,0,bytes.subarray(0,8));device.queue.writeBuffer(handRay,0,bytes);submitHand(['clearHand','clearHit','nearest','selectFace','startHand']);handActive=true;}
  function moveHand(value){if(disposed||!handActive)return;device.queue.writeBuffer(handRay,0,residentHandRayBytes(value,handGeneration));submitHand(['moveHand']);}
  function endHand(){handActive=false;model.release();}
  const {textureLoad,ivec2,int,attribute,uniform,mat4,mat3,vec3,vec4,positionGeometry,normalGeometry,normalLocal,Fn,texture,materialReference,negateOnBackSide,transformNormalToView}=THREE.TSL;
  const separation=uniform(0);
  const target=textureLoad(wrapper,ivec2(0,n+m));
  const markerMaterial=new THREE.MeshBasicNodeMaterial({color:0xe59b3a,depthTest:false});
  markerMaterial.positionNode=positionGeometry.add(target.xyz);markerMaterial.maskNode=target.w.greaterThan(.5);
  const sourceBounds=new THREE.Box3();for(const piece of prepared.pieces)sourceBounds.union(new THREE.Box3().setFromArray(piece.arrays.positions));
  handMarker=new THREE.Mesh(new THREE.SphereGeometry(sourceBounds.getSize(new THREE.Vector3()).length()*.006,12,8),markerMaterial);
  handMarker.name='Resident hand target';handMarker.frustumCulled=false;handMarker.renderOrder=10;handMarker.raycast=()=>{};

  const meta=attribute('fractureCap','vec4'),part=attribute('fractureTint','vec4'),cap=meta.x.toInt(),cell=meta.y.toInt();
  const pose=mat4(...[0,1,2,3].map(col=>textureLoad(wrapper,ivec2(col,cell))));
  const alive=textureLoad(wrapper,ivec2(0,cap.sub(1).max(0).add(n))).x,offset=vec3(meta.z,meta.w,part.x);
  const make=(source,tint)=>{const material=new THREE.MeshStandardNodeMaterial();for(const k of materialFields)if(source[k]!==undefined)material[k]=source[k]?.clone&&!source[k].isTexture?source[k].clone():source[k];if(tint){material.color.set(0xffffff);material.colorNode=part.yzw;material.map=null;material.metalness=0;material.roughness=.9;}
   material.positionNode=Fn(()=>{normalLocal.assign(mat3(pose).mul(normalGeometry));return pose.mul(vec4(positionGeometry,1)).xyz.add(offset.mul(separation));})();
   // Leave tangent-space maps, derivative tangents, flat shading and back-face
   // inversion on the renderer's ordinary material normal path.
   if(material.normalMap&&material.normalMapType===THREE.ObjectSpaceNormalMap){const mapped=texture(material.normalMap).xyz.mul(2).sub(1);material.normalNode=Fn((_,builder)=>{const scale=materialReference('normalScale','vec2');return transformNormalToView(mat3(pose).mul(vec3(mapped.xy.mul(builder.isFlatShading()?negateOnBackSide(scale):scale),mapped.z)));})();}material.maskNode=cap.equal(int(0)).or(alive.lessThan(.5));copies.push(material);return material;};
  const original=materials.map(x=>make(x,false)),tinted=materials.map((x,i)=>make(x,i!==prepared.capMaterial));
  for(const piece of prepared.pieces){
   const color=new THREE.Color().setHSL((piece.part*.61803398875)%1,.5,.6),[ox,oy,oz]=partOffsets[piece.index];
   const mesh=createCoarseSurfaceMesh(piece.arrays,original,piece.center),old=mesh.geometry;mesh.geometry=old.toNonIndexed();old.dispose();mesh.position.set(0,0,0);mesh.frustumCulled=false;
   const faces=piece.faceInterfaces.length,capData=new Float32Array(faces*12),tintData=new Float32Array(faces*12);
   for(let f=0;f<faces;f++){
    const c=piece.faceInterfaces[f]?piece.faceBonds[f]+1:0,base=f*12;
    for(let v=0;v<3;v++){
     const k=base+v*4;
     capData[k]=c;capData[k+1]=piece.index;capData[k+2]=ox;capData[k+3]=oy;
     tintData[k]=oz;tintData[k+1]=color.r;tintData[k+2]=color.g;tintData[k+3]=color.b;
    }
   }
   mesh.geometry.setAttribute('fractureCap',new THREE.Float32BufferAttribute(capData,4));
   mesh.geometry.setAttribute('fractureTint',new THREE.Float32BufferAttribute(tintData,4));
   // Raycasting this rest geometry would lie after the first physical step.
   mesh.raycast=()=>{};mesh.userData.materialCell=piece.index;mesh.userData.original=original;mesh.userData.tinted=tinted;mesh.name=`Material ${piece.index+1} · part ${piece.part+1}`;meshes.push(mesh);
  }
  function present(){if(disposed)throw Error('Resident surface disposed');const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(presentPipeline);pass.setBindGroup(0,presentGroup);pass.dispatchWorkgroups(Math.ceil((n+m+1)/64));pass.end();device.queue.submit([encoder.finish()]);}
  async function pick(origin,direction){
   if(disposed||pickTask)throw Error('Resident picker unavailable');if(![origin,direction].every(v=>v.length===3&&v.every(Number.isFinite))||Math.abs(Math.hypot(...direction)-1)>1e-5)throw Error('Finite unit ray required');
   pickTask=(async()=>{const read=device.createBuffer({label:'Pointer-down contact result',size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{device.queue.writeBuffer(ray,0,new Float32Array([...origin,0,...direction,0]));const encoder=device.createCommandEncoder();for(const name of ['clearHit','nearest','selectFace','contact']){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,pickGroup);pass.dispatchWorkgroups(['clearHit','contact'].includes(name)?1:Math.ceil(packed.owners.length/64));pass.end();}encoder.copyBufferToBuffer(hit,0,read,0,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);pickCount++;const data=read.getMappedRange(),u=new Uint32Array(data),f=new Float32Array(data);if(u[1]===0xffffffff||disposed)return null;const face=packed.owners[u[1]],a=face.points[0],b=face.points[1],c=face.points[2],localPoint=a.map((x,k)=>x+(b[k]-x)*f[2]+(c[k]-x)*f[3]);return{cell:face.cell,faceIndex:face.face,distance:f[0],point:origin.map((x,k)=>x+direction[k]*f[0]),localPoint,normal:new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a))).normalize().toArray(),readbackBytes:16};}finally{read.destroy();}})();try{return await pickTask;}finally{pickTask=null;}
  }
  async function bounds(){
   if(disposed)throw Error('Resident surface disposed');if(boundsTask)return boundsTask;
   boundsTask=(async()=>{const read=device.createBuffer({label:'Frame object bounds result',size:24,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();for(const name of ['clearBounds','bounds']){const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,boundsGroup);pass.dispatchWorkgroups(name==='clearBounds'?1:Math.ceil(packed.owners.length/64));pass.end();}encoder.copyBufferToBuffer(boundsBuffer,0,read,0,24);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);boundsCount++;const u=new Uint32Array(read.getMappedRange()),b=new Uint32Array(6);for(let k=0;k<6;k++)b[k]=(u[k]&0x80000000)?u[k]^0x80000000:~u[k];return Array.from(new Float32Array(b.buffer));}finally{read.destroy();}})();try{return await boundsTask;}finally{boundsTask=null;}
  }
  present();return{meshes,handMarker,present,pick,bounds,beginHand,moveHand,endHand,setSeparation:value=>{if(separation.value===value)return;separation.value=value;device.queue.writeBuffer(parameters,28,new Float32Array([value]));},read:()=>({route:'resident-fracture-surface-v1',pose:'gpu',capVisibility:'gpu-bond-liveness',ordinaryStateReadbacks:0,handSelection:'gpu',handIntentActive:handActive,pickQueries:pickCount,pickPending:pickTask!==null,pickReadbackBytes:pickCount*16,boundsQueries:boundsCount,boundsReadbackBytes:boundsCount*24}),dispose};
 }catch(error){await dispose();throw error;}
}
