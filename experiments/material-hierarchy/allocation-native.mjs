import {allocationWGSL,allocationLayout} from '../../volume-material-allocation-gpu.mjs';
import {MaterialHierarchy,predictDemand} from '../../volume-material-hierarchy.mjs';
import {sourceDemandAt} from '../../volume-world-sources.mjs';
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();if(adapter?.info.vendor!=='apple'||adapter.info.isFallbackAdapter)throw Error('Native Apple GPU required');
 const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:8}}),errors=[],owned=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');let scopeOpen=true;
 const r={adapter:{vendor:adapter.info.vendor},cases:[],errors};
 try{
  const module=device.createShaderModule({code:allocationWGSL(2)});r.compilation=(await module.getCompilationInfo()).messages.map(x=>({type:x.type,message:x.message,line:x.lineNum}));if(r.compilation.some(x=>x.type==='error'))throw Error('Allocation shader compilation failed');
  const scenarios=[
   [{dims:[8,4,4],budget:8,maxDetail:2,source:false}],
   [{dims:[8,4,4],budget:8,maxDetail:2,source:true}],
   [{dims:[6,5,4],budget:8,maxDetail:2,source:true}],
   [{dims:[8,4,4],budget:8,maxDetail:0,source:true}],
   [{dims:[8,4,4],budget:8,maxDetail:2,spread:1e-8,source:true}],
   [{dims:[8,4,4],budget:8,maxDetail:2,source:true},{budget:8,maxDetail:2,source:false,motion:1},{budget:8,maxDetail:2,source:false,motion:1},{budget:0,maxDetail:1,source:false,motion:1},{budget:12,maxDetail:2,source:true,motion:1},{budget:4,maxDetail:0,source:false,motion:0}],
  ];
  for(const scenario of scenarios){
   let prior=null,cpu;
   for(const [step,patch] of scenario.entries()){
    const configuration={...scenario[0],...patch},options={budget:configuration.budget,maxDetail:configuration.maxDetail,spread:configuration.spread??1,persistence:.2};
    if(!cpu)cpu=new MaterialHierarchy({dims:configuration.dims,options});else cpu.options={...cpu.options,...options};
    const previousNodes=cpu.nodes,signals=new Map(previousNodes.filter(n=>!n.children).map(n=>[n.key,{reaction:(n.slot+1)*.137,mixing:0,thermal:(n.slot+1)*.011,smoke:0,motionMin:[configuration.motion??0,0,0],motionMax:[configuration.motion??0,0,0]}]));
    const predicted=prior?predictDemand(previousNodes,signals,{dims:configuration.dims,basePitch:1,horizon:1}):new Map();
    const cap=cpu.capacity,l=allocationLayout(cap,options.maxDetail),supports=configuration.source?[{lo:[0,0,0],hi:[1,1,1],heat:1,fuel:1}]:[];
    const plan={materialDims:configuration.dims,materialPitch:1,min:[0,0,0]},expected=cpu.allocate(predicted,n=>sourceDemandAt(n,supports,plan));
    const make=(size,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
    const params=make(112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),oldNodes=prior?.nodes??make(64),oldState=prior?.state??make(64),prediction=make(Math.max(prior?.cap??0,cap)*16),measured=make(Math.max(1,prior?.cap??1)*48),nodes=make(cap*64),state=make(l.words*4),scratch=make(cap*96),support=make(48);
    if(prior){const data=new Float32Array(prior.cap*12);for(const n of previousNodes.filter(n=>!n.children)){const a=signals.get(n.key);data.set([a.reaction,a.mixing,a.thermal,a.smoke,...a.motionMin,0,...a.motionMax,0],n.slot*12);}device.queue.writeBuffer(measured,0,data);}
    const data=new ArrayBuffer(112),u=new Uint32Array(data),f=new Float32Array(data);u.set([...configuration.dims,cpu.roots.length]);f.set([0,0,0,1],4);f.set([options.spread,.2,1,1],8);f.set([1,1,.5,.25],12);u.set([cap,prior?.cap??0,supports.length,options.maxDetail],16);u.set([l.all,l.leaves,l.levels,l.stride],20);u.set([l.heap,l.occupied,device.limits.maxComputeWorkgroupsPerDimension,0],24);device.queue.writeBuffer(params,0,data);if(supports.length)device.queue.writeBuffer(support,0,new Float32Array([0,0,0,0,1,1,1,0,1,1,0,0]));
    const buffers=[params,oldNodes,oldState,measured,prediction,nodes,state,scratch,support];
    const encoder=device.createCommandEncoder();
    for(const [entry,ids,count]of [['predictAllocation',[0,1,2,3,4],Math.ceil((prior?.cap??1)/64)],['reduceAllocationPrediction',[1,2,4],1],['planAllocation',[0,1,2,4,5,6,7,8],1]]){
     const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:entry}}),entries=ids.map(binding=>({binding,resource:{buffer:buffers[binding]}})),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);pass.end();
    }
    const copy=make(state.size+nodes.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);encoder.copyBufferToBuffer(state,0,copy,0,state.size);encoder.copyBufferToBuffer(nodes,0,copy,state.size,nodes.size);device.queue.submit([encoder.finish()]);await copy.mapAsync(GPUMapMode.READ);const raw=copy.getMappedRange().slice(0);copy.unmap();const words=new Uint32Array(raw),floats=new Float32Array(raw),actual=[];
    for(let i=0;i<words[0];i++){const slot=words[l.all+i],base=state.size/4+slot*16;actual.push({slot,lo:Array.from(floats.subarray(base,base+3)),pitch:floats[base+3],level:words[base+13],children:words[base+4]===0xffffffff?null:Array.from(words.subarray(base+4,base+12))});}
    const result={configuration,step,capacity:cap,header:Array.from(words.subarray(0,32)),actual,expected:expected.nodes.map(n=>({slot:n.slot,lo:n.c.map(v=>v*4/2**n.level),pitch:1/2**n.level,level:n.level,children:n.childSlots}))};r.cases.push(result);
    if(JSON.stringify(result.actual)!==JSON.stringify(result.expected))throw Error('GPU allocation differs from CPU reference');
    prior={cap,nodes,state};
   }
  }
  const validation=await device.popErrorScope();scopeOpen=false;if(validation)errors.push(validation.message);if(errors.length)throw Error(errors.join('\n'));return r;
 }catch(e){if(scopeOpen){const validation=await device.popErrorScope();if(validation)errors.push(validation.message);}return{...r,failed:true,error:e.stack};}finally{for(const b of owned)b.destroy();device.destroy();}
}
