import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';

export function followReceiverRead(previous,sample){
 if(!sample?.birth||previous.birth&&(
    sample.epoch!==previous.epoch||sample.slot!==previous.slot||sample.birth!==previous.birth))
  return {...previous,state:'lost',reason:previous.birth?'Selected carrier ended':'No retained material within the attachment radius'};
 const offset=previous.offset??previous.receiver.map((v,c)=>v-sample.point[c]);
 return {...sample,offset,position:sample.point.map((v,c)=>v+offset[c]),state:'following'};
}

export const PARTICLE_LIGHT_FOLLOW_WGSL=/* wgsl */`${PARTICLE_LIGHT_MATERIAL_WGSL}${PARTICLE_STATE_WGSL}
struct FollowQuery {location:vec4<f32>, key:vec4<u32>}
struct FollowResult {position:vec4<f32>, key:vec4<u32>, optical:vec4<f32>}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<storage,read> generations:array<u32>;
@group(0) @binding(2) var<uniform> query:FollowQuery;
@group(0) @binding(3) var<storage,read_write> output:FollowResult;
@group(0) @binding(4) var<uniform> options:Options;
var<workgroup> slots:array<u32,64>;
var<workgroup> distances:array<f32,64>;
fn sourcePower(p:Particle)->f32 {
 let fade=select(1.0,particleLifeFade(p.motion.w,options.lifeControl.y),options.lifeControl.x>0);
 return dot(max(particleLightIntrinsic(p),vec3<f32>(0)),vec3<f32>(1))*options.gain.x*max(0.0,p.shape.w)*fade;
}
fn writePoint(slot:u32){
 let p=particles[slot];
 output.position=vec4<f32>(p.anchor.xyz,1.0);
 output.optical=vec4<f32>(sourcePower(p),0,0,0);
 output.key=vec4<u32>(slot,generations[slot],0,0);
}
@compute @workgroup_size(64) fn follow(@builtin(local_invocation_index) tid:u32){
 let count=query.key.x;
 if(query.key.z>0u){
  if(tid==0u){
   output.key=vec4<u32>(0);output.position=vec4<f32>(0);output.optical=vec4<f32>(0);
   let s=query.key.y;
   if(s<count&&generations[s]==query.key.z&&particles[s].anchor.w>0.0){writePoint(s);}
  }
  return;
 }
 var best=query.location.w;var slot=0xffffffffu;
 for(var i=tid;i<count;i+=64u){
  if(particles[i].anchor.w<=0.0||generations[i]==0u||generations[i]==0xffffffffu||(query.key.w!=0u&&sourcePower(particles[i])<=0.0)){continue;}
  let delta=particles[i].anchor.xyz-query.location.xyz;
  let distance=dot(delta,delta);
  if(distance<best||(distance==best&&i<slot)){best=distance;slot=i;}
 }
 slots[tid]=slot;distances[tid]=best;workgroupBarrier();
 if(tid==0u){
  for(var i=1u;i<64u;i++){if(distances[i]<best||(distances[i]==best&&slots[i]<slot)){best=distances[i];slot=slots[i];}}
  output.key=vec4<u32>(0);output.position=vec4<f32>(0);output.optical=vec4<f32>(0);
  if(slot!=0xffffffffu){writePoint(slot);}
 }
}
`;

export function createLightSliceReceiverFollow({runtime,onRead=()=>{}}){
 let requested=null,match=null,requestId=0,lastEpoch=null,lastStep=null,lastStamp=null,materialOwner=null,device=null,resources=null,inFlight=false;
 const read=()=>match??{state:requested?'seeking':'world'};
 function release(){
  if(resources){const old=Object.values(resources).filter(x=>x?.destroy);device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(x=>x.destroy()));}
  resources=null;device=null;
 }
 function stop(){requested=null;match=null;lastEpoch=lastStep=lastStamp=materialOwner=null;requestId++;}
 function start(receiver,radius,{emissive=false}={}){stop();requested={receiver:[...receiver],radius,emissive};}
 function tick(){
  if(!requested||match?.state==='lost'||inFlight)return;
  const owner=runtime();
  const lost=reason=>{match={state:'lost',reason};onRead(match);};
  if(requested.emissive&&materialOwner&&owner!==materialOwner){lost('Native particle source changed');return;}
  if(!owner?.submitOpticalParticleMaterial)return;
  let pending=null,scope=null;
  try{
   const submitted=owner.submitOpticalParticleMaterial((encoder,frame,ownDevice)=>{
    materialOwner=owner;
    const {epoch,step,materialStamp}=frame.identity;
    if(match?.birth&&match.epoch!==epoch){match=followReceiverRead(match,null);onRead(match);return;}
    if(lastEpoch===epoch&&lastStep===step&&lastStamp===materialStamp)return;
    scope=ownDevice;scope.pushErrorScope('validation');
    if(!resources||device!==ownDevice){
     release();device=ownDevice;
     const storage=GPUBufferUsage.STORAGE,copy=GPUBufferUsage.COPY_DST;
     resources={uniform:device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|copy}),result:device.createBuffer({size:48,usage:storage|GPUBufferUsage.COPY_SRC}),
      pipeline:device.createComputePipeline({label:'select or read a live beam receiver carrier',layout:'auto',compute:{module:device.createShaderModule({code:PARTICLE_LIGHT_FOLLOW_WGSL}),entryPoint:'follow'}})};
    }
    if(!frame.birthGenerations)throw Error('Native particles do not expose a birth identity');
    const transform=frame.domain.worldFromFine;
    const p=requested.receiver.map((v,c)=>(v-transform.translate[c])/transform.scale);
    const body=new ArrayBuffer(32);
    new Float32Array(body).set([...p,(requested.radius/transform.scale)**2]);
    new Uint32Array(body).set([frame.slots,match?.slot??0,match?.birth??0,Number(requested.emissive)],4);
    device.queue.writeBuffer(resources.uniform,0,body);
    const bind=device.createBindGroup({layout:resources.pipeline.getBindGroupLayout(0),entries:[frame.particles,frame.birthGenerations,resources.uniform,resources.result,frame.options].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass({label:'light slice carrier identity'});
    pass.setPipeline(resources.pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();
    const staging=device.createBuffer({size:48,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{encoder.copyBufferToBuffer(resources.result,0,staging,0,48);}
    catch(e){staging.destroy();throw e;}
    pending={staging,transform,epoch,step,identity:frame.identity};
   });
   if(!submitted.available){pending?.staging.destroy();if(scope)void scope.popErrorScope().catch(()=>{});if(requested.emissive&&submitted.terminal)lost(submitted.reason);return;}
  }catch(e){pending?.staging.destroy();if(scope)void scope.popErrorScope().catch(()=>{});match={state:'lost',reason:e.message};onRead(match);return;}
  if(!pending)return;
  const {staging,transform,epoch,step,identity}=pending,token=requestId;
  lastEpoch=epoch;lastStep=step;lastStamp=identity.materialStamp;inFlight=true;
  Promise.all([staging.mapAsync(GPUMapMode.READ),scope.popErrorScope()]).then(([,validation])=>{
   if(validation)throw Error(validation.message);
   if(token!==requestId)return;
   const bytes=staging.getMappedRange(),u=new Uint32Array(bytes),f=new Float32Array(bytes);
   const sample={epoch,step,identity,sourcePower:f[8],slot:u[4],birth:u[5],point:Array.from(f.slice(0,3),(v,c)=>v*transform.scale+transform.translate[c])};
   match=followReceiverRead(match??requested,sample);onRead(match);
  }).catch(e=>{if(token===requestId){match={state:'lost',reason:e.message};onRead(match);}})
   .finally(()=>{staging.destroy();inFlight=false;});
 }
 return {start,stop,read,tick,dispose(){stop();release();}};
}
