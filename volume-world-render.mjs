// Camera-only optical bricks for the admitted physics material law (one global
// albedo, hence emission RGB + extinction suffice). The solver's conservative dense export stays intact.
export const WORLD_RENDER_STRIDE = 219; // three topology texels + 6^3 cells including a one-cell halo
export function worldRenderShape(capacity, limit) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isInteger(limit) || limit < 1) throw Error('Invalid World render capacity');
  const texels=capacity*WORLD_RENDER_STRIDE;
  if (!Number.isSafeInteger(texels) || texels>limit**3) throw Error('World render atlas exceeds device 3D texture capacity');
  const x=Math.min(limit,Math.ceil(Math.cbrt(texels))),y=Math.min(limit,Math.ceil(Math.sqrt(texels/x))),z=Math.ceil(texels/(x*y));
  return [x,y,z];
}
export const WORLD_RENDER_WGSL=/* wgsl */`
const WORLD_RENDER_STRIDE:u32=219u;
@group(0) @binding(40) var worldRenderAtlas:texture_3d<f32>;
fn worldAtlasTexel(index:u32)->vec4<f32>{
 let dims=textureDimensions(worldRenderAtlas);
 return textureLoad(worldRenderAtlas,vec3<i32>(i32(index%dims.x),i32((index/dims.x)%dims.y),i32(index/(dims.x*dims.y))),0);
}
fn worldResidentMaterial(p:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 let q=(p-worldRender.loPitch.xyz)/worldRender.loPitch.w;
 let dims=worldRender.atlas.yzw;
 if(any(q<vec3<f32>(0))||any(q>=dims)){return EmissiveMaterial(vec3<f32>(0),0,0);}
 let root=vec3<u32>(floor(q/4.0));let roots=vec3<u32>(ceil(dims/4.0));
 var slot=root.x+roots.x*(root.y+roots.y*root.z);
 var n=worldAtlasTexel(slot*WORLD_RENDER_STRIDE);
 loop{
  let children=worldAtlasTexel(slot*WORLD_RENDER_STRIDE+1u);
  if(children.x==0.0){break;}
  let oct=vec3<u32>(clamp(floor((q-n.xyz)/(n.w*2.0)),vec3<f32>(0),vec3<f32>(1)));
  let i=oct.x+2u*(oct.y+2u*oct.z);
  if(i<4u){slot=u32(children[i])-1u;}else{slot=u32(worldAtlasTexel(slot*WORLD_RENDER_STRIDE+2u)[i-4u])-1u;}
  n=worldAtlasTexel(slot*WORLD_RENDER_STRIDE);
 }
 let cell=clamp((q-n.xyz)/n.w+.5,vec3<f32>(0),vec3<f32>(5));let base=min(vec3<u32>(floor(cell)),vec3<u32>(4));let f=cell-vec3<f32>(base);var value=vec4<f32>(0);
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  let c=base+vec3<u32>(x,y,z);let w=select(1.0-f,f,vec3<bool>(x==1u,y==1u,z==1u));
  value+=worldAtlasTexel(slot*WORLD_RENDER_STRIDE+3u+c.x+6u*(c.y+6u*c.z))*w.x*w.y*w.z;
 }}}
 let sigma=max(value.w,0.0)*smokeVisible;let albedo=clamp(u.emissive_material.y,0.0,1.0);
 return EmissiveMaterial(max(value.rgb,vec3<f32>(0))*fireVisible,sigma*(1.0-albedo),sigma*albedo);
}
struct WorldRenderGas {a:vec4<f32>,b:vec4<f32>}
struct WorldRenderBrick {loPitch:vec4<f32>,children0:vec4<u32>,children1:vec4<u32>,info:vec4<u32>}
struct WorldRenderParams {dimsPitch:vec4<f32>,loMode:vec4<f32>,rootsCount:vec4<u32>}
@group(3) @binding(4) var<storage,read> worldRenderGas:array<WorldRenderGas>;
@group(3) @binding(5) var<storage,read> worldRenderBricks:array<WorldRenderBrick>;
@group(3) @binding(6) var<storage,read> worldRenderWork:array<u32>;
@group(3) @binding(7) var<uniform> wr:WorldRenderParams;
@group(3) @binding(8) var worldRenderOutput:texture_storage_3d<rgba32float,write>;
fn worldRenderLeaf(q:vec3<f32>)->u32{
 let root=vec3<u32>(floor(q/4.0));var slot=root.x+wr.rootsCount.x*(root.y+wr.rootsCount.y*root.z);
 loop{let n=worldRenderBricks[slot];if(n.children0.x==0xffffffffu){return slot;}
  let lo=(n.loPitch.xyz-wr.loMode.xyz)/wr.dimsPitch.w;let pitch=n.loPitch.w/wr.dimsPitch.w;
  let oct=vec3<u32>(clamp(floor((q-lo)/(pitch*2.0)),vec3<f32>(0),vec3<f32>(1)));let i=oct.x+2u*(oct.y+2u*oct.z);
  if(i<4u){slot=n.children0[i];}else{slot=n.children1[i-4u];}
 }
}
fn worldRenderRaw(q:vec3<f32>)->WorldRenderGas{
 if(any(q<vec3<f32>(0))||any(q>=wr.dimsPitch.xyz)){return WorldRenderGas(vec4<f32>(0),vec4<f32>(0));}
 if(wr.loMode.w<.5){let c=vec3<u32>(floor(q));let d=vec3<u32>(wr.dimsPitch.xyz);return worldRenderGas[c.x+d.x*(c.y+d.y*c.z)];}
 let slot=worldRenderLeaf(q);let n=worldRenderBricks[slot];let p=wr.loMode.xyz+q*wr.dimsPitch.w;
 let c=vec3<u32>(clamp(floor((p-n.loPitch.xyz)/n.loPitch.w),vec3<f32>(0),vec3<f32>(3)));
 return worldRenderGas[slot*64u+c.x+4u*(c.y+4u*c.z)];
}
fn writeWorldAtlas(index:u32,value:vec4<f32>){
 let d=textureDimensions(worldRenderOutput);
 textureStore(worldRenderOutput,vec3<i32>(i32(index%d.x),i32((index/d.x)%d.y),i32(index/(d.x*d.y))),value);
}
@compute @workgroup_size(64) fn prepareWorldRender(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) local:u32){
 seatGridShape();
 let index=group.x+group.y*groups.x;if(index>=wr.rootsCount.w){return;}
 var slot=index;var n:WorldRenderBrick;
 if(wr.loMode.w>.5){slot=worldRenderWork[index];n=worldRenderBricks[slot];n.loPitch=vec4<f32>((n.loPitch.xyz-wr.loMode.xyz)/wr.dimsPitch.w,n.loPitch.w/wr.dimsPitch.w);}
 else{let root=vec3<u32>(slot%wr.rootsCount.x,(slot/wr.rootsCount.x)%wr.rootsCount.y,slot/(wr.rootsCount.x*wr.rootsCount.y));n.loPitch=vec4<f32>(vec3<f32>(root)*4.0,1);n.children0=vec4<u32>(0xffffffffu);n.children1=n.children0;}
 let start=slot*WORLD_RENDER_STRIDE;
 if(local==0u){writeWorldAtlas(start,n.loPitch);writeWorldAtlas(start+1u,vec4<f32>(n.children0+vec4<u32>(1)));writeWorldAtlas(start+2u,vec4<f32>(n.children1+vec4<u32>(1)));}
 if(n.children0.x!=0xffffffffu){return;}
 for(var i=local;i<216u;i+=64u){
  let c=vec3<u32>(i%6u,(i/6u)%6u,i/36u);let q=n.loPitch.xyz+(vec3<f32>(c)-.5)*n.loPitch.w;
  var r:WorldRenderGas;
  if(wr.loMode.w>.5 && all(c>=vec3<u32>(1)) && all(c<=vec3<u32>(4)) && all(q<wr.dimsPitch.xyz)){
   let inner=c-vec3<u32>(1);r=worldRenderGas[slot*64u+inner.x+4u*(inner.y+4u*inner.z)];
  }else{r=worldRenderRaw(q);}
  let medium=regionSmokeMaterial(vec4<f32>(r.a.xyz,r.b.x),r.b.yzw,1,1);
  writeWorldAtlas(start+3u+i,vec4<f32>(medium.emission,medium.absorption+medium.scattering));
 }
}
`;

export function createWorldRenderField(device,module,uniformBuffer) {
 const S=GPUBufferUsage.STORAGE,D=GPUBufferUsage.COPY_DST;
 const dummy=device.createBuffer({label:'World render absent hierarchy',size:64,usage:S});
 const params=device.createBuffer({label:'World render preparation parameters',size:48,usage:GPUBufferUsage.UNIFORM|D});
 const fallback=device.createTexture({label:'World render inactive',dimension:'3d',size:[1,1,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});
 let texture=null,view=fallback.createView(),capacity=0,pipeline=null,last=null,builds=0,receipt={effective:'inactive'};
 let group0=null,empty1=null,empty2=null,group3=null,resources=[],bindings=new WeakMap();
 const retire=t=>queueMicrotask(()=>device.queue.onSubmittedWorkDone().then(()=>t.destroy()));
 return {
  get view(){return view;},
  encode(encoder,source,materialKey){
   if(!source){receipt={effective:'inactive'};last=null;return false;}
   const {plan,gas,hierarchy,steps}=source;const roots=plan.materialDims.map(n=>Math.ceil(n/4));
   const count=hierarchy?.nodeCount??roots.reduce((a,b)=>a*b,1),nextCapacity=hierarchy?.capacity??count;
   const key=JSON.stringify([steps,hierarchy?.steps,hierarchy?.revision,plan,materialKey]);
   if(last===key&&resources[0]===gas&&resources[1]===(hierarchy?.nodes??dummy))return false;
   let changed=false;
   if(capacity!==nextCapacity){
    const size=worldRenderShape(nextCapacity,device.limits.maxTextureDimension3D);
    const old=texture;texture=device.createTexture({label:'resident World optical bricks',dimension:'3d',size,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    capacity=nextCapacity;view=texture.createView();if(old)retire(old);changed=true;
   }
   if(!pipeline){
    pipeline=device.createComputePipeline({label:'prepare resident World optics',layout:'auto',compute:{module,entryPoint:'prepareWorldRender',constants:{LEAN_EMISSIVE_RAYMARCH:true}}});
    group0=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
    empty1=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[]});empty2=device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[]});
   }
   const next=[gas,hierarchy?.nodes??dummy,hierarchy?.work??dummy,texture];
   if(next.some((v,i)=>v!==resources[i])){
    if(next[1]!==resources[1]||next[2]!==resources[2]||next[3]!==resources[3])bindings=new WeakMap();
    group3=bindings.get(gas)??device.createBindGroup({layout:pipeline.getBindGroupLayout(3),entries:[...next.slice(0,3).map((buffer,i)=>({binding:4+i,resource:{buffer}})),{binding:7,resource:{buffer:params}},{binding:8,resource:view}]});bindings.set(gas,group3);resources=next;
   }
   const data=new ArrayBuffer(48);new Float32Array(data).set([...plan.materialDims,plan.materialPitch,...plan.min,hierarchy?1:0]);new Uint32Array(data).set([...roots,count],8);device.queue.writeBuffer(params,0,data);
   const pass=encoder.beginComputePass({label:'World optical brick preparation'});pass.setPipeline(pipeline);for(const [i,g] of [group0,empty1,empty2,group3].entries())pass.setBindGroup(i,g);
   const x=Math.min(count,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(count/x));pass.end();last=key;builds++;
   receipt={effective:hierarchy?'resident-leaf-optics':'dense-cell-optics',materialDims:[...plan.materialDims],sourceSteps:steps,sourceRevision:hierarchy?.revision??null,builds,capacity,nodeCount:count,leafCount:hierarchy?.leafCount??count,bytes:texture.width*texture.height*texture.depthOrArrayLayers*16,reconstruction:'linear-optical-leaf-centres-with-neighbor-halo',denseExportUnchanged:true};
   return changed;
  },
  read(){return {...receipt};},
  destroy(){texture?.destroy();fallback.destroy();params.destroy();dummy.destroy();}
 };
}
