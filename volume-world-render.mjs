// Camera-only optical bricks for the smoke-only coarse World medium (one global
// albedo, hence scalar extinction suffices). Four 2x subcell extinctions pack per rgba32float texel.
export const WORLD_RENDER_STRIDE = 253; // three topology texels + 250 packed 4-subcell extinction texels (10^3 2x subcells)
export function worldRenderShape(capacity, limit) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isInteger(limit) || limit < 1) throw Error('Invalid World render capacity');
  const texels=capacity*WORLD_RENDER_STRIDE;
  if (!Number.isSafeInteger(texels) || texels>limit**3) throw Error('World render atlas exceeds device 3D texture capacity');
  const x=Math.min(limit,Math.ceil(Math.cbrt(texels))),y=Math.min(limit,Math.ceil(Math.sqrt(texels/x))),z=Math.ceil(texels/(x*y));
  return [x,y,z];
}
export const WORLD_RENDER_WGSL=/* wgsl */`
const WORLD_RENDER_STRIDE:u32=253u;
@group(0) @binding(40) var worldRenderAtlas:texture_3d<f32>;
fn worldAtlasTexel(index:u32)->vec4<f32>{
 let dims=textureDimensions(worldRenderAtlas);
 return textureLoad(worldRenderAtlas,vec3<i32>(i32(index%dims.x),i32((index/dims.x)%dims.y),i32(index/(dims.x*dims.y))),0);
}
fn worldResidentLeafBounds(p:vec3<f32>,brickLoPitch:ptr<function,vec4<f32>>)->vec4<f32>{
 let q=(p-worldRender.loPitch.xyz)/worldRender.loPitch.w;
 let dims=worldRender.atlas.yzw;
 if(any(q<vec3<f32>(0))||any(q>=dims)){*brickLoPitch=vec4<f32>(0);return vec4<f32>(0);}
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
 *brickLoPitch=n;
 return worldAtlasTexel(slot*WORLD_RENDER_STRIDE+2u);
}
fn worldLeafExitDistance(p:vec3<f32>,rd:vec3<f32>,n:vec4<f32>)->f32{
 let lo=worldRender.loPitch.xyz+n.xyz*worldRender.loPitch.w;
 let span=4.0*n.w*worldRender.loPitch.w;
 let hi=lo+vec3<f32>(span);
 var best=1.0e6;
 if(abs(rd.x)>1e-4){let tx=(select(lo.x,hi.x,rd.x>0.0)-p.x)/rd.x;best=min(best,max(0.0,tx));}
 if(abs(rd.y)>1e-4){let ty=(select(lo.y,hi.y,rd.y>0.0)-p.y)/rd.y;best=min(best,max(0.0,ty));}
 if(abs(rd.z)>1e-4){let tz=(select(lo.z,hi.z,rd.z>0.0)-p.z)/rd.z;best=min(best,max(0.0,tz));}
 return min(best,span*1.75);
}
var<private> lastWorldLeafNode:vec4<f32>;
var<private> lastWorldLeafBounds:vec4<f32>;
fn worldResidentMaterial(p:vec3<f32>,smokeVisible:f32,fireVisible:f32)->EmissiveMaterial{
 lastWorldLeafNode=vec4<f32>(0);lastWorldLeafBounds=vec4<f32>(0);
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
 let leafBounds=worldAtlasTexel(slot*WORLD_RENDER_STRIDE+2u);
 lastWorldLeafNode=n;lastWorldLeafBounds=leafBounds;
 if(leafBounds.w>0.5&&leafBounds.z<=1e-4){return EmissiveMaterial(vec3<f32>(0),0,0);}
 let cell=clamp((q-n.xyz)/(n.w*0.5)+.5,vec3<f32>(0),vec3<f32>(9));let base=min(vec3<u32>(floor(cell)),vec3<u32>(8));let f=cell-vec3<f32>(base);var sigmaRaw=0.0;
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){
  let row=10u*((base.y+y)+10u*(base.z+z))+base.x;
  let lane0=row&3u;
  let tex0=worldAtlasTexel(slot*WORLD_RENDER_STRIDE+3u+(row>>2u));
  var s1=0.0;
  if(lane0<3u){s1=tex0[lane0+1u];}else{s1=worldAtlasTexel(slot*WORLD_RENDER_STRIDE+4u+(row>>2u)).x;}
  let wy=select(1.0-f.y,f.y,y==1u)*select(1.0-f.z,f.z,z==1u);
  sigmaRaw+=mix(tex0[lane0],s1,f.x)*wy;
 }}
 let _unused=fireVisible;
 let sigma=max(sigmaRaw,0.0)*smokeVisible;let albedo=clamp(u.emissive_material.y,0.0,1.0);
 return EmissiveMaterial(vec3<f32>(0),sigma*(1.0-albedo),sigma*albedo);
}
struct WorldRenderGas {a:vec4<f32>,b:vec4<f32>}
struct WorldRenderBrick {loPitch:vec4<f32>,children0:vec4<u32>,children1:vec4<u32>,info:vec4<u32>}
struct WorldRenderParams {dimsPitch:vec4<f32>,loMode:vec4<f32>,rootsCount:vec4<u32>}
@group(3) @binding(4) var<storage,read> worldRenderGas:array<WorldRenderGas>;
@group(3) @binding(5) var<storage,read> worldRenderBricks:array<WorldRenderBrick>;
@group(3) @binding(6) var<storage,read> worldRenderWork:array<u32>;
@group(3) @binding(7) var<uniform> wr:WorldRenderParams;
@group(3) @binding(8) var worldRenderOutput:texture_storage_3d<rgba32float,write>;
fn worldRenderHash31(p:vec3<f32>)->f32{
 var p3=fract(p*vec3<f32>(0.1031,0.1030,0.0973));
 p3+=dot(p3,p3.yxz+33.33);
 return fract((p3.x+p3.y)*p3.z);
}
fn worldRenderHash33(p:vec3<f32>)->vec3<f32>{
 var p3=fract(p*vec3<f32>(0.1031,0.1030,0.0973));
 p3+=dot(p3,p3.yxz+33.33);
 return fract((p3.xxy+p3.yxx)*p3.zyx);
}
fn worldRenderSubgridNoise(x:vec3<f32>)->f32{
 let i=floor(x);let f=fract(x);let u=f*f*(3.0-2.0*f);
 let n000=worldRenderHash31(i+vec3<f32>(0,0,0));let n100=worldRenderHash31(i+vec3<f32>(1,0,0));
 let n010=worldRenderHash31(i+vec3<f32>(0,1,0));let n110=worldRenderHash31(i+vec3<f32>(1,1,0));
 let n001=worldRenderHash31(i+vec3<f32>(0,0,1));let n101=worldRenderHash31(i+vec3<f32>(1,0,1));
 let n011=worldRenderHash31(i+vec3<f32>(0,1,1));let n111=worldRenderHash31(i+vec3<f32>(1,1,1));
 return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
fn worldRenderSubgridNoise3(x:vec3<f32>)->vec3<f32>{
 let i=floor(x);let f=fract(x);let u=f*f*(3.0-2.0*f);
 let n000=worldRenderHash33(i+vec3<f32>(0,0,0));let n100=worldRenderHash33(i+vec3<f32>(1,0,0));
 let n010=worldRenderHash33(i+vec3<f32>(0,1,0));let n110=worldRenderHash33(i+vec3<f32>(1,1,0));
 let n001=worldRenderHash33(i+vec3<f32>(0,0,1));let n101=worldRenderHash33(i+vec3<f32>(1,0,1));
 let n011=worldRenderHash33(i+vec3<f32>(0,1,1));let n111=worldRenderHash33(i+vec3<f32>(1,1,1));
 return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
fn worldSubgridWarpGrid(g:vec3<f32>,stepScale:f32)->vec3<f32>{
 let s=clamp(stepScale,0.125,2.0);
 let q=vec3<f32>(g.x*0.85,g.y*0.65,g.z*0.85);
 let w1=worldRenderSubgridNoise3(q+vec3<f32>(1.3,2.7,4.1))-vec3<f32>(0.5);
 let w2=worldRenderSubgridNoise3(q*2.15+vec3<f32>(2.1,-1.4,3.3))-vec3<f32>(0.5);
 return (0.65*w1+0.35*w2)*s*0.65;
}
fn worldSubgridClumpGrid(g:vec3<f32>,sigma:f32)->f32{
 if(wr.loMode.w<1.5||sigma<=0.0){return 1.0;}
 let q=vec3<f32>(g.x*1.05,g.y*0.78,g.z*1.05);
 let n1=worldRenderSubgridNoise(q);
 let n2=worldRenderSubgridNoise(q*vec3<f32>(2.15,2.05,2.15)+vec3<f32>(1.7,-0.9,2.3));
 let billow=smoothstep(0.18,0.84,0.62*n1+0.38*n2);
 let strength=smoothstep(0.02,0.85,sigma);
 return mix(1.0,0.45+0.95*billow,strength);
}
fn worldRenderHasHierarchy()->bool{return (u32(wr.loMode.w)&1u)!=0u;}
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
 if(!worldRenderHasHierarchy()){let c=vec3<u32>(floor(q));let d=vec3<u32>(wr.dimsPitch.xyz);return worldRenderGas[c.x+d.x*(c.y+d.y*c.z)];}
 let slot=worldRenderLeaf(q);let n=worldRenderBricks[slot];let p=wr.loMode.xyz+q*wr.dimsPitch.w;
 let c=vec3<u32>(clamp(floor((p-n.loPitch.xyz)/n.loPitch.w),vec3<f32>(0),vec3<f32>(3)));
 return worldRenderGas[slot*64u+c.x+4u*(c.y+4u*c.z)];
}
fn worldRenderCellAt(slot:u32,n:WorldRenderBrick,sampleQ:vec3<f32>)->WorldRenderGas{
 if(worldRenderHasHierarchy()){
  let localCell=floor((sampleQ-n.loPitch.xyz)/n.loPitch.w);
  if(all(localCell>=vec3<f32>(0))&&all(localCell<vec3<f32>(4))&&all(sampleQ>=vec3<f32>(0))&&all(sampleQ<wr.dimsPitch.xyz)){
   let ic=vec3<u32>(localCell);
   return worldRenderGas[slot*64u+ic.x+4u*(ic.y+4u*ic.z)];
  }
 }
 return worldRenderRaw(sampleQ);
}
fn worldRenderSampleGas(slot:u32,n:WorldRenderBrick,qw:vec3<f32>)->WorldRenderGas{
 let step=max(n.loPitch.w,1e-4);
 let coord=(qw-n.loPitch.xyz)/step-vec3<f32>(0.5);
 let base=floor(coord);
 let f=fract(coord);
 let w3=smoothstep(vec3<f32>(0.18),vec3<f32>(0.82),f);
 var soot=0.0;
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  let corner=base+vec3<f32>(f32(x),f32(y),f32(z));
  let sampleQ=n.loPitch.xyz+(corner+vec3<f32>(0.5))*step;
  let g=worldRenderCellAt(slot,n,sampleQ);
  let w=select(1.0-w3.x,w3.x,x==1u)*select(1.0-w3.y,w3.y,y==1u)*select(1.0-w3.z,w3.z,z==1u);
  soot+=g.a.x*w;
 }}}
 return WorldRenderGas(vec4<f32>(soot,0,0,0),vec4<f32>(0));
}
fn writeWorldAtlas(index:u32,value:vec4<f32>){
 let d=textureDimensions(worldRenderOutput);
 textureStore(worldRenderOutput,vec3<i32>(i32(index%d.x),i32((index/d.x)%d.y),i32(index/(d.x*d.y))),value);
}
var<workgroup> worldBrickMax:array<vec2<f32>,64>;
@compute @workgroup_size(64) fn prepareWorldRender(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) local:u32){
 seatGridShape();
 let index=group.x+group.y*groups.x;let valid=index<wr.rootsCount.w;
 var slot=0u;var n:WorldRenderBrick;n.children0=vec4<u32>(0u);
 if(valid){
  slot=index;
  if(worldRenderHasHierarchy()){slot=worldRenderWork[index];n=worldRenderBricks[slot];n.loPitch=vec4<f32>((n.loPitch.xyz-wr.loMode.xyz)/wr.dimsPitch.w,n.loPitch.w/wr.dimsPitch.w);}
  else{let root=vec3<u32>(slot%wr.rootsCount.x,(slot/wr.rootsCount.x)%wr.rootsCount.y,slot/(wr.rootsCount.x*wr.rootsCount.y));n.loPitch=vec4<f32>(vec3<f32>(root)*4.0,1);n.children0=vec4<u32>(0xffffffffu);n.children1=n.children0;}
 }
 let start=slot*WORLD_RENDER_STRIDE;let isLeaf=valid&&n.children0.x==0xffffffffu;
 if(valid&&!isLeaf&&local==0u){writeWorldAtlas(start,n.loPitch);writeWorldAtlas(start+1u,vec4<f32>(n.children0+vec4<u32>(1)));writeWorldAtlas(start+2u,vec4<f32>(n.children1+vec4<u32>(1)));}
 var maxOptics=vec2<f32>(0);
 if(isLeaf){
  for(var t=local;t<250u;t+=64u){
   var packed=vec4<f32>(0);
   for(var lane=0u;lane<4u;lane++){
    let i=4u*t+lane;
    let c=vec3<u32>(i%10u,(i/10u)%10u,i/100u);let q=n.loPitch.xyz+(vec3<f32>(c)-.5)*(n.loPitch.w*0.5);
    var r=worldRenderCellAt(slot,n,q);
    if(wr.loMode.w>=1.5){
     r=worldRenderSampleGas(slot,n,q+worldSubgridWarpGrid(q,n.loPitch.w));
    }
    let medium=regionSmokeMaterial(vec4<f32>(r.a.x,0,0,0),vec3<f32>(0),1,0);
    let sigma=(medium.absorption+medium.scattering)*worldSubgridClumpGrid(q,medium.absorption+medium.scattering);
    packed[lane]=sigma;
    maxOptics=max(maxOptics,vec2<f32>(0.0,sigma));
   }
   writeWorldAtlas(start+3u+t,packed);
  }
 }
 worldBrickMax[local]=maxOptics;workgroupBarrier();
 for(var s=32u;s>0u;s>>=1u){if(local<s){worldBrickMax[local]=max(worldBrickMax[local],worldBrickMax[local+s]);}workgroupBarrier();}
 if(isLeaf&&local==0u){let m=worldBrickMax[0];writeWorldAtlas(start,n.loPitch);writeWorldAtlas(start+1u,vec4<f32>(0));writeWorldAtlas(start+2u,vec4<f32>(m.x,m.y,max(m.x,m.y),1));}
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
   const mode=(hierarchy?1:0)+(materialKey?.length>29&&materialKey[29]>.5?2:0);
   const data=new ArrayBuffer(48);new Float32Array(data).set([...plan.materialDims,plan.materialPitch,...plan.min,mode]);new Uint32Array(data).set([...roots,count],8);device.queue.writeBuffer(params,0,data);
   const pass=encoder.beginComputePass({label:'World optical brick preparation'});pass.setPipeline(pipeline);for(const [i,g] of [group0,empty1,empty2,group3].entries())pass.setBindGroup(i,g);
   const x=Math.min(count,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(count/x));pass.end();last=key;builds++;
   receipt={effective:hierarchy?'resident-leaf-optics':'dense-cell-optics',materialDims:[...plan.materialDims],sourceSteps:steps,sourceRevision:hierarchy?.revision??null,builds,capacity,nodeCount:count,leafCount:hierarchy?.leafCount??count,bytes:texture.width*texture.height*texture.depthOrArrayLayers*16,reconstruction:'linear-optical-leaf-centres-with-neighbor-halo',denseExportUnchanged:true};
   return changed;
  },
  read(){return {...receipt};},
  destroy(){texture?.destroy();fallback.destroy();params.destroy();dummy.destroy();}
 };
}
