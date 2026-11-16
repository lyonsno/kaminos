import {createResidentBeam,residentBeamPlan} from './particle-resident-beam.mjs';
import {createPacketBundleTransport,finitePacketBundle} from './volume-packet-bundle.mjs';

export const RESIDENT_VOLUME_ROUTE='whole-fine-six-direction-resident-light';
const directions=[['+X','-X'],['+Y','-Y'],['+Z','-Z']];
export const residentVolumeProfilePasses=Object.freeze(['packet-solid','packet-raster',...directions.flat().flatMap(
 d=>[...['seedTau','carry','refresh','bin','gather','resolve'].map(p=>d+' '+p),'merge '+d])]);

const allowed={mode:['off','held','advected'],presentation:['smoke','flame']};
export function residentVolumeSettings(patch={}){
 const next={mode:'off',presentation:'smoke',width:12,stride:3,refreshEvery:2,gain:1,...patch};
 for(const k of Object.keys(patch))if(!['mode','presentation','width','stride','refreshEvery','gain'].includes(k))throw Error('Unknown light history setting '+k);
 for(const [k,values] of Object.entries(allowed))if(!values.includes(next[k]))throw Error('Invalid light history '+k);
 residentBeamPlan({...next,sections:next.width});
 if(!Number.isSafeInteger(next.refreshEvery)||next.refreshEvery<0||!Number.isFinite(next.gain)||next.gain<0||!Number.isFinite(Math.fround(next.gain)))throw Error('Invalid light history cadence or gain');
 return next;
}
export function volumeRefreshDue(update,every){return update>0&&every>0&&(update-1)%every===0;}

const component=v=>{const dim=v.findIndex(x=>Math.abs(x)>.5);return dim*2+Number(v[dim]<0);};
export function residentVolumeSweeps(dims){
 if(dims.length!==3||dims.some(d=>!Number.isSafeInteger(d)||d<1)||dims[0]!==dims[2])throw Error('Expected an admitted rectangular Fine grid');
 const spans=dims.map(n=>n/dims[0]),middle=spans.map(h=>h-1);
 return [0,1,2].flatMap(axis=>[1,-1].map(sign=>{
  const emitter=[...middle],receiver=[...middle];
  emitter[axis]-=sign*spans[axis];receiver[axis]+=sign*spans[axis];
  const far=2*spans[axis],b=finitePacketBundle({origin:emitter,target:receiver,halfSize:[1,1],far,weight:1});
  const half=v=>v.reduce((sum,x,i)=>sum+Math.abs(x)*spans[i],0);
  return {direction:directions[axis][Number(sign<0)],emitter,receiver,halfWidth:half(b.right),halfHeight:half(b.up),far,
   forward:b.forward,right:b.right,up:b.up,map:[component(b.right),component(b.up.map(x=>-x)),component(b.forward)]};
 }));
}
export function directionalGridIndex(x,n,map){
 const [r,s,z]=map.map(i=>i%2?n-1-x[i>>1]:x[i>>1]);
 return (r+s*n)*n+z;
}
export const RESIDENT_VOLUME_COMPOSE_WGSL=/* wgsl */`
struct Config {map:vec4<u32>,weight:vec4<f32>}
@group(0) @binding(0) var<uniform> config:Config;
@group(0) @binding(1) var<storage,read> held:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> carried:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> outHeld:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> outCarried:array<vec4<f32>>;
fn axis(q:vec3<u32>,code:u32,n:u32)->u32{let x=q[code/2u];return select(x,n-1u-x,code%2u==1u);}
@compute @workgroup_size(64) fn add(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=arrayLength(&outHeld)){return;}
 let n=config.map.w;let ray=i/n;let world=vec3<u32>(ray%n,n-1u-ray/n,i%n);
 let d=(axis(world,config.map.x,n)+n*axis(world,config.map.y,n))*n+axis(world,config.map.z,n);
 let h=held[d];let a=carried[d];let w=config.weight.x;
 // Missing carried support falls back only to a known held observation of
 // the same direction. Counts record which directional estimates were carried.
 outHeld[i]+=vec4<f32>(h.rgb*w,h.w);
 outCarried[i]+=vec4<f32>(select(h.rgb,a.rgb,a.w>0.0)*w,a.w);
}
`;

export function createResidentVolume(device,requested,dims){
 const s=residentVolumeSettings(requested),n=s.width,plan=residentBeamPlan({...s,sections:n}),sweeps=residentVolumeSweeps(dims);
 const bytes=plan.points*16,groups=Math.ceil(plan.points/64);
 if(bytes>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize)||groups>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Volume light exceeds effective compute capacity');
 const owners=sweeps.map(g=>createResidentBeam(device,{...g,width:n,sections:n,stride:s.stride,batched:true,fineSpace:true}));
 let seedAtlas=createPacketBundleTransport(device);const freshAtlas=createPacketBundleTransport(device);
 const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
 const combinedHeld=device.createBuffer({label:'whole Fine volume held directional light',size:bytes,usage});
 const combinedAdvected=device.createBuffer({label:'whole Fine volume carried directional light',size:bytes,usage});
 const mapping=sweeps.map(({map})=>{
  const d=new ArrayBuffer(32);new Uint32Array(d).set([...map,n]);new Float32Array(d)[4]=s.gain/sweeps.length;
  const buffer=device.createBuffer({label:'resident direction permutation',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(buffer,0,d);return buffer;
 });
 const module=device.createShaderModule({label:'whole Fine volume equal solid angle merge',code:RESIDENT_VOLUME_COMPOSE_WGSL});
 const add=device.createComputePipeline({label:'resident directional merge',layout:'auto',compute:{module,entryPoint:'add'}});
 const {emitter,forward,far,right,up,halfWidth,halfHeight}=sweeps[4];
 const axis=new Float32Array([...emitter,halfWidth,...forward,far,...right,n,...up,n]);
 let latest=null,updates=0,disposed=false;
 return {
  encode(encoder,material,{profileWrites=()=>({}),refreshEvery=s.refreshEvery}={}){
   if(disposed)throw Error('Resident volume is disposed');
   const id=material.identity;
   if(latest?.identity.step===id.step&&latest.identity.epoch===id.epoch&&latest.identity.materialStamp===id.materialStamp)return latest;
   const seed=!latest,stepDelta=seed?0:id.step-latest.identity.step;
   const next=seed?0:updates+1,refresh=volumeRefreshDue(next,refreshEvery);
   const requests=owners.map(o=>o.acquisition(material,{refresh,stepDelta}));
   let shared=null,receipt=null;
   if(!seed&&seedAtlas){seedAtlas.dispose();seedAtlas=null;}
   if(seed||refresh){
    const transport=seed?seedAtlas:freshAtlas,width=seed?n:1;
    receipt=transport.encode(encoder,{material,bundles:requests.map(q=>q.request),width,height:width,sections:n,receivers:1,momentsOnly:true,profileWrites}).receipt;
    shared={atlas:transport.buffers.atlas,receipt};
   }
   const fields=owners.map((o,i)=>o.encode(encoder,material,{refresh,stepDelta,shared:shared?{...shared,index:i}:null,profileWrites:k=>profileWrites(sweeps[i].direction+' '+k)}));
   encoder.clearBuffer(combinedHeld);encoder.clearBuffer(combinedAdvected);
   for(let i=0;i<fields.length;i++){
    const {held,advected}=fields[i].views;
    const c=encoder.beginComputePass({label:'resident angular accumulation',...profileWrites('merge '+sweeps[i].direction)});
    c.setPipeline(add);c.setBindGroup(0,device.createBindGroup({layout:add.getBindGroupLayout(0),
     entries:[mapping[i],held.buffer,advected.buffer,combinedHeld,combinedAdvected].map((buffer,binding)=>({binding,resource:{buffer}}))}));
    c.dispatchWorkgroups(groups);c.end();
   }
   const identity=fields[0].identity;
   const view=buffer=>({identity,axis,halfHeight,buffer,device,fieldKind:'resident-volume'});
   updates=next;
   latest={identity,views:{held:view(combinedHeld),advected:view(combinedAdvected)},route:RESIDENT_VOLUME_ROUTE,
    work:{updates,stepDelta,directions:sweeps.map(s=>s.direction),seedRays:seed?plan.receiverRays*sweeps.length:0,
     freshRays:refresh?sweeps.length:0,freshRasterInstances:receipt?.instances??0,freshAtlasPasses:receipt?1:0,
     freshSlots:fields.map(f=>f.work.refreshedSlot),retainedSections:plan.sampleCount*sweeps.length,receiverPoints:plan.points,
     reuseBufferBytes:fields.reduce((n,f)=>n+f.work.reuseBufferBytes,2*bytes+mapping.length*32),
     packetWorkspaceBytes:((seed?receipt:freshAtlas.read())?.bytes??0),readbacks:0}};
   return latest;
  },
  dispose(){
   if(disposed)return;disposed=true;seedAtlas?.dispose();freshAtlas.dispose();owners.forEach(o=>o.dispose());
   device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>[combinedHeld,combinedAdvected,...mapping].forEach(b=>b.destroy()));
  }
 };
}
