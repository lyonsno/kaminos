import {REGION_WGSL} from './region-shader.mjs';
import {SLAB_WGSL,packSlabDispatch} from './slab-shader.mjs';
import {retainRegionState} from './regions.mjs';
export const MAX_CONNECTEDNESS=16;

export async function createRegionSolver({device,state,bodyBuffer=null,iterations=6,dt=1/480,gravity=9.81,friction=.65,damping=1.5,shaderCode=state.slabSize?SLAB_WGSL:REGION_WGSL}){
 if(!device||!Number.isSafeInteger(iterations)||iterations<1||!(dt>0&&Number.isFinite(dt))||![gravity,friction,damping].every(x=>Number.isFinite(x)&&x>=0))throw Error('Valid GPU device and physical solver settings required');
 const owned=[],count=state.floats.length/24,grainCount=state.grainCount,cell=state.radius*4.2,materialColors=state.materialColors??0,slots=materialColors+1;
 const slab=state.slabSize?packSlabDispatch(state):null;
 const faceWords=slab?.words??state.triangles;
 let maxGritReach=0;
 if(slab)for(let i=0;i<state.mineralCount;i++){
  const o=i*24,f=state.floats;
  maxGritReach=Math.max(maxGritReach,Math.abs(f[o+16])+f[o+11],Math.abs(f[o+17])+f[o+15]);
 }
 let disposed=false,pending=false,failure=null,stepsDone=state.physicalSteps??0,capturing=0,lastTool=state.lastTool?[...state.lastTool]:[0,0,0,0],capacity=1,uniform,group,completion=Promise.resolve();
 const dims=[Math.ceil(state.width/cell),Math.ceil(state.floats.reduce((h,v,i)=>i%24===1?Math.max(h,v):h,0)/cell)+8,Math.ceil(state.depth/cell)],cells=dims.reduce((a,b)=>a*b,1);
 const allocate=(size,label,usage=GPUBufferUsage.STORAGE)=>{if(size>device.limits.maxStorageBufferBindingSize||size>device.limits.maxBufferSize)throw Error(label+' exceeds effective GPU buffer capacity');const b=device.createBuffer({size:Math.max(16,size),usage:usage|GPUBufferUsage.COPY_DST|((usage&GPUBufferUsage.MAP_READ)?0:GPUBufferUsage.COPY_SRC),label});owned.push(b);return b;};
 let bodies=bodyBuffer;
 const uncaptured=e=>{failure=e.error?.message??'Earth GPU error';};device.addEventListener?.('uncapturederror',uncaptured);
 device.lost.then(info=>{if(!disposed)failure=info.message||'Earth GPU device lost';});
 try{
  device.pushErrorScope('validation');
  bodies??=allocate(state.floats.byteLength,'Earth resident Lagrangian bodies');device.queue.writeBuffer(bodies,0,state.floats);
  const regionLinks=allocate(state.linkWords.byteLength,'Persistent regional connection history'),regionControl=allocate(48,'Regional hand and connection controls',GPUBufferUsage.UNIFORM);device.queue.writeBuffer(regionLinks,0,state.linkWords);let strength=1,gripDelta=[0,0,0],gripGain=1,damageRate=18;const updateControls=()=>device.queue.writeBuffer(regionControl,0,new Float32Array([strength,damageRate,1,maxGritReach,...gripDelta,state.mineralCount,gripGain,0,0,0]));updateControls();
  const before=allocate(state.floats.byteLength,'Earth preceding bodies'),heads=allocate(cells*(slab?8:4),'Earth complete grain spatial buckets'),next=allocate(Math.max(1,grainCount+(slab?state.mineralCount:0))*4,'Earth bucket linked list'),delta=allocate(count*32,'Earth reciprocal contact corrections'),tets=allocate(state.tets.byteLength,'Earth retained plastic material'),faces=allocate(faceWords.byteLength,'Earth actual boundary triangles'),ties=allocate(state.ties.byteLength,'Earth coarse fine transitions');
  device.queue.writeBuffer(tets,0,state.tets);device.queue.writeBuffer(faces,0,faceWords);device.queue.writeBuffer(ties,0,state.ties);
  const layout=device.createBindGroupLayout({entries:[0,1,2,3,4,5,6,7,8,9].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7||binding===9?'uniform':binding===6?'read-only-storage':'storage',...(binding===7?{hasDynamicOffset:true,minBindingSize:96}:{})}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const mod=device.createShaderModule({label:'Live earth contacts and yielding material',code:shaderCode});const errors=(await mod.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.lineNum+': '+m.message).join('\n'));
  const stages=['predict','clear','index','grainContacts','materialContacts','formingContacts','material','transition','apply','finish','plastic','regionDamage','regionConstraints',...(slab?['indexHard']:[])],pipelines={};for(const entryPoint of stages)pipelines[entryPoint]=await device.createComputePipelineAsync({label:'Earth '+entryPoint,layout:pipelineLayout,compute:{module:mod,entryPoint}});
  const buffers=[bodies,before,heads,next,delta,tets,faces,null,regionLinks,regionControl];
  function reserve(n){if(uniform&&n<=capacity)return;const old=uniform;capacity=Math.max(n,capacity*2);uniform=allocate(capacity*256,'Earth chronological step parameters',GPUBufferUsage.UNIFORM);buffers[7]=uniform;group=device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer,...(binding===7?{size:96}:{})}}))});old?.destroy();}
  reserve(1);const validation=await device.popErrorScope();if(validation)throw Error(validation.message);
  const encodeStage=(encoder,name,n,step)=>{if(!n)return;const pass=encoder.beginComputePass({label:'Earth '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group,[step*256]);const groups=Math.ceil(n/64),limit=device.limits.maxComputeWorkgroupsPerDimension;if(groups>limit)throw Error('Earth dispatch exceeds GPU one-dimensional workgroups');pass.dispatchWorkgroups(groups);pass.end();};
  async function copy(buffer){const read=allocate(buffer.size,'Earth explicit snapshot readback',GPUBufferUsage.MAP_READ);try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,read,0,buffer.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);return new Float32Array(read.getMappedRange()).slice();}finally{read.unmap();read.destroy();owned.splice(owned.indexOf(read),1);}}
  return {bodies,tets,
   control(value={}){if(value.strength!==undefined){if(!Number.isFinite(value.strength)||value.strength<0||value.strength>MAX_CONNECTEDNESS)throw Error('Connectedness must be between 0 and '+MAX_CONNECTEDNESS);strength=value.strength;}if(value.gripDelta!==undefined){if(value.gripDelta.length!==3||!value.gripDelta.every(Number.isFinite))throw Error('Finite grip displacement required');gripDelta=[...value.gripDelta];}if(value.gripGain!==undefined){if(!Number.isFinite(value.gripGain)||value.gripGain<.5||value.gripGain>1.25)throw Error('Grip gain must be between 0.5 and 1.25');gripGain=value.gripGain;}updateControls();},
   async connectionState(){await completion;const links=await copy(regionLinks);const result=[];for(let j=0;j<state.connections.length;j++){const i=state.attachments.length+j;result.push({damage:links[i*16+14],rest:links[i*16+13]});}return result;},
   configuration:{dt,iterations,gravity,friction,damping,cell,dims},
   advance({steps=1,tool=null}={}){
    if(disposed||failure)throw Error(failure||'Earth GPU disposed');if(pending||capturing)return false;if(!Number.isSafeInteger(steps)||steps<1)throw Error('Explicit positive step count required');
    const nextTool=tool?[...tool.position,tool.radius]:[0,0,0,0];if(nextTool.length!==4||!nextTool.every(Number.isFinite)||nextTool[3]<0)throw Error('Invalid material tool pose');reserve(steps*slots);
    const params=new ArrayBuffer(steps*slots*256);
    for(let s=0;s<steps;s++)for(let color=0;color<slots;color++){const offset=(s*slots+color)*256,u=new Uint32Array(params,offset,24),f=new Float32Array(params,offset,24);u.set([count,grainCount,state.material.tets.length,state.faceCount,...dims,slab&&color>0?slab.dispatches[color-1].offset:state.tieCount]);f.set([state.width,state.depth,cell,dt],8);const start=lastTool[3]>0?lastTool:nextTool;
     f.set(nextTool.map((x,k)=>start[k]+(x-start[k])*(s+1)/steps),12);f.set(nextTool.map((x,k)=>start[k]+(x-start[k])*s/steps),16);f.set([gravity,friction,damping,color-1],20);}
    device.queue.writeBuffer(uniform,0,params);const encoder=device.createCommandEncoder({label:'Live mixed earth physical steps'});
    for(let s=0;s<steps;s++){
     const step=s*slots;encodeStage(encoder,'predict',count,step);encodeStage(encoder,'regionDamage',state.linkWords.length/16,step);
     for(let iteration=0;iteration<iterations;iteration++){
      for(let color=0;color<materialColors;color++){
       encodeStage(encoder,'material',slab?.dispatches[color].count??state.material.tets.length,step+color+1);
      }
      encodeStage(encoder,'clear',Math.max(count,cells*(slab?2:1)),step);
      encodeStage(encoder,'index',grainCount,step);
      if(slab)encodeStage(encoder,'indexHard',state.mineralCount,step);
      encodeStage(encoder,'grainContacts',grainCount,step);
      encodeStage(encoder,'materialContacts',slab?state.faceCount:grainCount,step);
      encodeStage(encoder,'formingContacts',state.faceCount,step);
      encodeStage(encoder,'transition',state.tieCount,step);
      encodeStage(encoder,'regionConstraints',state.linkWords.length/16,step);
      encodeStage(encoder,'apply',count,step);
     }encodeStage(encoder,'finish',count,step);encodeStage(encoder,'plastic',state.material.tets.length,step);
    }
    device.queue.submit([encoder.finish()]);lastTool=nextTool;pending=true;
    completion=device.queue.onSubmittedWorkDone().then(()=>{stepsDone+=steps;}).catch(e=>{failure=String(e);}).finally(()=>{pending=false;});return true;
   },
   restart(){
    if(disposed||failure)throw Error(failure||'Earth GPU disposed');
    if(pending||capturing)throw Error('Finish the active solve or inspection before restarting');
    device.queue.writeBuffer(bodies,0,state.floats);
    device.queue.writeBuffer(tets,0,state.tets);
    device.queue.writeBuffer(regionLinks,0,state.linkWords);
    stepsDone=state.physicalSteps??0;
    lastTool=state.lastTool?[...state.lastTool]:[0,0,0,0];
    gripDelta=[0,0,0];gripGain=1;updateControls();
   },
   async wait(){await completion;if(failure)throw Error(failure);},
   async capture(){if(disposed||failure)throw Error(failure||'Earth GPU disposed');capturing++;await completion;if(failure){capturing--;throw Error(failure);}const read=allocate(bodies.size+tets.size,'Earth complete state snapshot',GPUBufferUsage.MAP_READ);try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(bodies,0,read,0,bodies.size);encoder.copyBufferToBuffer(tets,0,read,bodies.size,tets.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange(),floats=new Float32Array(bytes.slice(0,bodies.size)),plastic=new Float32Array(bytes.slice(bodies.size));if(failure)throw Error(failure);if(!floats.every(Number.isFinite)||!plastic.every(Number.isFinite))throw Error('Nonfinite GPU material state');return {...retainRegionState(state,floats,plastic,await copy(regionLinks)),physicalSteps:stepsDone,physicalTime:stepsDone*dt,lastTool:[...lastTool]};}finally{capturing--;read.unmap();read.destroy();owned.splice(owned.indexOf(read),1);}},

   read(){return {route:slab?'webgpu/peelable-slab/local-face-contact':'webgpu/two-local-material-lattices/compliant-particulates',regions:state.regionCount,connectionStrength:strength,bodies:count,grains:grainCount,materialPoints:state.material.nodes.length,tetrahedra:state.material.tets.length,surfaceTriangles:state.faceCount,transitionConstraints:state.tieCount,generation:state.material.generation,steps:stepsDone,simulatedSeconds:stepsDone*dt,pending,failure,configuration:this.configuration,runtimeReadbacks:0};},
   dispose(){if(disposed)return;disposed=true;device.removeEventListener?.('uncapturederror',uncaptured);for(const b of owned)b.destroy();}
  };
 }catch(error){try{await device.popErrorScope();}catch{}device.removeEventListener?.('uncapturederror',uncaptured);for(const b of owned)b.destroy();throw error;}
}
