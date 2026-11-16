import {PARTICLE_BUFFER_ABI_WGSL,PARTICLE_FINE_VELOCITY_WGSL} from './volume-optical-particles.mjs';
import {createPacketBundleTransport,finitePacketBundle} from './volume-packet-bundle.mjs';

export function residentBeamPlan({width,sections,stride}){
 if(![width,sections,stride].every(v=>Number.isSafeInteger(v)&&v>0)||stride%2!==1||width%stride)throw Error('Beam width must be divisible by a positive odd stride');
 const side=width/stride,retainedRays=side**2,receiverRays=width**2,sampleCount=retainedRays*sections,points=receiverRays*sections,bins=(side+2)**2*(sections+2);
 if(![retainedRays,receiverRays,sampleCount,points,bins].every(n=>Number.isSafeInteger(n)&&n<=0x7fffffff))throw Error('Resident beam exceeds addressable capacity');
 return {width,sections,stride,side,retainedRays,receiverRays,sampleCount,points,bins};
}
export function residentBeamRefresh({side,retainedRays,stride},schedule){
 if(!Number.isSafeInteger(schedule)||schedule<0)throw Error('Invalid refresh schedule');
 const slot=schedule%retainedRays,offset=(stride-1)/2;
 return {slot,x:slot%side*stride+offset,y:Math.floor(slot/side)*stride+offset};
}

export const PARTICLE_RESIDENT_BEAM_WGSL=/* wgsl */`
${PARTICLE_BUFFER_ABI_WGSL}
struct Beam {origin:vec4<f32>, forward:vec4<f32>, right:vec4<f32>, up:vec4<f32>, schedule:vec4<u32>, gain:vec4<f32>}
struct Sample {position:vec4<f32>, emission:vec4<f32>}
@group(0) @binding(0) var<uniform> beam:Beam;
@group(0) @binding(1) var<storage,read_write> samples:array<Sample>;
@group(0) @binding(2) var<storage,read_write> tau:array<f32>;
@group(0) @binding(3) var atlas:texture_2d<f32>;
@group(0) @binding(4) var<storage,read> fine:array<vec4<f32>>;
@group(0) @binding(5) var<uniform> source:SourceOptions;
@group(0) @binding(6) var<uniform> u:Options;
@group(0) @binding(7) var<storage,read_write> heads:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> links:array<u32>;
@group(0) @binding(9) var<storage,read_write> held:array<vec4<f32>>;
@group(0) @binding(10) var<storage,read_write> advected:array<vec4<f32>>;
${PARTICLE_FINE_VELOCITY_WGSL}
fn cells()->u32{return u32(beam.right.w);}
fn layers()->u32{return u32(beam.up.w);}
fn stride()->u32{return beam.schedule.x;}
fn side()->u32{return cells()/stride();}
fn nominal(ray:u32,z:u32)->vec3<f32>{
 let offset=(stride()-1u)/2u;
 return vec3<f32>(vec3<u32>(ray%side()*stride()+offset,ray/side()*stride()+offset,z));
}
fn toWorld(q:vec3<f32>)->vec3<f32>{
 let xy=(2.0*(q.xy+.5)/beam.right.w-1.0)*beam.origin.w;
 return beam.origin.xyz+beam.right.xyz*xy.x-beam.up.xyz*xy.y+beam.forward.xyz*((q.z+.5)/beam.up.w*beam.forward.w);
}
fn toCells(p:vec3<f32>)->vec3<f32>{
 let q=p-beam.origin.xyz;
 return vec3<f32>((vec2<f32>(dot(q,beam.right.xyz),-dot(q,beam.up.xyz))/beam.origin.w+1.0)*beam.right.w*.5-.5,
  dot(q,beam.forward.xyz)/beam.forward.w*beam.up.w-.5);
}
fn atlasCell(z:u32,xy:vec2<u32>)->vec4<f32>{
 let columns=beam.schedule.z;let dropWidth=select(1u,cells(),beam.schedule.w==1u);
 return textureLoad(atlas,vec2<i32>(xy+vec2<u32>(z%columns,z/columns)*dropWidth),0);
}
@compute @workgroup_size(64) fn seedTau(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=arrayLength(&tau)){return;}
 let ray=i/layers();tau[i]=atlasCell(i%layers(),vec2<u32>(ray%cells(),ray/cells())).w;
}
@compute @workgroup_size(64) fn carry(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=arrayLength(&samples)||samples[i].position.w!=1.0||u.work.y<.5){return;}
 let p=samples[i].position.xyz;
 if(!particleInsideFine(p)){samples[i].position.w=0.0;return;}
 let moved=p+particleFineVelocity(p)*u.time.z*u.transport.x;
 let finite=all((bitcast<vec3<u32>>(moved)&vec3<u32>(0x7f800000u))!=vec3<u32>(0x7f800000u));
 samples[i].position=vec4<f32>(moved,select(0.0,1.0,finite&&particleInsideFine(moved)));
}
@compute @workgroup_size(64) fn refresh(@builtin(global_invocation_id) id:vec3<u32>){
 let init=beam.schedule.w==1u;
 let i=id.x;let length=layers();if(i>=select(length,arrayLength(&samples),init)){return;}
 let ray=select(beam.schedule.y,i/length,init);let z=i%length;let q=nominal(ray,z);
 let fresh=atlasCell(z,select(vec2<u32>(0),vec2<u32>(q.xy),init));
 let finite=all((bitcast<vec3<u32>>(fresh.xyz)&vec3<u32>(0x7f800000u))!=vec3<u32>(0x7f800000u))&&max(max(abs(fresh.x),abs(fresh.y)),abs(fresh.z))<65504.0;
 samples[ray*length+z]=Sample(vec4<f32>(toWorld(q),select(0.0,1.0,finite)),vec4<f32>(select(vec3<f32>(0),fresh.rgb,finite),select(0.0,1.0,finite)));
}
fn binWidth()->i32{return i32(side()+2u);}
fn binCoord(p:vec3<f32>)->vec3<i32>{return vec3<i32>(floor(p/vec3<f32>(f32(stride()),f32(stride()),1.0)))+1;}
fn inBins(q:vec3<i32>)->bool{return all(q>=vec3<i32>(0))&&all(q<vec3<i32>(binWidth(),binWidth(),i32(layers())+2));}
fn binIndex(q:vec3<i32>)->u32{return u32(q.x+binWidth()*(q.y+binWidth()*q.z));}
@compute @workgroup_size(64) fn bin(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=arrayLength(&samples)||samples[i].position.w!=1.0){return;}
 let q=binCoord(toCells(samples[i].position.xyz));if(!inBins(q)){return;}
 links[i]=atomicExchange(&heads[binIndex(q)],i+1u);
}
fn weight(q:vec3<f32>,s:vec3<f32>)->f32{
 let k=max(vec3<f32>(0),1.0-abs(q-s)/vec3<f32>(f32(stride()),f32(stride()),1.0));return k.x*k.y*k.z;
}
fn movedLight(q:vec3<f32>)->vec4<f32>{
 var sum=vec4<f32>(0);let c=binCoord(q);
 for(var dz=-1;dz<=1;dz++){for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let cell=c+vec3<i32>(dx,dy,dz);if(!inBins(cell)){continue;}
  var key=atomicLoad(&heads[binIndex(cell)]);
  while(key>0u){
   let s=samples[key-1u];let w=weight(q,toCells(s.position.xyz));
   if(w>1e-8){sum+=vec4<f32>(s.emission.xyz,1.0)*w;}
   key=links[key-1u];
  }
 }}}
 return sum;
}
fn heldLight(q:vec3<f32>,z:u32)->vec4<f32>{
 var sum=vec4<f32>(0);
 let c=vec2<i32>(floor((q.xy-f32((stride()-1u)/2u))/f32(stride())));
 for(var dy=0;dy<=1;dy++){for(var dx=0;dx<=1;dx++){
  let p=c+vec2<i32>(dx,dy);if(any(p<vec2<i32>(0))||any(p>=vec2<i32>(i32(side())))){continue;}
  let ray=u32(p.x+p.y*i32(side()));let w=weight(q,nominal(ray,z));
  let s=samples[ray*layers()+z].emission;
  if(s.w>0&&w>1e-8){sum+=vec4<f32>(s.xyz,1.0)*w;}
 }}
 return sum;
}
fn addEmission(m:vec4<f32>,incoming:vec3<f32>,trans:f32,depth:f32)->vec3<f32>{
 if(m.w<=0.0){return vec3<f32>(0);}
 let k=select((1.0-trans)/max(depth,1e-10),1.0-.5*depth,depth<1e-4);
 return incoming*trans+k*m.rgb/m.w;
}
// Independent spatial queries first; only the ordered optical recurrence is
// serial in depth. The output buffers temporarily hold each local mixture.
@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=arrayLength(&held)){return;}
 let ray=i/layers();let z=i%layers();let q=vec3<f32>(vec3<u32>(ray%cells(),ray/cells(),z));
 held[i]=heldLight(q,z);advected[i]=movedLight(q);
}
@compute @workgroup_size(64) fn resolve(@builtin(global_invocation_id) id:vec3<u32>){
 let ray=id.x;if(ray>=cells()*cells()){return;}
 var old=vec3<f32>(0);var moved=vec3<f32>(0);var oldOk=true;var movedOk=true;
 for(var z=0u;z<layers();z++){
  let at=ray*layers()+z;let d=tau[at];let tr=exp(-d);
  let a=held[at];let b=advected[at];
  let knownDepth=d>=0.0&&d<65504.0;
  oldOk=oldOk&&a.w>0.0&&knownDepth;movedOk=movedOk&&b.w>0.0&&knownDepth;
  old=addEmission(a,old,tr,d);moved=addEmission(b,moved,tr,d);
  held[at]=select(vec4<f32>(0),vec4<f32>(max(old,vec3<f32>(0))*beam.gain.x,1.0),oldOk);
  advected[at]=select(vec4<f32>(0),vec4<f32>(max(moved,vec3<f32>(0))*beam.gain.x,1.0),movedOk);
 }
}
`;

export function createResidentBeam(device,requested){
 const g=structuredClone(requested),plan=residentBeamPlan(g);
 const sizes={samples:plan.sampleCount*32,tau:plan.points*4,heads:plan.bins*4,links:plan.sampleCount*4,held:plan.points*16,advected:plan.points*16};
 const groups=n=>Math.ceil(n/64);
 if(Object.values(sizes).some(n=>n>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))||
   [plan.sampleCount,plan.points].some(n=>groups(n)>device.limits.maxComputeWorkgroupsPerDimension))throw Error('Resident beam exceeds device capacity');
 const make=(label,size,usage)=>device.createBuffer({label:'resident beam '+label,size,usage});
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const r=Object.fromEntries(Object.entries(sizes).map(([k,n])=>[k,make(k,n,storage)]));
 const cfg=make('geometry and cadence',96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
 const seedTransport=createPacketBundleTransport(device),refreshTransport=createPacketBundleTransport(device);
 const shader=device.createShaderModule({label:'resident finite beam history',code:PARTICLE_RESIDENT_BEAM_WGSL});
 const pipelines=Object.fromEntries(['seedTau','carry','refresh','bin','gather','resolve'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'resident beam '+entryPoint,layout:'auto',compute:{module:shader,entryPoint}})]));
 const pass=(encoder,key,items,n,profile)=>{
  const p=pipelines[key];const c=encoder.beginComputePass({label:'resident beam '+key,...profile(key)});
  c.setPipeline(p);c.setBindGroup(0,device.createBindGroup({layout:p.getBindGroupLayout(0),entries:items.map(([binding,resource])=>({binding,resource:resource?.createView?resource.createView():{buffer:resource}}))}));c.dispatchWorkgroups(groups(n));c.end();
 };
 let identity=null,transformKey=null,sequence=0,disposed=false;
 return {
  encode(encoder,material,{refresh=true,profileWrites=()=>({})}={}){
   if(disposed||!material?.fine||!material.sourceOptions||!material.options||!material.identity)throw Error('Current native beam material is unavailable');
   const init=!identity,id=material.identity,transform=material.domain.worldFromFine,key=JSON.stringify(transform);
   if(!init&&(identity.epoch!==id.epoch||identity.materialStamp!==id.materialStamp||identity.step+1!==id.step||transformKey!==key))throw Error('Resident beam requires consecutive unchanged material; reseed the comparison');
   const fine=p=>p.map((v,i)=>(v-transform.translate[i])/transform.scale);
   const origin=fine(g.emitter),target=fine(g.receiver),far=Math.hypot(...target.map((v,i)=>v-origin[i])),half=g.halfWidth/transform.scale;
   const bundle=finitePacketBundle({origin,target,halfSize:[half,half],far,weight:1});
   const cadence=init||!refresh?null:residentBeamRefresh(plan,sequence);
   let receipt=null,atlas=null;
   if(init||cadence){
    const source=init?bundle:{...bundle,halfSize:[half/plan.width,half/plan.width],
     origin:origin.map((p,i)=>p+bundle.right[i]*half*(2*(cadence.x+.5)/plan.width-1)-bundle.up[i]*half*(2*(cadence.y+.5)/plan.width-1))};
    const transport=init?seedTransport:refreshTransport,n=init?plan.width:1;
    receipt=transport.encode(encoder,{material,bundles:[source],width:n,height:n,sections:plan.sections,receivers:1,profileWrites}).receipt;atlas=transport.buffers.atlas;
   }
   const axis=new Float32Array([...origin,half,...bundle.forward,far,...bundle.right,plan.width,...bundle.up,plan.sections]);
   const config=new ArrayBuffer(96),f=new Float32Array(config),u=new Uint32Array(config);
   f.set(axis);u.set([plan.stride,cadence?.slot??0,receipt?.columns??0,Number(init)],16);f[20]=g.gain??1;
   device.queue.writeBuffer(cfg,0,config);
   if(init)pass(encoder,'seedTau',[[0,cfg],[2,r.tau],[3,atlas]],plan.points,profileWrites);
   else pass(encoder,'carry',[[1,r.samples],[4,material.fine],[5,material.sourceOptions],[6,material.options]],plan.sampleCount,profileWrites);
   if(atlas)pass(encoder,'refresh',[[0,cfg],[1,r.samples],[3,atlas]],init?plan.sampleCount:plan.sections,profileWrites);
   encoder.clearBuffer(r.heads);
   pass(encoder,'bin',[[0,cfg],[1,r.samples],[7,r.heads],[8,r.links]],plan.sampleCount,profileWrites);
   pass(encoder,'gather',[[0,cfg],[1,r.samples],[7,r.heads],[8,r.links],[9,r.held],[10,r.advected]],plan.points,profileWrites);
   pass(encoder,'resolve',[[0,cfg],[2,r.tau],[9,r.held],[10,r.advected]],plan.receiverRays,profileWrites);
   identity=Object.freeze({...id});transformKey=key;if(cadence)sequence++;
   const view=buf=>({identity,axis,buffer:buf,device});
   return {identity,views:{held:view(r.held),advected:view(r.advected)},plan,
    work:{seedRays:init?plan.receiverRays:0,refreshRays:cadence?1:0,refreshedSlot:cadence?.slot??null,sectionsMoved:init?0:plan.sampleCount,receiverPoints:plan.points,rasterInstances:receipt?.instances??0,
     persistentBytes:Object.values(sizes).reduce((a,b)=>a+b,96),readbacks:0},
    tau:r.tau,authority:'resident equal-budget finite patch; seed extinction and one shared fresh emission column'};
  },
  dispose(){
   disposed=true;seedTransport.dispose();refreshTransport.dispose();
   device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>[cfg,...Object.values(r)].forEach(b=>b.destroy()));
  }
 };
}
