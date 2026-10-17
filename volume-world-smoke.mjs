import { REACTANT_COMBUSTION_WGSL, reactantCombustionUniformValues } from './volume-reactant-combustion.mjs';
import { SOOT_BURNOUT_WGSL, physicsAppearanceUniformValues } from './volume-physics-appearance.mjs';
// An independently allocated world field. Fine pressure is never read or written.
export function worldSmokePlan({flow=16,material=32,extent=3}={}) {
  if(!Number.isInteger(flow)||flow<2||!Number.isInteger(material)||material<flow||!Number.isFinite(extent)||extent<=1)throw Error('Invalid world smoke dimensions');
  return {flowDims:[flow,2*flow,flow],materialDims:[material,2*material,material],flowCells:2*flow**3,materialCells:2*material**3,flowPitch:2*extent/flow,materialPitch:2*extent/material,min:[-extent,-extent,-extent],max:[extent,3*extent,extent],fineFeedback:false};
}
export function worldSmokeMapping(plan,anchor,fine){
  for(const t of [anchor,fine])if(!t.translate?.every(Number.isFinite)||!(t.scale>0))throw Error('Invalid world smoke transform');
  const offset=fine.translate.map((v,i)=>(v-anchor.translate[i])/anchor.scale),scale=fine.scale/anchor.scale;
  return {fineToField:[...offset,scale],renderMin:plan.min.map((v,i)=>(v-offset[i])/scale),renderMax:plan.max.map((v,i)=>(v-offset[i])/scale),renderPitch:plan.materialPitch/scale};
}

export const WORLD_SMOKE_WGSL=/* wgsl */`
struct Params {
 flow:vec4<f32>, material:vec4<f32>, near:vec4<f32>, mapping:vec4<f32>,
 lo:vec4<f32>, time:vec4<f32>,
 reactant_combustion_a:vec4<f32>, reactant_combustion_b:vec4<f32>,
 reactant_combustion_c:vec4<f32>, reactant_combustion_d:vec4<f32>, emissive_physics:vec4<f32>
}
struct Gas { a:vec4<f32>, b:vec4<f32> } // soot,heat,fuel,oxygen; fresh burn,unused
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> vin:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> vout:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read> gin:array<Gas>;
@group(0) @binding(5) var<storage,read_write> gout:array<Gas>;
@group(0) @binding(6) var<storage,read> pin:array<f32>;
@group(0) @binding(7) var<storage,read_write> pout:array<f32>;
@group(0) @binding(8) var fineReaction:texture_3d<f32>;
@group(0) @binding(9) var solids:texture_3d<u32>;
@group(0) @binding(10) var optical:texture_storage_3d<rgba32float,write>;
${REACTANT_COMBUSTION_WGSL}
${SOOT_BURNOUT_WGSL}
fn idx(c:vec3<i32>,d:vec3<f32>)->u32{return u32(c.x)+u32(d.x)*(u32(c.y)+u32(d.y)*u32(c.z));}
fn inside(c:vec3<i32>,d:vec3<f32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(d));}
fn blocked(c:vec3<i32>)->bool{return inside(c,u.flow.xyz)&&textureLoad(solids,c,0).x!=0u;}
fn finePoint(p:vec3<f32>)->vec3<f32>{return (p-u.mapping.xyz)/u.mapping.w;}
fn donor(p:vec3<f32>)->bool{let q=finePoint(p);let margin=2.0/u.near.x;return all(q>=vec3<f32>(-1.0+margin))&&all(q<=vec3<f32>(1.0-margin,2.0*u.near.y/u.near.x-1.0-margin,1.0-margin));}
fn fineSlot(p:vec3<f32>,slot:u32,offset:vec3<f32>)->vec4<f32>{
 let q=(finePoint(p)+vec3<f32>(1))*u.near.x*.5-offset;let base=vec3<i32>(floor(q));let f=fract(q);var value=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),vec3<i32>(u.near.xyz)-1);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=fine[4u*idx(c,u.near.xyz)+slot]*w.x*w.y*w.z;
 }}}return value;
}
fn fineBurn(p:vec3<f32>)->vec2<f32>{
 let d=vec3<i32>(textureDimensions(fineReaction));let q=(finePoint(p)+vec3<f32>(1))*u.near.x*.5-.5;let base=vec3<i32>(floor(q));let f=fract(q);var value=vec2<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let c=clamp(base+vec3<i32>(x,y,z),vec3<i32>(0),d-1);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));value+=textureLoad(fineReaction,c,0).xy*w.x*w.y*w.z;
 }}}return value;
}
fn axis(a:u32)->vec3<i32>{var v=vec3<i32>(0);v[a]=1;return v;}
fn face(c:vec3<i32>,a:u32)->f32{
 if(blocked(c)||blocked(c+axis(a))){return 0.0;}
 return vin[idx(clamp(c,vec3<i32>(0),vec3<i32>(u.flow.xyz)-1),u.flow.xyz)][a];
}
fn velocity(p:vec3<f32>)->vec3<f32>{
 var result=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
 var offset=vec3<f32>(.5);offset[a]=1.0;let q=(p-u.lo.xyz)/u.flow.w-offset;let base=vec3<i32>(floor(q));let f=fract(q);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));result[a]+=face(base+vec3<i32>(x,y,z),a)*w.x*w.y*w.z;
 }}}
 }return result;
}
fn gasCell(c:vec3<i32>)->Gas{
 if(!inside(c,u.material.xyz)){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let p=u.lo.xyz+(vec3<f32>(c)+.5)*u.material.w;
 if(blocked(vec3<i32>(floor((p-u.lo.xyz)/u.flow.w)))){return Gas(vec4<f32>(0),vec4<f32>(0));}
 return gin[idx(c,u.material.xyz)];
}
fn gas(p:vec3<f32>)->Gas{
 let q=(p-u.lo.xyz)/u.material.w-.5;let base=vec3<i32>(floor(q));let f=fract(q);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
 let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));let v=gasCell(base+vec3<i32>(x,y,z));a+=v.a*w.x*w.y*w.z;b+=v.b*w.x*w.y*w.z;
 }}}return Gas(a,b);
}
// Voxel traversal stops characteristics at coarse solid boundaries, rather than
// allowing a long backtrace to tunnel through an obstacle.
fn clipped(p:vec3<f32>,q:vec3<f32>)->vec3<f32>{
 let a=(p-u.lo.xyz)/u.flow.w;let b=(q-u.lo.xyz)/u.flow.w;let delta=b-a;let direction=sign(delta);var c=vec3<i32>(floor(a));
 let inv=1.0/max(abs(delta),vec3<f32>(1e-12));var tmax=select(a-floor(a),floor(a)+1.0-a,delta>vec3<f32>(0))*inv;
 loop{var k=0u;if(tmax.y<tmax[k]){k=1u;}if(tmax.z<tmax[k]){k=2u;}let t=tmax[k];if(t>=1.0){break;}c[k]+=i32(direction[k]);if(blocked(c)){return mix(p,q,max(0.0,t-1e-5));}tmax[k]+=inv[k];}
 return q;
}
@compute @workgroup_size(4,4,4) fn transportFlow(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.flow.xyz)){return;}let center=u.lo.xyz+(vec3<f32>(c)+.5)*u.flow.w;var v=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
 let p=center+vec3<f32>(axis(a))*.5*u.flow.w;let back=clipped(p,p-velocity(p)*u.time.y);v[a]=velocity(back)[a];
 if(a==1u){v[a]+=gas(p).a.y*u.time.z*u.time.x;}
 if(donor(p)){var o=vec3<f32>(.5);o[a]=1;v[a]=fineSlot(p,0u,o)[a]*2.0/u.near.x*u.mapping.w;}
 if(blocked(c)||blocked(c+axis(a))){v[a]=0;}
 }vout[idx(c,u.flow.xyz)]=vec4<f32>(v,0);
}
fn divergence(c:vec3<i32>)->f32{var d=0.0;for(var a=0u;a<3u;a++){d+=face(c,a)-face(c-axis(a),a);}return d/u.flow.w;}
@compute @workgroup_size(4,4,4) fn pressure(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.flow.xyz)){return;}let i=idx(c,u.flow.xyz);if(blocked(c)){pout[i]=0;return;}
 var sum=0.0;var count=0.0;
 for(var a=0u;a<3u;a++){for(var s=-1;s<=1;s+=2){let n=c+axis(a)*s;if(blocked(n)){continue;}count+=1;if(inside(n,u.flow.xyz)){sum+=pin[idx(n,u.flow.xyz)];}}}
 pout[i]=(sum-divergence(c)*u.flow.w*u.flow.w)/max(count,1.0);
}
@compute @workgroup_size(4,4,4) fn project(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.flow.xyz)){return;}let i=idx(c,u.flow.xyz);var v=vin[i].xyz;
 for(var a=0u;a<3u;a++){let n=c+axis(a);var next=0.0;if(inside(n,u.flow.xyz)){next=pin[idx(n,u.flow.xyz)];}v[a]-=(next-pin[i])/u.flow.w;if(blocked(c)||blocked(n)){v[a]=0;}}
 vout[i]=vec4<f32>(v,0);
}
@compute @workgroup_size(4,4,4) fn transportMaterial(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.material.xyz)){return;}let i=idx(c,u.material.xyz);let p=u.lo.xyz+(vec3<f32>(c)+.5)*u.material.w;
 var r=gas(clipped(p,p-velocity(p)*u.time.y));
 if(reactantLawOn()){
   let dt=u.time.x;let w=reactantExchangeWeightFor(dt);var neighbors=vec4<f32>(0);
   for(var a=0u;a<3u;a++){let off=vec3<f32>(axis(a))*u.material.w;neighbors+=gas(clipped(p,p+off)).a+gas(clipped(p,p-off)).a;}
   r.a=max(vec4<f32>(0),r.a*(1.0-6.0*w)+neighbors*w);
   let burned=reactantBurn(r.a.z,r.a.w,r.a.y,dt);r.a=vec4<f32>((r.a.x+burned.w*u.reactant_combustion_b.z)*reactantSootSurvival(dt),burned.z*reactantCoolingSurvival(dt),burned.x,burned.y);
   r.a.x*=sootBurnoutSurvival(r.a.y,r.a.w,dt);r.b.x=burned.w/max(dt,1e-6);
 }else{r.a.x*=pow(.990,u.time.x);r.a.y*=pow(.982,u.time.x);r.b.x=0;}
 if(donor(p)){
   let m=fineSlot(p,1u,vec3<f32>(.5));let chemical=fineBurn(p);r.a=vec4<f32>(m.xyz,chemical.x);r.b=vec4<f32>(chemical.y,0,0,0);
 }
 if(blocked(vec3<i32>(floor((p-u.lo.xyz)/u.flow.w)))){r=Gas(vec4<f32>(0),vec4<f32>(0));}
 gout[i]=r;textureStore(optical,c,vec4<f32>(r.a.xyz,r.b.x));
}
`;

export function createWorldSmoke(device,plan,anchor,{solidTexture}={}){
  const b=(label,size)=>device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  for(const [dims,bytes] of [[plan.flowDims,plan.flowCells*16],[plan.materialDims,plan.materialCells*32]]){
    if(dims.some(n=>n>device.limits.maxTextureDimension3D)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('World smoke dimensions exceed device limits');
  }
  const flows=[0,1].map(i=>b('world smoke flow '+i,plan.flowCells*16)),materials=[0,1].map(i=>b('world smoke material '+i,plan.materialCells*32)),pressures=[0,1].map(i=>b('world smoke pressure '+i,plan.flowCells*4));
  const initial=new Float32Array(plan.materialCells*8);for(let i=3;i<initial.length;i+=8)initial[i]=1;for(const m of materials)device.queue.writeBuffer(m,0,initial);
  const optical=device.createTexture({label:'world smoke optical state',size:plan.materialDims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const fallback=solidTexture?null:device.createTexture({label:'world smoke empty solids',size:plan.flowDims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
  const uniform=device.createBuffer({label:'world smoke uniforms',size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const module=device.createShaderModule({label:'world smoke separate flow and material',code:WORLD_SMOKE_WGSL});
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...[1,2,3,4,5,6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[3,5,7].includes(binding)?'storage':'read-only-storage'}})),{binding:8,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},{binding:9,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'3d'}},{binding:10,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float',viewDimension:'3d'}}]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['transportFlow','pressure','project','transportMaterial'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'world smoke '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})]));
  let v=0,m=0,p=0,steps=0;const groups=new Map();let lastFine,lastReaction,lastSolid;
  const values=new Float32Array(44);
  return {optical,plan,anchor,
    encode(encoder,{fineBuffer,reactionTexture,fineDims,transform,time,reactant,physics,iterations=16,buoyancy=.002,solids=solidTexture??fallback}){
      if(!Number.isInteger(iterations)||iterations<0)throw Error('Invalid world pressure iterations');
      const mapping=worldSmokeMapping(plan,anchor,transform);
      values.set([...plan.flowDims,plan.flowPitch,...plan.materialDims,plan.materialPitch,...fineDims,0,...mapping.fineToField,...plan.min,0,time.dtScale,time.backtraceScale,buoyancy,0]);
      values.set(reactantCombustionUniformValues(reactant),24);
      // Diffusivity is in fine-local length units; scale to the anchored field.
      if(reactant?.effective?.admitted)values[27]=reactant.effective.model.exchangeDiffusivity*mapping.fineToField[3]**2/plan.materialPitch**2;
      if(physics)values.set(physicsAppearanceUniformValues(physics),40);
      device.queue.writeBuffer(uniform,0,values);
      if(lastFine!==fineBuffer||lastReaction!==reactionTexture||lastSolid!==solids){groups.clear();lastFine=fineBuffer;lastReaction=reactionTexture;lastSolid=solids;}
      const group=()=>{const key=`${v}:${m}:${p}`;if(!groups.has(key))groups.set(key,device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:uniform}},...[fineBuffer,flows[v],flows[1-v],materials[m],materials[1-m],pressures[p],pressures[1-p]].map((buffer,i)=>({binding:i+1,resource:{buffer}})),{binding:8,resource:reactionTexture.createView()},{binding:9,resource:solids.createView()},{binding:10,resource:optical.createView()}]}));return groups.get(key);};
      const run=(name,dims)=>{const pass=encoder.beginComputePass({label:'world smoke '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group());pass.dispatchWorkgroups(...dims.map(n=>Math.ceil(n/4)));pass.end();};
      run('transportFlow',plan.flowDims);v=1-v;
      for(let i=0;i<iterations;i++){run('pressure',plan.flowDims);p=1-p;}
      run('project',plan.flowDims);v=1-v;
      run('transportMaterial',plan.materialDims);m=1-m;steps++;
      return {identity:'world-smoke-one-way-v0',steps,flowDims:plan.flowDims,materialDims:plan.materialDims,anchor,pressureIterations:iterations,fineFeedback:false,materialLaw:reactant?.effective?.admitted?'reactant-v0':'passive-authored',handoff:'interior-overwrite-not-conservative-flux',collision:'coarse-resident-mask',worldAnchored:true};
    },
    destroy(){for(const x of [...flows,...materials,...pressures,uniform,optical,fallback])x?.destroy();groups.clear();}
  };
}
