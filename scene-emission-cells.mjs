import {createLightingComputePipeline,prepareLightingComputePipelines} from './scene-lighting-compute.mjs';
import {spatialRegionTree} from './scene-spatial-point-regions.mjs';

// The cells are optical-source samples in the Fine coordinate frame. Fine's
// source already contains its physical handoff blend. Outside Fine, Middle
// replaces World by the camera's two-cell weight, rather than adding to it.
export function emissionRegionPlan(field,limits={}){
 if(field.exteriorGain!==undefined&&(!Number.isFinite(field.exteriorGain)||field.exteriorGain<0))throw Error('exterior emission gain must be nonnegative finite');
 const fine={texture:field.texture,dimensions:field.dimensions,localMin:field.localMin??[-1,-1,-1],localMax:field.localMax??field.dimensions.map(n=>-1+2*n/field.dimensions[0]),role:0};
 const regions=[fine];
 const world=field.exterior;
 for(const [role,r] of [[1,world],[2,world?.middle]])if(r?.emissionTexture){
  if(r.status!=='encoded'||r.generation!==field.generation||r.frame!==field.frame)throw Error('emission regions require the current source generation and frame');
  regions.push({...r,texture:r.emissionTexture,role});
 }
 let count=0;
 for(const r of regions){
  if(![r.dimensions,r.localMin,r.localMax].every(v=>Array.isArray(v)&&v.length===3)||r.dimensions.some(n=>!Number.isSafeInteger(n)||n<1)||r.localMin.some((v,a)=>!Number.isFinite(v)||!Number.isFinite(r.localMax[a])||r.localMax[a]<=v))throw Error('emission region requires finite bounds and positive dimensions');
  r.count=r.dimensions.reduce((a,b)=>a*b,1);r.offset=count;count+=r.count;
 }
 const bytes=count*32;if(!Number.isSafeInteger(bytes)||bytes>Math.min(limits.maxStorageBufferBindingSize??Infinity,limits.maxBufferSize??Infinity))throw Error('emission source cells exceed device storage capacity');
 const lo=fine.localMin.map((v,a)=>Math.min(v,...regions.filter(r=>r.role!==2).map(r=>r.localMin[a]))),hi=fine.localMax.map((v,a)=>Math.max(v,...regions.filter(r=>r.role!==2).map(r=>r.localMax[a])));
 return {regions,count,bytes,lo,hi,pitch:(fine.localMax[0]-fine.localMin[0])/fine.dimensions[0]};
}
const cache=new WeakMap();
export function createEmissionCellReducer(device,count,output,{asynchronous=false}={}){
 const tree=spatialRegionTree(count),owned=[];
 const buffer=(label,size,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({label,size,usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
 const state=buffer('all-region spatial emission tree',tree.nodes.length*64),partials=buffer('all-region emission moments',tree.nodes.length*16*48),ids=buffer('all-region emission levels',tree.nodes.length*4);
 const initial=new Float32Array(tree.nodes.length*16),words=new Uint32Array(initial.buffer);tree.nodes.forEach((n,i)=>words.set([n.left,n.right,n.budget,n.leaf],i*16+8));device.queue.writeBuffer(ids,0,new Uint32Array(tree.levels.flat()));
 const levels=tree.levels.map((_,i)=>buffer('all-region emission level '+i,64,GPUBufferUsage.UNIFORM));
 let compiled=cache.get(device);
 if(!compiled){const module=device.createShaderModule({label:'physical emission cells and spatial moments',code:EMISSION_CELLS_WGSL});compiled=Object.fromEntries(['seed','scan','finish'].map(entryPoint=>[entryPoint,createLightingComputePipeline(device,{label:'all-region emission '+entryPoint,layout:'auto',compute:{module,entryPoint}},asynchronous)]));cache.set(device,compiled);}
 let cells=null,cellCount=0,shape=null,seedRows=[],groups=null;
 return {ready:()=>prepareLightingComputePipelines(Object.values(compiled)),encode(field){
  const plan=emissionRegionPlan(field,device.limits),key=JSON.stringify([plan.regions.map(r=>[r.dimensions,r.localMin,r.localMax,r.role]),plan.lo,plan.hi]);
  if(cellCount!==plan.count){cells?.destroy();cells=device.createBuffer({label:'all physical emission cells',size:plan.bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});cellCount=plan.count;groups=null;for(const r of seedRows)r.texture=null;}
  if(shape!==key){device.queue.writeBuffer(state,0,initial);shape=key;}
  const encoder=device.createCommandEncoder({label:'all-box emission source reduction'}),fine=plan.regions[0],world=plan.regions.find(r=>r.role===1),middle=plan.regions.find(r=>r.role===2);
  plan.regions.forEach((r,i)=>{
   let row=seedRows[i];if(!row){row={params:buffer('emission cell region '+i,160,GPUBufferUsage.UNIFORM)};seedRows[i]=row;}
   const bytes=new ArrayBuffer(160),f=new Float32Array(bytes),u=new Uint32Array(bytes);
   f.set([...r.localMin,0,...r.localMax,0,...fine.localMin,0,...fine.localMax,0,...(middle?[...middle.localMin,0,...middle.localMax,2*(middle.localMax[0]-middle.localMin[0])/middle.dimensions[0]]:Array(8).fill(0))]);
   f.set([...(world?.localMin??fine.localMin),0,...(world?.localMax??fine.localMax),0],32);
   f[3]=r.role===0?field.gain:(field.exteriorGain??field.gain);
   u.set([...r.dimensions,r.offset,r.role,middle?1:0,0,0],24);device.queue.writeBuffer(row.params,0,bytes);
   if(row.texture!==r.texture){row.group=device.createBindGroup({layout:compiled.seed.get().getBindGroupLayout(0),entries:[{binding:0,resource:r.texture.createView()},{binding:1,resource:{buffer:cells}},{binding:2,resource:{buffer:row.params}}]});row.texture=r.texture;}
   const p=encoder.beginComputePass({label:'physical source ownership '+r.role});p.setPipeline(compiled.seed.get());p.setBindGroup(0,row.group);p.dispatchWorkgroups(Math.ceil(r.count/64));p.end();
  });
  if(!groups)groups=levels.map(p=>{
   const entries=[{binding:3,resource:{buffer:cells}},{binding:4,resource:{buffer:state}},{binding:5,resource:{buffer:partials}},{binding:6,resource:{buffer:p}},{binding:7,resource:{buffer:ids}},{binding:8,resource:output.createView()}];
   return [compiled.scan.get(),compiled.finish.get()].map((pipeline,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries.filter(e=>i===0?e.binding!==8:e.binding!==3)}));
  });
  let offset=0;tree.levels.forEach((level,i)=>{
   const bytes=new ArrayBuffer(64),f=new Float32Array(bytes),u=new Uint32Array(bytes);f.set([...plan.lo,0,...plan.hi,0]);u.set([offset,i,plan.count,0],8);f.set([field.gain,plan.pitch,0,0],12);device.queue.writeBuffer(levels[i],0,bytes);offset+=level.length;
   const a=encoder.beginComputePass();a.setPipeline(compiled.scan.get());a.setBindGroup(0,groups[i][0]);a.dispatchWorkgroups(16,level.length);a.end();const b=encoder.beginComputePass();b.setPipeline(compiled.finish.get());b.setBindGroup(0,groups[i][1]);b.dispatchWorkgroups(level.length);b.end();
  });device.queue.submit([encoder.finish()]);return {sourceCells:plan.count,sourceRegions:plan.regions.map(r=>({role:['fine','world','middle'][r.role],dimensions:[...r.dimensions],localMin:[...r.localMin],localMax:[...r.localMax]})),emissionBounds:{lo:plan.lo,hi:plan.hi}};
 },destroy(){cells?.destroy();for(const b of owned)b.destroy();}};
}
export const EMISSION_CELLS_WGSL=/* wgsl */`
struct Cell {energy:vec4<f32>,position:vec4<f32>}
struct Seed {lo:vec4<f32>,hi:vec4<f32>,fineLo:vec4<f32>,fineHi:vec4<f32>,middleLo:vec4<f32>,middleHi:vec4<f32>,dimsOffset:vec4<u32>,role:vec4<u32>,worldLo:vec4<f32>,worldHi:vec4<f32>}
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var<storage,read_write> outputCells:array<Cell>;
@group(0) @binding(2) var<uniform> seedParams:Seed;
@compute @workgroup_size(64)
fn seed(@builtin(global_invocation_id) id:vec3<u32>){
 let s=seedParams;let dims=s.dimsOffset.xyz;let total=dims.x*dims.y*dims.z;if(id.x>=total){return;}
 let c=vec3<u32>(id.x%dims.x,(id.x/dims.x)%dims.y,id.x/(dims.x*dims.y));let pitch=(s.hi.xyz-s.lo.xyz)/vec3<f32>(dims);var weight=0.0;var moment=vec3<f32>(0);
 for(var k=0u;k<8u;k++){
  let off=(vec3<f32>(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u))+.5)*.5;let p=s.lo.xyz+(vec3<f32>(c)+off)*pitch;var w=1.0;
  if(s.role.x>0u){if(any(p<s.worldLo.xyz)||any(p>=s.worldHi.xyz)){w=0.0;}else if(all(p>=s.fineLo.xyz)&&all(p<s.fineHi.xyz)){w=0.0;}else if(s.role.y>0u){let edge=min(p-s.middleLo.xyz,s.middleHi.xyz-p);let mid=smoothstep(0.0,s.middleHi.w,min(edge.x,min(edge.y,edge.z)));w=select(1.0-mid,mid,s.role.x==2u);}else if(s.role.x==2u){w=0.0;}}
  weight+=w*.125;moment+=p*w*.125;
 }
 let rgb=max(textureLoad(source,vec3<i32>(c),0).rgb,vec3<f32>(0))*pitch.x*pitch.y*pitch.z*weight*s.lo.w;
 let center=select(s.lo.xyz+(vec3<f32>(c)+.5)*pitch,moment/max(weight,1e-30),weight>0.0);
 outputCells[s.dimsOffset.w+id.x]=Cell(vec4<f32>(rgb,rgb.x+rgb.y+rgb.z),vec4<f32>(center,dot(pitch,pitch)/12.0));
}
struct Region {lo:vec4<f32>,hi:vec4<f32>,tree:vec4<u32>,history:vec4<f32>}
struct Moments {energy:vec4<f32>,first:vec4<f32>,second:vec4<f32>}
struct Params {lo:vec4<f32>,hi:vec4<f32>,dispatch:vec4<u32>,policy:vec4<f32>}
@group(0) @binding(3) var<storage,read> cells:array<Cell>;
@group(0) @binding(4) var<storage,read_write> regions:array<Region>;
@group(0) @binding(5) var<storage,read_write> partials:array<Moments>;
@group(0) @binding(6) var<uniform> params:Params;
@group(0) @binding(7) var<storage,read> indices:array<u32>;
@group(0) @binding(8) var pointOut:texture_storage_2d<rgba32float,write>;
var<workgroup> sums:array<Moments,64>;
@compute @workgroup_size(64)
fn scan(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let id=indices[params.dispatch.x+group.y];var r=regions[id];if(params.dispatch.y==0u){r.lo=vec4<f32>(params.lo.xyz,1);r.hi=vec4<f32>(params.hi.xyz,r.hi.w);}var m:Moments;
 for(var i=group.x*64u+lane;i<params.dispatch.z;i+=1024u){let c=cells[i];let p=c.position.xyz;if(any(p<r.lo.xyz)||any(p>=r.hi.xyz)){continue;}let rgb=c.energy.rgb*r.lo.w;let w=rgb.x+rgb.y+rgb.z;m.energy+=vec4<f32>(rgb,w);m.first+=vec4<f32>(p*w,0);m.second+=vec4<f32>((p*p+vec3<f32>(c.position.w/3.0))*w,0);}
 sums[lane]=m;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane].energy+=sums[lane+stride].energy;sums[lane].first+=sums[lane+stride].first;sums[lane].second+=sums[lane+stride].second;}workgroupBarrier();}if(lane==0u){partials[id*16u+group.x]=sums[0];}
}
@compute @workgroup_size(1)
fn finish(@builtin(workgroup_id) group:vec3<u32>){
 let id=indices[params.dispatch.x+group.x];var r=regions[id];if(params.dispatch.y==0u){r.lo=vec4<f32>(params.lo.xyz,1);r.hi=vec4<f32>(params.hi.xyz,r.hi.w);}var m:Moments;for(var i=0u;i<16u;i++){let p=partials[id*16u+i];m.energy+=p.energy;m.first+=p.first;m.second+=p.second;}
 let w=m.energy.w;let position=m.first.xyz/max(w,1e-30);let variance=max(vec3<f32>(0),m.second.xyz/max(w,1e-30)-position*position);
 if(r.tree.z==1u){textureStore(pointOut,vec2<i32>(i32(r.tree.w),0),vec4<f32>(position,variance.x+variance.y+variance.z+params.policy.y*params.policy.y*.25));textureStore(pointOut,vec2<i32>(i32(r.tree.w),1),m.energy);return;}
 var axis=3u;for(var a=0u;a<3u;a++){if(r.hi[a]-r.lo[a]>params.policy.y){if(axis==3u){axis=a;}else if(variance[a]>variance[axis]){axis=a;}}}
 var left=regions[r.tree.x];var right=regions[r.tree.y];left.lo=r.lo;right.lo=r.lo;left.hi=vec4<f32>(r.hi.xyz,left.hi.w);right.hi=vec4<f32>(r.hi.xyz,right.hi.w);
 if(axis==3u){left.lo.w*=f32(left.tree.z)/f32(r.tree.z);right.lo.w*=f32(right.tree.z)/f32(r.tree.z);}else{
  let old=u32(r.hi.w);if(r.history.y>0.0&&r.hi[old]-r.lo[old]>params.policy.y&&variance[old]*1.15>=variance[axis]){axis=old;}
  var center=(r.lo[axis]+r.hi[axis])*.5;if(w>0.0){center=position[axis];}let pad=params.policy.y*.5;var cut=clamp(floor(center/params.policy.y+.5)*params.policy.y,r.lo[axis]+pad,r.hi[axis]-pad);
  if(r.history.y>0.0&&axis==old&&abs(center-r.history.x)<=.75*params.policy.y){cut=clamp(r.history.x,r.lo[axis]+pad,r.hi[axis]-pad);}left.hi[axis]=cut;right.lo[axis]=cut;r.hi.w=f32(axis);r.history=vec4<f32>(cut,1,0,0);regions[id]=r;
 }regions[r.tree.x]=left;regions[r.tree.y]=right;
}
`;
