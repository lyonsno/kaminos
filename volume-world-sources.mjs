// Finite-volume source support. Source parcels are physical volumes, never
// allocations of simulation space. Refinement changes the recipients only.
export function depositWorldSources(parcels,{dims,min,pitch},output=new Float32Array(dims.reduce((a,b)=>a*b,1)*8),offset=0){
 for(const p of parcels){
  const begin=p.lo.map((v,a)=>Math.max(0,Math.floor((v-min[a])/pitch)));
  const end=p.hi.map((v,a)=>Math.min(dims[a],Math.ceil((v-min[a])/pitch)));
  for(let z=begin[2];z<end[2];z++)for(let y=begin[1];y<end[1];y++)for(let x=begin[0];x<end[0];x++){
   const c=[x,y,z];let fraction=1;
   for(let a=0;a<3;a++){const lo=min[a]+c[a]*pitch;fraction*=Math.max(0,Math.min(lo+pitch,p.hi[a])-Math.max(lo,p.lo[a]))/pitch;}
   if(!fraction)continue;
   const i=offset+(x+dims[0]*(y+dims[1]*z))*8,q=p.rate*fraction,r=p.relax*fraction;
   output[i]+=q;output[i+1]+=q*p.fuel;output[i+2]+=q*p.heat;
   output[i+4]+=r*p.velocity[0];output[i+5]+=r*p.velocity[1];output[i+6]+=r*p.velocity[2];output[i+7]+=r;
  }
 }
 return output;
}
export function depositHierarchySources(parcels,nodes,capacity,plan){
 if(!parcels.length)return new Float32Array(8);
 const out=new Float32Array(capacity*64*8),byKey=new Map(nodes.map(n=>[n.key,n]));
 const roots=plan.materialDims.map(n=>Math.ceil(n/4));
 for(const original of parcels){
  const parcel={...original,lo:original.lo.map((v,a)=>Math.max(v,plan.min[a])),hi:original.hi.map((v,a)=>Math.min(v,plan.max[a]))};
  if(parcel.lo.some((v,a)=>v>=parcel.hi[a]))continue;
  const begin=parcel.lo.map((v,a)=>Math.max(0,Math.floor((v-plan.min[a])/(4*plan.materialPitch))));
  const end=parcel.hi.map((v,a)=>Math.min(roots[a],Math.ceil((v-plan.min[a])/(4*plan.materialPitch))));
  const visit=n=>{
   if(n.lo.some((v,a)=>v>=parcel.hi[a]||v+4*n.pitch<=parcel.lo[a]))return;
   if(n.children){for(const k of n.children)visit(byKey.get(k));return;}
   depositWorldSources([parcel],{dims:[4,4,4],min:n.lo,pitch:n.pitch},out,n.slot*64*8);
  };
  for(let z=begin[2];z<end[2];z++)for(let y=begin[1];y<end[1];y++)for(let x=begin[0];x<end[0];x++)visit(byKey.get(`0:${x}:${y}:${z}`));
 }
 return out;
}
// Birth demand precedes the asynchronous field measurements, so a cold source
// can acquire detail on its first deposition. No source receives a reserved box.
export function sourceDemandAt(node,supports,plan){
 const pitch=plan.materialPitch/2**node.level,lo=node.c.map((v,a)=>plan.min[a]+v*4*pitch),width=4*pitch;
 let thermal=0,mixing=0;
 for(const s of supports){let fraction=1;for(let a=0;a<3;a++)fraction*=Math.max(0,Math.min(lo[a]+width,s.hi[a])-Math.max(lo[a],s.lo[a]))/width;
  thermal+=fraction*s.heat;mixing+=fraction*s.fuel;
 }
 return {thermal,mixing};
}
export function createSourceAtlas(device,label){
 let texture=null,view=null,key=null,latest=null;
 return {
  upload(data){
   // Two rgba texels per recipient. A sampled texture avoids increasing the
   // world's already full storage-buffer binding count.
   const texels=Math.max(1,data.length/4),width=Math.min(device.limits.maxTextureDimension2D,Math.max(2,texels)),height=Math.ceil(texels/width);
   if(height>device.limits.maxTextureDimension2D)throw Error('Source atlas exceeds GPU texture limits');
   const next=`${width}:${height}`;
   if(next!==key){const old=texture;texture=device.createTexture({label,size:[width,height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});view=texture.createView();key=next;latest=null;if(old)queueMicrotask(()=>device.queue.onSubmittedWorkDone().then(()=>old.destroy()));}
   if(!latest||latest.length!==data.length||data.some((v,i)=>v!==latest[i])){
    const packed=new Float32Array(width*height*4);packed.set(data);
    device.queue.writeTexture({texture},packed,{bytesPerRow:width*16,rowsPerImage:height},[width,height]);latest=data.slice();
   }
   return view;
  },destroy(){texture?.destroy();texture=null;latest=null;},
 };
}
export const WORLD_SOURCE_WGSL=/* wgsl */`
@group(0) @binding(17) var flowSupply:texture_2d<f32>;
@group(0) @binding(18) var materialSupply:texture_2d<f32>;
fn supplyTexel(t:texture_2d<f32>,i:u32)->vec4<f32>{let dims=textureDimensions(t);if(i>=dims.x*dims.y){return vec4<f32>(0);}return textureLoad(t,vec2<i32>(vec2<u32>(i%dims.x,i/dims.x)),0);}
fn suppliedGas(r:Gas,s:vec4<f32>)->Gas{
 if(s.x<=0.0){return r;}
 let fraction=clamp(s.x*u.time.y,0.0,1.0);
 return Gas(mix(r.a,vec4<f32>(0,s.z/s.x,s.y/s.x,u.reactant_combustion_c.w),fraction),r.b*(1.0-fraction));
}
fn sourceDivergence(c:vec3<i32>)->f32{if(!inside(c,u.flow.xyz)||blocked(c)){return 0.0;}return supplyTexel(flowSupply,2u*idx(c,u.flow.xyz)).x;}
fn sourceMomentum(c:vec3<i32>,a:u32,prior:f32)->f32{
 var s=supplyTexel(flowSupply,2u*idx(c,u.flow.xyz)+1u)*.5;
 let n=c+axis(a);if(inside(n,u.flow.xyz)){s+=supplyTexel(flowSupply,2u*idx(n,u.flow.xyz)+1u)*.5;}
 if(s.w<=0.0){return prior;}
 let blend=1.0-pow(1.0-min(1.0,s.w),u.time.x);
 return mix(prior,s[a]/s.w,blend);
}
`;
