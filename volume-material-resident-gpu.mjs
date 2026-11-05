import {validateAllocation,materialImportance} from './volume-material-hierarchy.mjs';
import {allocationLayout,allocationWGSL} from './volume-material-allocation-gpu.mjs';

const SOURCE_WGSL=/* wgsl */`
struct SourceBrick {loPitch:vec4<f32>,kids0:vec4<u32>,kids1:vec4<u32>,info:vec4<u32>}
struct SourceParcel {loRate:vec4<f32>,hiFuel:vec4<f32>,velocityRelax:vec4<f32>,heat:vec4<f32>}
struct SourceParams {counts:vec4<u32>}
@group(0) @binding(0) var<uniform> sp:SourceParams;
@group(0) @binding(1) var<storage,read> sn:array<SourceBrick>;
@group(0) @binding(2) var<storage,read> ss:array<u32>;
@group(0) @binding(3) var<storage,read> parcels:array<SourceParcel>;
@group(0) @binding(4) var supply:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(64) fn depositMaterialSources(@builtin(workgroup_id) g:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) cell:u32){
 let i=g.x+g.y*groups.x;if(i>=ss[1]){return;}let slot=ss[ss[9]+i];let n=sn[slot];let c=vec3<u32>(cell%4u,(cell/4u)%4u,cell/16u);let lo=n.loPitch.xyz+vec3<f32>(c)*n.loPitch.w;let hi=lo+n.loPitch.w;
 var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var j=0u;j<sp.counts.x;j++){let p=parcels[j];let f=max(vec3<f32>(0),min(hi,p.hiFuel.xyz)-max(lo,p.loRate.xyz))/n.loPitch.w;let fraction=f.x*f.y*f.z;let q=p.loRate.w*fraction;let r=p.velocityRelax.w*fraction;a+=vec4<f32>(q,q*p.hiFuel.w,q*p.heat.x,0);b+=vec4<f32>(p.velocityRelax.xyz*r,r);}
 let d=textureDimensions(supply);let index=2u*(slot*64u+cell);textureStore(supply,vec2<i32>(i32(index%d.x),i32(index/d.x)),a);textureStore(supply,vec2<i32>(i32((index+1u)%d.x),i32((index+1u)/d.x)),b);
}
`;
const REMAP_WGSL=/* wgsl */`
struct RemapBrick {loPitch:vec4<f32>,kids0:vec4<u32>,kids1:vec4<u32>,info:vec4<u32>}
struct ResidentRemap {source:vec4<u32>,loPitch:vec4<f32>}
@group(0) @binding(0) var<storage,read> oldNodes:array<RemapBrick>;
@group(0) @binding(1) var<storage,read> newNodes:array<RemapBrick>;
@group(0) @binding(2) var<storage,read> rs:array<u32>;
@group(0) @binding(3) var<storage,read_write> remaps:array<ResidentRemap>;
@compute @workgroup_size(64) fn buildMaterialRemaps(@builtin(global_invocation_id) g:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=g.x+g.y*groups.x*64u;if(i>=rs[0]||rs[3]==0u){return;}let slot=rs[rs[8]+i];let prior=newNodes[slot].info.w-1u;var origin=vec4<f32>(0,0,0,1);if(prior!=0xffffffffu){origin=oldNodes[prior].loPitch;}remaps[slot]=ResidentRemap(vec4<u32>(prior,0,0,0),origin);
}
`;

export function createResidentMaterialHierarchyGPU(device,plan,code,initialOptions){
 let options=validateAllocation(initialOptions),active=null,bank=0,current=0,steps=0,destroyed=false;
 let headerObservation=null,topologyObservation=null,demandObservation=null,observing=false,observeTopology=false,observeDemand=false,observeHeader=false,error=null,lastBacktrace=0,transportClock=0;
 const observationBuffers=new Set();
 const resources=new Set(),pipelines=new Map(),groups=new Map();
 let diagnostics={levels:[],bricks:[]};
 function setTopology(value){topologyObservation=value;const nodes=value.nodes;diagnostics={levels:[...new Set(nodes.map(n=>n.level))].map(level=>({level,bricks:nodes.filter(n=>n.level===level&&!n.children).length})),bricks:nodes.filter(n=>!n.children).map(n=>({key:n.key,level:n.level,min:n.lo,width:n.pitch*4}))};}
 const usage=GPUBufferUsage,texUsage=GPUTextureUsage,S=usage.STORAGE,D=usage.COPY_DST,C=usage.COPY_SRC;
 const roots=plan.materialDims.map(n=>Math.ceil(n/4)),rootCount=roots.reduce((a,b)=>a*b,1);
 const capacity=o=>rootCount+8*Math.floor(rootCount*o.budget/8);
 function admission(o){const cap=capacity(o),magnitude=Math.max(1,...plan.min.map(Math.abs),...plan.max.map(Math.abs));if(plan.materialPitch/2**o.maxDetail<magnitude*2**-22)throw Error('Maximum detail exceeds f32 position precision for this world field');const bytes=cap*64*64;if(!Number.isSafeInteger(bytes)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Material pool exceeds GPU storage limits');const l=allocationLayout(cap,o.maxDetail);if(l.words*4>device.limits.maxStorageBufferBindingSize||cap*96>device.limits.maxStorageBufferBindingSize)throw Error('Material allocation workspace exceeds GPU storage limits');const width=Math.min(device.limits.maxTextureDimension2D,cap*128),height=Math.ceil(cap*128/width);if(height>device.limits.maxTextureDimension2D)throw Error('Source atlas exceeds GPU texture limits');return{cap,l,width,height};}
 const buffer=(label,size,flags=S|D|C)=>{const b=device.createBuffer({label,size:Math.max(4,size),usage:flags});resources.add(b);return b;};
 const destroyOne=r=>{if(resources.delete(r))r.destroy();};
 const retire=items=>queueMicrotask(()=>device.queue.onSubmittedWorkDone().then(()=>{for(const r of items)destroyOne(r);}));
 const plannerParams=buffer('GPU allocation parameters',112,usage.UNIFORM|D),hierarchyParams=buffer('hierarchy parameters',48,usage.UNIFORM|D),sourceParams=buffer('GPU source parameters',16,usage.UNIFORM|D);
 device.queue.writeBuffer(hierarchyParams,0,new Float32Array([...roots,plan.materialPitch,...plan.min,0,0,0,0,0]));
 let supportBuffer=buffer('GPU source support descriptors',48),parcelBuffer=buffer('GPU source parcel descriptors',64),supportKey=null,parcelKey=null,supportCount=0,parcelCount=0;
 const simulationModule=device.createShaderModule({label:'resident material simulation',code}),sourceModule=device.createShaderModule({label:'resident material source deposition',code:SOURCE_WGSL}),remapModule=device.createShaderModule({label:'resident material remapping',code:REMAP_WGSL});
 const dummyNodes=buffer('GPU allocation initial topology',64),dummyState=buffer('GPU allocation initial state',64),dummyDemand=buffer('GPU allocation initial demand',48);
 const pipeline=(key,module,entryPoint,constants)=>{if(!pipelines.has(key))pipelines.set(key,device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module,entryPoint,...(constants?{constants}:{})}}));return pipelines.get(key);};
 function group(key,p,index,entries){if(!groups.has(p))groups.set(p,new Map());const byIndex=groups.get(p);if(!byIndex.has(index))byIndex.set(index,{next:new WeakMap()});let node=byIndex.get(index);for(const e of entries){const object=e.resource.buffer??e.resource;if(!node.next.has(object))node.next.set(object,new Map());const variants=node.next.get(object),range=e.resource.buffer?`${e.resource.offset??0}:${e.resource.size??'all'}`:'';if(!variants.has(range))variants.set(range,{next:new WeakMap()});node=variants.get(range);}return node.group??=device.createBindGroup({layout:p.getBindGroupLayout(index),entries});}
 const br=(binding,b,offset=0,size)=>({binding,resource:{buffer:b,...(offset?{offset}:{}),...(size?{size}:{})}});
 function make(o){const{cap,l,width,height}=admission(o);const owned=[];const b=(...args)=>{const r=buffer(...args);owned.push(r);return r;};const supply=device.createTexture({label:'GPU resident source supply',size:[width,height],format:'rgba32float',usage:texUsage.TEXTURE_BINDING|texUsage.STORAGE_BINDING});resources.add(supply);owned.push(supply);
  return{capacity:cap,maxDetail:o.maxDetail,layout:l,owned,fields:[b('resident material A',cap*4096),b('resident material B',cap*4096)],migration:b('resident material migration scratch',cap*4096),nodes:[b('GPU material topology A',cap*64),b('GPU material topology B',cap*64)],state:[b('GPU material lists A',l.words*4,S|D|C|usage.INDIRECT),b('GPU material lists B',l.words*4,S|D|C|usage.INDIRECT)],demand:b('GPU resident material demand',cap*48),prediction:b('GPU material prediction',cap*16),scratch:b('GPU material allocation workspace',cap*96),remap:b('GPU material remaps',cap*32),supply,supplyView:supply.createView()};}
 function uploadSources(sources){
  const supports=sources.supports??[],parcels=sources.parcels??[],sk=JSON.stringify(supports),pk=JSON.stringify(parcels);
  if(supports.length*48>device.limits.maxStorageBufferBindingSize||parcels.length*64>device.limits.maxStorageBufferBindingSize)throw Error('Source descriptors exceed GPU storage limits');
  if(sk!==supportKey){const data=new Float32Array(Math.max(12,supports.length*12));for(let i=0;i<supports.length;i++){const s=supports[i];if([...s.lo,...s.hi,s.heat,s.fuel].some(v=>!Number.isFinite(v)))throw Error('Invalid source support descriptor');data.set([...s.lo,0,...s.hi,0,s.heat,s.fuel,0,0],i*12);}if(supportBuffer.size!==data.byteLength){const prior=supportBuffer;supportBuffer=buffer('GPU source support descriptors',data.byteLength);retire([prior]);}device.queue.writeBuffer(supportBuffer,0,data);supportCount=supports.length;supportKey=sk;}
  if(pk!==parcelKey){const data=new Float32Array(Math.max(16,parcels.length*16));for(let i=0;i<parcels.length;i++){const p=parcels[i];if([...p.lo,...p.hi,...p.velocity,p.rate,p.fuel,p.heat,p.relax].some(v=>!Number.isFinite(v)))throw Error('Invalid source parcel descriptor');data.set([...p.lo,p.rate,...p.hi,p.fuel,...p.velocity,p.relax,p.heat,0,0,0],i*16);}if(parcelBuffer.size!==data.byteLength){const prior=parcelBuffer;parcelBuffer=buffer('GPU source parcel descriptors',data.byteLength);retire([prior]);}device.queue.writeBuffer(parcelBuffer,0,data);parcelCount=parcels.length;parcelKey=pk;device.queue.writeBuffer(sourceParams,0,new Uint32Array([parcelCount,0,0,0]));}
 }
 function simple(encoder,label,p,entries,count,indirect){const pass=encoder.beginComputePass({label});pass.setPipeline(p);pass.setBindGroup(0,group(label,p,0,entries));if(indirect)pass.dispatchWorkgroupsIndirect(...indirect);else{const x=Math.min(count,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(count/Math.max(x,1)));}pass.end();}
 function sim(encoder,name,world,items,state,offset,level=0){const key=`${name}:${level}`,p=pipeline(key,simulationModule,name,name==='restrictBricks'?{HIERARCHY_LEVEL:level}:undefined);const bindings={migrateBricks:[0,4,9],advanceBricks:[0,1,2,8,9,11,14,15,18],restrictBricks:[],exportBricks:[0,5,10,16],measureBricks:[0,2,9,11]}[name];const pass=encoder.beginComputePass({label:name});pass.setPipeline(p);if(bindings.length)pass.setBindGroup(0,group(key,p,0,bindings.map(binding=>({binding,resource:world[binding]}))));else pass.setBindGroup(0,group(key,p,0,[]));pass.setBindGroup(1,group(key,p,1,items));if(name==='exportBricks')pass.dispatchWorkgroups(...plan.materialDims.map(n=>Math.ceil(n/4)));else pass.dispatchWorkgroupsIndirect(state,offset);pass.end();}
 let observedStep=-1;
 function observation(encoder,s,which,requestedStep){
  if(observing||!observeTopology&&!observeDemand&&!observeHeader)return;
  const sampledAt=performance.now()/1000,sampleClock=transportClock;
  const geometry=observeDemand||(observeTopology&&(!topologyObservation||topologyObservation.revision!==headerObservation?.revision)),stateBytes=geometry?s.state[which].size:64,metaBytes=geometry?s.nodes[which].size:0,demandBytes=observeDemand?s.demand.size:0;
  observeDemand=false;
  const copy=buffer('explicit material observation',stateBytes+metaBytes+demandBytes,D|usage.MAP_READ);observationBuffers.add(copy);encoder.copyBufferToBuffer(s.state[which],0,copy,0,stateBytes);if(metaBytes)encoder.copyBufferToBuffer(s.nodes[which],0,copy,stateBytes,metaBytes);if(demandBytes)encoder.copyBufferToBuffer(s.demand,0,copy,stateBytes+metaBytes,demandBytes);observing=true;
  queueMicrotask(async()=>{let mapped=false;try{await copy.mapAsync(GPUMapMode.READ);mapped=true;if(destroyed)return;const bytes=copy.getMappedRange(),u=new Uint32Array(bytes),f=new Float32Array(bytes),count=u[0],leaves=u[1],revision=u[2];headerObservation={allocatedBricks:count,leafBricks:leaves,revision,steps:requestedStep,observedAt:performance.now()/1000};observedStep=requestedStep;if(!metaBytes)return;const nodes=[];for(let i=0;i<count;i++){const slot=u[u[8]+i],base=stateBytes/4+slot*16,level=u[base+13],pitch=f[base+3],lo=Array.from(f.subarray(base,base+3)),c=lo.map((v,a)=>Math.round((v-plan.min[a])/(4*pitch))),children=u[base+4]===0xffffffff?null:Array.from(u.subarray(base+4,base+12));nodes.push({key:`${level}:${c.join(':')}`,slot,level,c,lo,pitch,childSlots:children,parentSlot:u[base+12]});}const bySlot=new Map(nodes.map(n=>[n.slot,n]));for(const n of nodes)n.children=n.childSlots?.map(k=>bySlot.get(k).key)??null;
   headerObservation={allocatedBricks:count,leafBricks:leaves,revision,steps:requestedStep,observedAt:performance.now()/1000};observedStep=requestedStep;setTopology({nodes,revision,steps:requestedStep});
   if(demandBytes){const start=(stateBytes+metaBytes)/4,previous=demandObservation,transportRate=previous&&sampledAt>previous.sampledAt?(sampleClock-previous.clock)/(sampledAt-previous.sampledAt):0;demandObservation={revision,steps:requestedStep,sampledAt,clock:sampleClock,transportRate,boxes:nodes.filter(n=>!n.children).map(n=>{const d=start+n.slot*12,signal={reaction:f[d],mixing:f[d+1],thermal:f[d+2],smoke:f[d+3]},volume=n.lo.reduce((v,x,a)=>v*Math.max(0,Math.min(plan.max[a],x+4*n.pitch)-x),1);return{id:n.key,lo:n.lo,hi:n.lo.map((x,a)=>Math.min(plan.max[a],x+4*n.pitch)),weight:materialImportance(signal,options.weights)*volume,motionMin:Array.from(f.subarray(d+4,d+7),v=>v*transportRate),motionMax:Array.from(f.subarray(d+8,d+11),v=>v*transportRate)};})};}
  }catch(e){if(!destroyed)error=e.message;}finally{if(mapped)copy.unmap();observationBuffers.delete(copy);destroyOne(copy);observing=false;}});
 }
 admission(options);
 return{
  configure(patch){const next=validateAllocation({...options,...patch,weights:{...options.weights,...patch.weights}});admission(next);options=next;return this.read();},
  observe({topology=observeTopology,demand=observeDemand,header=observeHeader}={}){observeTopology=!!topology;observeDemand=!!demand;observeHeader=!!header;},
  encode(encoder,world,backtraceScale=0,sources={}){
   if(destroyed)throw Error('Material hierarchy disposed');uploadSources(sources);lastBacktrace=Math.abs(backtraceScale);transportClock+=lastBacktrace;
   let old=active,oldBank=bank,oldCurrent=current;const shape=admission(options);if(!active||active.capacity!==shape.cap||active.maxDetail!==options.maxDetail){active=make(options);bank=1;current=0;}bank=1-bank;
   const s=active,oldNodes=old?.nodes[oldBank]??dummyNodes,oldState=old?.state[oldBank]??dummyState,oldDemand=old?.demand??dummyDemand;
   // Prediction belongs to the prior topology. A capacity change retains that
   // storage until its last submitted consumer has completed.
   const prediction=old?.prediction??s.prediction;encoder.clearBuffer(prediction);
   const maxDepth=Math.max(s.maxDetail,old?.maxDetail??0),moduleKey=`allocation:${maxDepth}`;if(!pipelines.has(moduleKey))pipelines.set(moduleKey,device.createShaderModule({label:'GPU material allocation',code:allocationWGSL(maxDepth)}));const module=pipelines.get(moduleKey);
   const data=new ArrayBuffer(112),u=new Uint32Array(data),f=new Float32Array(data);u.set([...plan.materialDims,rootCount]);f.set([...plan.min,plan.materialPitch],4);f.set([options.spread,options.persistence,options.lookahead,lastBacktrace],8);f.set(['reaction','mixing','thermal','smoke'].map(k=>options.weights[k]),12);u.set([s.capacity,old?.capacity??0,supportCount,options.maxDetail],16);u.set([s.layout.all,s.layout.leaves,s.layout.levels,s.layout.stride],20);u.set([s.layout.heap,s.layout.occupied,device.limits.maxComputeWorkgroupsPerDimension,0],24);device.queue.writeBuffer(plannerParams,0,data);
   const entries=[br(0,plannerParams),br(1,oldNodes),br(2,oldState),br(3,oldDemand),br(4,prediction),br(5,s.nodes[bank]),br(6,s.state[bank]),br(7,s.scratch),br(8,supportBuffer)];
   for(const [entry,label,ids,count]of [['predictAllocation','GPU material prediction',[0,1,2,3,4],Math.ceil((old?.capacity??1)/64)],['reduceAllocationPrediction','GPU material parent demand',[1,2,4],1],['planAllocation','GPU material allocation',[0,1,2,4,5,6,7,8],1]]){const key=`${entry}:${maxDepth}`,p=pipeline(key,module,entry);simple(encoder,label,p,ids.map(i=>entries[i]),count);}
   const remapPipeline=pipeline('buildMaterialRemaps',remapModule,'buildMaterialRemaps');simple(encoder,'GPU material remap records',remapPipeline,[br(0,oldNodes),br(1,s.nodes[bank]),br(2,s.state[bank]),br(3,s.remap)],Math.ceil(s.capacity/64));
   const work=(offset)=>br(3,s.state[bank],offset*4,s.capacity*4),state=br(8,s.state[bank]),nodes=br(0,s.nodes[bank]);
   sim(encoder,'migrateBricks',world,[nodes,br(1,old?.fields[oldCurrent]??s.fields[1]),br(2,s.migration),work(s.layout.all),br(4,s.remap),state],s.state[bank],24*4);
   const supplyPipeline=pipeline('depositMaterialSources',sourceModule,'depositMaterialSources');simple(encoder,'GPU source deposition',supplyPipeline,[br(0,sourceParams),br(1,s.nodes[bank]),br(2,s.state[bank]),br(3,parcelBuffer),{binding:4,resource:s.supplyView}],0,[s.state[bank],20*4]);
   world={...world,18:s.supplyView};const destination=old===s?1-oldCurrent:0;
   sim(encoder,'advanceBricks',world,[nodes,br(1,old?.fields[oldCurrent]??s.fields[1]),br(2,s.fields[destination]),work(s.layout.leaves),br(6,hierarchyParams),br(7,s.migration),state],s.state[bank],20*4);current=destination;
   for(let level=s.maxDetail-1;level>=0;level--)sim(encoder,'restrictBricks',world,[nodes,br(2,s.fields[current]),work(s.layout.levels+level*s.layout.stride),state],s.state[bank],(32+4*level)*4,level);
   sim(encoder,'exportBricks',world,[br(1,s.fields[current]),br(6,hierarchyParams)],s.state[bank],0);
   sim(encoder,'measureBricks',world,[nodes,br(1,s.fields[current]),work(s.layout.leaves),br(5,s.demand),br(6,hierarchyParams),br(7,s.migration),state],s.state[bank],20*4);steps++;observation(encoder,s,bank,steps);
   if(old&&old!==s)retire(old.owned);
  },
  renderResources(){return active?{gas:active.fields[current],nodes:active.nodes[bank],work:active.state[bank],workOffset:active.layout.all*4,workSize:active.capacity*4,state:active.state[bank],indirectOffset:16*4,capacity:active.capacity,nodeCount:active.capacity,leafCount:headerObservation?.leafBricks??null,revision:headerObservation?.revision??null,steps,gpuResident:true}:null;},
  coverageDemand(){observeDemand=true;return demandObservation?{status:'measured',...demandObservation}:{status:'awaiting-measurement',boxes:[]};},
  async snapshot(){if(!active)return null;const s=active,which=bank,at=steps,a=s.state[which].size,b=s.nodes[which].size,c=s.fields[current].size,copy=buffer('explicit resident snapshot',a+b+c,D|usage.MAP_READ),e=device.createCommandEncoder();e.copyBufferToBuffer(s.state[which],0,copy,0,a);e.copyBufferToBuffer(s.nodes[which],0,copy,a,b);e.copyBufferToBuffer(s.fields[current],0,copy,a+b,c);device.queue.submit([e.finish()]);try{await copy.mapAsync(GPUMapMode.READ);const bytes=copy.getMappedRange(),u=new Uint32Array(bytes),f=new Float32Array(bytes),nodes=[];for(let i=0;i<u[0];i++){const slot=u[u[8]+i],j=a/4+slot*16,level=u[j+13],pitch=f[j+3],lo=Array.from(f.subarray(j,j+3)),c=lo.map((x,k)=>Math.round((x-plan.min[k])/(4*pitch)));nodes.push({key:`${level}:${c.join(':')}`,slot,level,c,lo,pitch,childSlots:u[j+4]===0xffffffff?null:Array.from(u.subarray(j+4,j+12))});}const bySlot=new Map(nodes.map(n=>[n.slot,n]));for(const n of nodes)n.children=n.childSlots?.map(i=>bySlot.get(i).key)??null;headerObservation={allocatedBricks:u[0],leafBricks:u[1],revision:u[2],steps:at,observedAt:performance.now()/1000};observedStep=at;setTopology({nodes,revision:u[2],steps:at});return{nodes,steps:at,revision:u[2],dims:plan.materialDims,pitch:plan.materialPitch,values:Array.from(f.subarray((a+b)/4,(a+b+c/2)/4)),ownedValues:Array.from(f.subarray((a+b+c/2)/4))};}finally{destroyOne(copy);}},
  read(){const cap=active?.capacity??capacity(options);return{identity:'pooled-material-hierarchy-v1',allocationBackend:'gpu-resident',options:structuredClone(options),baseDims:plan.materialDims,steps,revision:headerObservation?.revision??null,allocatedBricks:headerObservation?.allocatedBricks??null,leafBricks:headerObservation?.leafBricks??null,capacity:cap,estimatedCellWork:headerObservation?headerObservation.allocatedBricks*64:null,materialBytes:cap*4096*3,demandRoute:'GPU-resident-prediction-and-refinement',predictionTransportInterval:lastBacktrace,renderMaterialDims:plan.materialDims,error,observation:headerObservation?{status:'observed',steps:observedStep,ageSteps:steps-observedStep}:{status:'not-requested'},levels:diagnostics.levels,bricks:diagnostics.bricks};},
  destroy(){destroyed=true;for(const r of [...resources])if(!observationBuffers.has(r))destroyOne(r);groups.clear();pipelines.clear();}
 };
}
