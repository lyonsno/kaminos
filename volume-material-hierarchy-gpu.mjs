import {MaterialHierarchy,validateAllocation,predictDemand} from './volume-material-hierarchy.mjs';

// Material remains resident. Only one compact demand record per allocated brick
// crosses to the CPU, asynchronously, for the replaceable allocation policy.
export function hierarchyWGSL(worldCode){return worldCode+/* wgsl */`
struct Brick {loPitch:vec4<f32>, children0:vec4<u32>, children1:vec4<u32>, info:vec4<u32>}
struct Remap {source:vec4<u32>, loPitch:vec4<f32>}
struct HierarchyParams {base:vec4<f32>, lo:vec4<f32>, count:vec4<u32>}
@group(1) @binding(0) var<storage,read> bricks:array<Brick>;
@group(1) @binding(1) var<storage,read> hin:array<Gas>;
@group(1) @binding(2) var<storage,read_write> hout:array<Gas>;
@group(1) @binding(3) var<storage,read> work:array<u32>;
@group(1) @binding(4) var<storage,read> remaps:array<Remap>;
@group(1) @binding(5) var<storage,read_write> demand:array<vec4<f32>>;
@group(1) @binding(6) var<uniform> h:HierarchyParams;
fn localCell(l:u32)->vec3<u32>{return vec3<u32>(l%4u,(l/4u)%4u,l/16u);}
fn localIndex(c:vec3<u32>)->u32{return c.x+4u*(c.y+4u*c.z);}
fn childSlot(n:Brick,oct:u32)->u32{if(oct<4u){return n.children0[oct];}return n.children1[oct-4u];}
fn leafAt(p:vec3<f32>)->u32{
 if(any(p<u.materialLo.xyz)||any(p>=u.materialLo.xyz+u.material.xyz*u.material.w)){return 0xffffffffu;}
 let root=vec3<i32>(floor((p-h.lo.xyz)/(h.base.w*4.0)));
 if(any(root<vec3<i32>(0))||any(root>=vec3<i32>(h.base.xyz))){return 0xffffffffu;}
 var slot=u32(root.x)+u32(h.base.x)*(u32(root.y)+u32(h.base.y)*u32(root.z));
 loop{let n=bricks[slot];if(n.children0.x==0xffffffffu){return slot;}
  let oct=vec3<u32>(clamp(floor((p-n.loPitch.xyz)/(n.loPitch.w*2.0)),vec3<f32>(0),vec3<f32>(1)));
  slot=childSlot(n,oct.x+2u*(oct.y+2u*oct.z));
 }
}
fn nearestGas(p:vec3<f32>)->Gas{
 let slot=leafAt(p);if(slot==0xffffffffu){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let n=bricks[slot];let c=vec3<u32>(clamp(floor((p-n.loPitch.xyz)/n.loPitch.w),vec3<f32>(0),vec3<f32>(3)));
 return hin[slot*64u+localIndex(c)];
}
fn hierarchyGas(p:vec3<f32>)->Gas{
 let slot=leafAt(p);if(slot==0xffffffffu){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let n=bricks[slot];let q=(p-n.loPitch.xyz)/n.loPitch.w-.5;let base=floor(q);let f=fract(q);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let pos=n.loPitch.xyz+(base+vec3<f32>(f32(x),f32(y),f32(z))+.5)*n.loPitch.w;
  let value=nearestGas(pos);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));a+=value.a*w.x*w.y*w.z;b+=value.b*w.x*w.y*w.z;
 }}}return Gas(a,b);
}
@compute @workgroup_size(64) fn migrateBricks(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) l:u32){
 let index=group.x+group.y*groups.x;if(index>=arrayLength(&work)){return;}let slot=work[index];let n=bricks[slot];let r=remaps[slot];let p=n.loPitch.xyz+(vec3<f32>(localCell(l))+.5)*n.loPitch.w;
 if(r.source.x==0xffffffffu){
  // First activation imports the existing evolved world material.
  hout[slot*64u+l]=gas(p);return;
 }
 let c=vec3<u32>(clamp(floor((p-r.loPitch.xyz)/r.loPitch.w),vec3<f32>(0),vec3<f32>(3)));
 hout[slot*64u+l]=hin[r.source.x*64u+localIndex(c)];
}
@compute @workgroup_size(64) fn advanceBricks(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) l:u32){
 let index=group.x+group.y*groups.x;if(index>=arrayLength(&work)){return;}let slot=work[index];let n=bricks[slot];let p=n.loPitch.xyz+(vec3<f32>(localCell(l))+.5)*n.loPitch.w;
 var r=Gas(vec4<f32>(0),vec4<f32>(0));
 if(donor(p)){r=fineGasAt(p,n.loPitch.w);}else{
  r=hierarchyGas(clipped(p,p-velocity(p)*u.time.y));
  if(reactantLawOn()){
   let dt=u.time.x;
   let w=min(.16,max(0.0,u.reactant_combustion_a.w*dt*pow(u.material.w/n.loPitch.w,2.0)));
   var neighbors=vec4<f32>(0);var momentNeighbors=vec3<f32>(0);
   for(var a=0u;a<3u;a++){
    let off=vec3<f32>(axis(a))*n.loPitch.w;let plus=hierarchyGas(clipped(p,p+off));let minus=hierarchyGas(clipped(p,p-off));
    neighbors+=plus.a+minus.a;momentNeighbors+=plus.b.yzw+minus.b.yzw;
   }
   r.a=max(vec4<f32>(0),r.a*(1.0-6.0*w)+neighbors*w);
   r.b=vec4<f32>(r.b.x,max(vec3<f32>(0),r.b.yzw*(1.0-6.0*w)+momentNeighbors*w));
   let burned=reactantBurn(r.a.z,r.a.w,r.a.y,dt);
   let cooling=reactantCoolingSurvival(dt);let survival=reactantSootSurvival(dt);
   let moments=(shiftThermalMoments(r.b.yzw,r.a.x,burned.z-r.a.y,cooling)+thermalMoments(burned.w*u.reactant_combustion_b.z,burned.z*cooling))*survival;
   r.a=vec4<f32>((r.a.x+burned.w*u.reactant_combustion_b.z)*survival,burned.z*cooling,burned.x,burned.y);
   let burnout=sootBurnoutSurvival(r.a.y,r.a.w,dt);r.a.x*=burnout;
   r.b=vec4<f32>(burned.w/max(dt,1e-6),moments*burnout);
  }else{let cooling=pow(.982,u.time.x);let survival=pow(.990,u.time.x);r.b=vec4<f32>(0,shiftThermalMoments(r.b.yzw,r.a.x,0,cooling)*survival);r.a.x*=survival;r.a.y*=cooling;}
 }
 if(u.bridgeMaterial.w>0.0){let weight=bridgeWeight(p);if(weight>0.0){let upstream=bridgeMaterialSample(p);r=Gas(mix(r.a,upstream.a,weight),mix(r.b,upstream.b,weight));}}
 if(blocked(vec3<i32>(floor((p-u.lo.xyz)/u.flow.w)))){r=Gas(vec4<f32>(0),vec4<f32>(0));}
 hout[slot*64u+l]=r;
}
@compute @workgroup_size(64) fn restrictBricks(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) l:u32){
 let index=group.x+group.y*groups.x;if(index>=arrayLength(&work)){return;}let slot=work[index];let n=bricks[slot];let c=localCell(l);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  let q=2u*c+vec3<u32>(x,y,z);let oct=q/4u;let child=childSlot(n,oct.x+2u*(oct.y+2u*oct.z));
  let r=hout[child*64u+localIndex(q%4u)];a+=r.a*.125;b+=r.b*.125;
 }}}hout[slot*64u+l]=Gas(a,b);
}
@compute @workgroup_size(4,4,4) fn exportBricks(@builtin(global_invocation_id) gid:vec3<u32>){
 let c=vec3<i32>(gid);if(!inside(c,u.material.xyz)){return;}
 // Root cells already hold the exact volume restriction of their descendants.
 // The dense flow/render consumer must receive that average, not one fine tap.
 let root=gid/4u;let slot=root.x+u32(h.base.x)*(root.y+u32(h.base.y)*root.z);
 let r=hin[slot*64u+localIndex(gid%4u)];
 gout[idx(c,u.material.xyz)]=r;
 textureStore(optical,c,vec4<f32>(r.a.xyz,r.b.x));
 textureStore(optical,c+vec3<i32>(0,0,i32(u.material.z)),vec4<f32>(r.b.yzw,0));
 if(u.pressureControl.z>.5){textureStore(exportedGas,c,r.a);}
}
var<workgroup> signal:array<vec4<f32>,64>;
var<workgroup> motion:array<vec4<f32>,64>;
@compute @workgroup_size(64) fn measureBricks(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_index) l:u32){
 let index=group.x+group.y*groups.x;if(index>=arrayLength(&work)){return;}let slot=work[index];let n=bricks[slot];let p=n.loPitch.xyz+(vec3<f32>(localCell(l))+.5)*n.loPitch.w;let r=hin[slot*64u+l];
 var grad=vec4<f32>(0);var opportunity=0.0;
 for(var a=0u;a<3u;a++){
  let off=vec3<f32>(axis(a))*n.loPitch.w;let plus=hierarchyGas(p+off).a;let minus=hierarchyGas(p-off).a;
  grad+=abs(plus-minus)/(2.0*n.loPitch.w);
  opportunity=max(opportunity,min(max(plus.z,minus.z),max(plus.w,minus.w)/max(u.reactant_combustion_b.x,1e-6))*smoothstep(.1,.3,max(plus.y,minus.y)));
 }
 // Fixed material/physical units; no frame-maximum normalization.
 signal[l]=vec4<f32>(r.b.x/.04,opportunity,grad.y,grad.x);
 motion[l]=vec4<f32>(abs(velocity(p)),0);workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(l<stride){signal[l]+=signal[l+stride];motion[l]=max(motion[l],motion[l+stride]);}workgroupBarrier();}
 if(l==0u){demand[slot*2u]=signal[0]/64.0;demand[slot*2u+1u]=motion[0];}
}
`;}

export function createMaterialHierarchyGPU(device,plan,worldCode,options={}){
 const topology=new MaterialHierarchy({dims:plan.materialDims,options});
 admission(topology.capacity);
 const S=GPUBufferUsage.STORAGE,D=GPUBufferUsage.COPY_DST,C=GPUBufferUsage.COPY_SRC;
 const module=device.createShaderModule({label:'adaptive material hierarchy',code:hierarchyWGSL(worldCode)});
 const pipelines=Object.fromEntries(['migrateBricks','advanceBricks','restrictBricks','exportBricks','measureBricks'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module,entryPoint}})]));
 let current=0,storage=null,pending=true,initialized=false,destroyed=false,reading=false,error=null,revision=0,steps=0,latestSignals=new Map(),lastPlan=null,transportClock=0,demandLag=0,diagnostics={levels:[],bricks:[]};
 const buffer=(label,size,usage=S|D|C)=>device.createBuffer({label,size:Math.max(4,size),usage});
 const params=buffer('hierarchy parameters',48,GPUBufferUsage.UNIFORM|D);
 function admission(capacity,options=topology.options){const magnitude=Math.max(1,...plan.min.map(Math.abs),...plan.max.map(Math.abs));if(plan.materialPitch/2**options.maxDetail<magnitude*2**-22)throw Error('Maximum detail exceeds f32 position precision for this world field');const bytes=capacity*64*32;if(!Number.isSafeInteger(bytes)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Material pool exceeds GPU storage limits');}
 function makeStorage(capacity){admission(capacity);return {capacity,fields:[buffer('material pool A',capacity*64*32),buffer('material pool B',capacity*64*32)],meta:buffer('material brick topology',capacity*64),remap:buffer('material remapping',capacity*32),demand:buffer('material refinement demand',capacity*32)};}
 function release(s){if(s)for(const b of [...s.fields,s.meta,s.remap,s.demand])b.destroy();}
 const ownedLists=[];
 function list(nodes){const b=buffer('material brick work',nodes.length*4);device.queue.writeBuffer(b,0,new Uint32Array(nodes.map(n=>n.slot)));ownedLists.push(b);return b;}
 let lists=null;
 function dispatch(encoder,name,count,world,items){
  if(!count)return;
  const pipeline=pipelines[name];
  const bindings={migrateBricks:[0,4,9],advanceBricks:[0,1,2,8,9,11,14,15],restrictBricks:[],exportBricks:[0,5,10,16],measureBricks:[0,2,9,11]}[name];
  const pass=encoder.beginComputePass({label:name});pass.setPipeline(pipeline);
  pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:world[binding]}))}));
  pass.setBindGroup(1,device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:items.map(([binding,b])=>({binding,resource:{buffer:b}}))}));
  if(name==='exportBricks')pass.dispatchWorkgroups(...plan.materialDims.map(n=>Math.ceil(n/4)));else {const width=Math.min(count,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(width,Math.ceil(count/width));}
  pass.end();
 }
 function stage(encoder,world){
  const previous=lastPlan?.nodes??[],oldByKey=new Map(previous.map(n=>[n.key,n]));
  const signals=lastPlan?predictDemand(lastPlan.nodes,latestSignals,{dims:plan.materialDims,basePitch:plan.materialPitch,horizon:topology.options.lookahead*demandLag}):latestSignals;
  const next=topology.allocate(signals);admission(next.capacity);const nextByKey=new Map(next.nodes.map(n=>[n.key,n]));
  if(initialized&&storage.capacity===next.capacity&&previous.length===next.nodes.length&&next.nodes.every(n=>{const old=oldByKey.get(n.key);return old&&old.slot===n.slot&&JSON.stringify(old.childSlots)===JSON.stringify(n.childSlots);})){for(const n of next.nodes){const old=oldByKey.get(n.key);n.lo=old.lo;n.pitch=old.pitch;}lastPlan=next;pending=false;return;}
  const old=storage;if(!storage||storage.capacity!==next.capacity)storage=makeStorage(next.capacity);
  const meta=new ArrayBuffer(next.capacity*64),f=new Float32Array(meta),ui=new Uint32Array(meta),remap=new ArrayBuffer(next.capacity*32),rf=new Float32Array(remap),ru=new Uint32Array(remap);
  for(const n of next.nodes){
   const pitch=plan.materialPitch/2**n.level,lo=n.c.map((v,a)=>plan.min[a]+v*4*pitch);n.lo=lo;n.pitch=pitch;
   f.set([...lo,pitch],n.slot*16);ui.set(n.childSlots??Array(8).fill(0xffffffff),n.slot*16+4);ui.set([n.parentSlot,n.level,n.children?0:1,0],n.slot*16+12);
   let ancestor=n;
   while(ancestor&&!oldByKey.has(ancestor.key)){if(!ancestor.parent){ancestor=null;break;}ancestor=nextByKey.get(ancestor.parent);}
   const source=ancestor?oldByKey.get(ancestor.key):null;
   ru[n.slot*8]=source?.slot??0xffffffff;rf.set(source?[...source.lo,source.pitch]:[0,0,0,1],n.slot*8+4);
  }
  device.queue.writeBuffer(storage.meta,0,meta);device.queue.writeBuffer(storage.remap,0,remap);
  device.queue.writeBuffer(params,0,new Float32Array([...plan.materialDims.map(n=>Math.ceil(n/4)),plan.materialPitch,...plan.min,0,0,0,0,0]));
  const obsolete=ownedLists.splice(0);lists={all:list(next.nodes),leaves:list(next.leaves),levels:[]};
  for(let level=Math.max(0,...next.nodes.map(n=>n.level))-1;level>=0;level--){const nodes=next.nodes.filter(n=>n.level===level&&n.children);lists.levels.push({buffer:list(nodes),count:nodes.length});}
  const target=storage===old?1-current:0;
  dispatch(encoder,'migrateBricks',next.nodes.length,world,[[0,storage.meta],[1,old?.fields[current]??storage.fields[1]],[2,storage.fields[target]],[3,lists.all],[4,storage.remap]]);
  current=target;lastPlan=next;pending=false;initialized=true;revision++;
  const counts=new Map();for(const n of next.leaves)counts.set(n.level,(counts.get(n.level)??0)+1);
  diagnostics={levels:[...counts].sort((a,b)=>a[0]-b[0]).map(([level,bricks])=>({level,bricks})),bricks:next.leaves.map(n=>({key:n.key,level:n.level,min:n.lo,width:n.pitch*4}))};
  // Buffers are retired only after the submission that consumes them completes.
  const replacement=storage;queueMicrotask(()=>device.queue.onSubmittedWorkDone().then(()=>{for(const b of obsolete)b.destroy();if(old&&old!==replacement)release(old);}));
 }
 return {
  configure(patch){const next=validateAllocation({...topology.options,...patch,weights:{...topology.options.weights,...patch.weights}});const capacity=topology.roots.length+8*Math.floor(topology.roots.length*next.budget/8);admission(capacity,next);topology.options=next;pending=true;return this.read();},
  encode(encoder,world,backtraceScale=0){
   transportClock+=Math.abs(backtraceScale);
   if(destroyed)throw Error('Material hierarchy disposed');
   if(pending||!initialized)stage(encoder,world);
   dispatch(encoder,'advanceBricks',lastPlan.leaves.length,world,[[0,storage.meta],[1,storage.fields[current]],[2,storage.fields[1-current]],[3,lists.leaves],[6,params]]);
   current=1-current;
   for(const level of lists.levels)dispatch(encoder,'restrictBricks',level.count,world,[[0,storage.meta],[2,storage.fields[current]],[3,level.buffer]]);
   dispatch(encoder,'exportBricks',1,world,[[1,storage.fields[current]],[6,params]]);
   steps++;
   if(!reading){
    dispatch(encoder,'measureBricks',lastPlan.nodes.length,world,[[0,storage.meta],[1,storage.fields[current]],[3,lists.all],[5,storage.demand],[6,params]]);
    const bytes=storage.capacity*32,staging=buffer('material demand readback',bytes,D|GPUBufferUsage.MAP_READ),snapshot=lastPlan.nodes.map(n=>({key:n.key,slot:n.slot})),epoch=revision,sampleClock=transportClock,sampleStep=Math.abs(backtraceScale);
    encoder.copyBufferToBuffer(storage.demand,0,staging,0,bytes);reading=true;
    // mapAsync must follow submission; a microtask is sufficient for the normal
    // synchronous encode/submit caller and does not block the simulation loop.
    queueMicrotask(async()=>{try{await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange());if(!destroyed&&epoch===revision){latestSignals=new Map(snapshot.map(n=>[n.key,{reaction:data[n.slot*8],mixing:data[n.slot*8+1],thermal:data[n.slot*8+2],smoke:data[n.slot*8+3],motion:Array.from(data.subarray(n.slot*8+4,n.slot*8+7))}]));for(const signal of latestSignals.values())if(Object.values(signal).flat().some(v=>!Number.isFinite(v)))throw Error('Non-finite GPU allocation demand');demandLag=Math.max(sampleStep,transportClock-sampleClock+sampleStep);pending=true;}staging.unmap();}catch(e){if(!destroyed)error=e.message;}finally{staging.destroy();reading=false;}});
   }
  },
  async snapshot(){
   if(!storage)return null;
   const b=buffer('material hierarchy diagnostic',storage.fields[current].size,D|GPUBufferUsage.MAP_READ);const e=device.createCommandEncoder();e.copyBufferToBuffer(storage.fields[current],0,b,0,b.size);device.queue.submit([e.finish()]);
   try{await b.mapAsync(GPUMapMode.READ);return {nodes:lastPlan.nodes.map(n=>({...n})),values:Array.from(new Float32Array(b.getMappedRange())),dims:plan.materialDims,pitch:plan.materialPitch};}finally{b.destroy();}
  },
  read(){return {identity:'pooled-material-hierarchy-v1',options:structuredClone(topology.options),baseDims:plan.materialDims,steps,revision,allocatedBricks:lastPlan?.nodes.length??0,leafBricks:lastPlan?.leaves.length??0,capacity:storage?.capacity??topology.capacity,estimatedCellWork:lastPlan?.cost??0,materialBytes:(storage?.capacity??topology.capacity)*64*32*2,demandRoute:'asynchronous-per-brick-GPU-reduction',predictionTransportInterval:demandLag,renderMaterialDims:plan.materialDims,error,...diagnostics};},
  destroy(){destroyed=true;release(storage);params.destroy();for(const b of ownedLists)b.destroy();},
 };
}
