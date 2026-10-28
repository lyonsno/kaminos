import {kernel} from './kernels.mjs';
import {activeBricks,compareFields} from './model.mjs';
export async function run(configs, persist) {
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter||adapter.info.vendor!=='apple'||adapter.isFallbackAdapter||!adapter.features.has('timestamp-query'))throw Error('Native Apple GPU with timestamp-query required');
 const device=await adapter.requestDevice({requiredFeatures:['timestamp-query']});
 const result={adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,fallback:adapter.isFallbackAdapter??false},rows:[],errors:[]};
 device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
 device.pushErrorScope('validation');
 const S=GPUBufferUsage.STORAGE, C=GPUBufferUsage.COPY_SRC, D=GPUBufferUsage.COPY_DST;
 try {
 for(const c of configs) {
  if(c.size%c.brick)throw Error('fixture size must divide brick size');
  const activeSchedule=Array.from({length:c.steps+1},(_,s)=>activeBricks(c,s));
  const capacity=Math.max(...activeSchedule.map(a=>a.length)),q=c.size/c.brick,pages=q**3,brickCells=c.brick**3;
  const owned=[];
  const buffer=(size,usage,data)=>{const b=device.createBuffer({size:Math.max(size,4),usage});owned.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;};
  const boxes=new Int32Array(c.boxes.flatMap(b=>[...b.lo,0,...b.hi,0]));
  const boxBuffer=buffer(boxes.byteLength,S|D,boxes);
  const steps=Array.from({length:c.steps+1},(_,s)=>buffer(16,GPUBufferUsage.UNIFORM|D,new Uint32Array([s,0,0,0])));
  const paths={};
  for(const sparse of [false,true]){
   const module=device.createShaderModule({code:kernel(c,capacity,sparse)}), info=await module.getCompilationInfo();
   if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages.map(m=>({type:m.type,message:m.message,line:m.lineNum}))));
   const update=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'update'}});
   const allocate=sparse?await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'allocate'}}):null;
   const reset=sparse?await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'reset'}}):null;
   const fieldSize=(sparse?capacity*brickCells:c.size**3)*16;
   const fields=[0,1].map(()=>buffer(fieldSize,S|C));
   const maps=[0,1].map(()=>buffer(pages*4,S|C));
   const ids=buffer(capacity*4,S), count=buffer(16,S|C|D|GPUBufferUsage.INDIRECT);
   const group=(pipeline,items)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:items.map(([binding,b])=>({binding,resource:{buffer:b}}))});
   const updates=steps.map((step,s)=>group(update,[[0,fields[1-s%2]],[1,fields[s%2]],...(sparse?[[2,maps[1-s%2]],[4,ids]]:[]),[6,boxBuffer],[7,step]]));
   const allocations=sparse?steps.map((step,s)=>group(allocate,[[3,maps[s%2]],[4,ids],[5,count],[6,boxBuffer],[7,step]])):[];
   const resets=sparse?group(reset,[[5,count]]):null;
   paths[sparse?'sparse':'dense']={reset,resets,sparse,fields,maps,ids,count,update,allocate,updates,allocations,fieldSize};
  }
  const query=device.createQuerySet({type:'timestamp',count:(c.steps+1)*6});
  const resolve=buffer((c.steps+1)*6*8,GPUBufferUsage.QUERY_RESOLVE|C);
  const read=async b=>{const target=device.createBuffer({size:b.size,usage:D|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,target,0,b.size);device.queue.submit([e.finish()]);await target.mapAsync(GPUMapMode.READ);const data=target.getMappedRange().slice(0);target.unmap();return data;}finally{target.destroy();}};
  const execute=async(path)=>{
   const e=device.createCommandEncoder();
   for(let s=0;s<=c.steps;s++){
    const base=s*6+(path.sparse?0:4);
    const pass=(pipeline,group,start)=>{const p=e.beginComputePass({timestampWrites:{querySet:query,beginningOfPassWriteIndex:start,endOfPassWriteIndex:start+1}});p.setPipeline(pipeline);p.setBindGroup(0,group);return p;};
    if(path.sparse){
     const r=e.beginComputePass({timestampWrites:{querySet:query,beginningOfPassWriteIndex:base}});r.setPipeline(path.reset);r.setBindGroup(0,path.resets);r.dispatchWorkgroups(1);r.end();
     const p=e.beginComputePass({timestampWrites:{querySet:query,endOfPassWriteIndex:base+1}});p.setPipeline(path.allocate);p.setBindGroup(0,path.allocations[s]);p.dispatchWorkgroups(Math.ceil(pages/64));p.end();
    }
    const p=pass(path.update,path.updates[s],base+(path.sparse?2:0));
    if(path.sparse)p.dispatchWorkgroupsIndirect(path.count,0);else p.dispatchWorkgroups(pages);
    p.end();
   }
   const t=performance.now();device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
   return performance.now()-t;
  };
  const row={config:c,capacity,activeSchedule:activeSchedule.map(a=>a.length),reservedFieldBytes:capacity*brickCells*16*2,denseFieldBytes:c.size**3*16*2,mapBytes:pages*4*2,samples:[]};
  try {
   for(let rep=-1;rep<c.repeats;rep++){
    const order=rep%2===0?['sparse','dense']:['dense','sparse'];const wall={};
    for(const name of order)wall[name]=await execute(paths[name]);
    const e=device.createCommandEncoder();e.resolveQuerySet(query,0,(c.steps+1)*6,resolve,0);device.queue.submit([e.finish()]);
    const times=new BigUint64Array(await read(resolve));
    const dense=new Float32Array(await read(paths.dense.fields[c.steps%2]));
    const packed=new Float32Array(await read(paths.sparse.fields[c.steps%2]));
    const map=new Uint32Array(await read(paths.sparse.maps[c.steps%2]));
    const count=new Uint32Array(await read(paths.sparse.count));
    const rebuilt=new Float32Array(dense.length);const used=new Set();
    for(let id=0;id<pages;id++){
     const slot=map[id];if(slot===0xffffffff)continue;
     if(slot>=capacity||used.has(slot))throw Error('Invalid/duplicate sparse slot');used.add(slot);
     const origin=[id%q,Math.floor(id/q)%q,Math.floor(id/(q*q))].map(v=>v*c.brick);
     for(let l=0;l<brickCells;l++){
      const x=origin[0]+l%c.brick,y=origin[1]+Math.floor(l/c.brick)%c.brick,z=origin[2]+Math.floor(l/(c.brick*c.brick));
      rebuilt.set(packed.subarray((slot*brickCells+l)*4,(slot*brickCells+l+1)*4),(x+c.size*(y+c.size*z))*4);
     }
    }
    const observed=Array.from(map).flatMap((v,i)=>v===0xffffffff?[]:[i]);
    if(JSON.stringify(observed)!==JSON.stringify(activeSchedule[c.steps]))throw Error('GPU active map differs from support');
    const sample={order,wallMs:wall,parity:compareFields(dense,rebuilt),active:count[0],overflow:count[3],allocationMs:[],sparseUpdateMs:[],denseMs:[]};
    for(let s=1;s<=c.steps;s++)for(const [key,offset]of [['allocationMs',0],['sparseUpdateMs',2],['denseMs',4]])sample[key].push(Number(times[s*6+offset+1]-times[s*6+offset])/1e6);
    // Warmup executes the identical full sequence and is retained separately.
    if(rep<0)row.warmup=sample;else row.samples.push(sample);
    if(rep===c.repeats-1){
     if(!persist)throw Error('Raw binary sink required');
     row.rawBytes={dense:dense.byteLength,packed:packed.byteLength,map:map.byteLength};
     for(const [field,values] of Object.entries({dense,packed,map}))await persist(`${c.name}-${c.brick}-${field}.bin`,values);
    }
   }
   result.rows.push(row);
  }finally{query.destroy();for(const b of owned)b.destroy();}
 }
 result.validation=(await device.popErrorScope())?.message??null;
 return result;
 }finally{device.destroy();}
}
