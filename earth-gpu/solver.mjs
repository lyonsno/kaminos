import {EARTH_GPU_WGSL} from './shader.mjs';
import {retainMaterial,packMaterial,refineMaterial} from './material.mjs';
export async function createEarthGpuSolver({device,state,bodyBuffer=null,iterations=6,dt=1/480,gravity=9.81,friction=.65,damping=1.5,shaderCode=EARTH_GPU_WGSL}){
 if(!device||!Number.isSafeInteger(iterations)||iterations<1||!(dt>0&&Number.isFinite(dt))||![gravity,friction,damping].every(x=>Number.isFinite(x)&&x>=0))throw Error('Valid GPU device and physical solver settings required');
 const owned=[],count=state.floats.length/24,grainCount=state.grainCount,cell=state.radius*4.2,materialColors=state.materialColors??0,slots=materialColors+1;
 let disposed=false,pending=false,failure=null,stepsDone=state.physicalSteps??0,capturing=0,lastTool=[0,0,0,0],capacity=1,uniform,group,completion=Promise.resolve();
 const dims=[Math.ceil(state.width/cell),Math.ceil(Math.max(...Array.from({length:count},(_,i)=>state.floats[i*24+1]))/cell)+8,Math.ceil(state.depth/cell)],cells=dims.reduce((a,b)=>a*b,1);
 const allocate=(size,label,usage=GPUBufferUsage.STORAGE)=>{if(size>device.limits.maxStorageBufferBindingSize||size>device.limits.maxBufferSize)throw Error(label+' exceeds effective GPU buffer capacity');const b=device.createBuffer({size:Math.max(16,size),usage:usage|GPUBufferUsage.COPY_DST|((usage&GPUBufferUsage.MAP_READ)?0:GPUBufferUsage.COPY_SRC),label});owned.push(b);return b;};
 let bodies=bodyBuffer;
 const uncaptured=e=>{failure=e.error?.message??'Earth GPU error';};device.addEventListener?.('uncapturederror',uncaptured);
 device.lost.then(info=>{if(!disposed)failure=info.message||'Earth GPU device lost';});
 try{
  device.pushErrorScope('validation');
  bodies??=allocate(state.floats.byteLength,'Earth resident Lagrangian bodies');device.queue.writeBuffer(bodies,0,state.floats);
  const before=allocate(state.floats.byteLength,'Earth preceding bodies'),heads=allocate(cells*4,'Earth complete grain spatial buckets'),next=allocate(Math.max(1,grainCount)*4,'Earth bucket linked list'),delta=allocate(count*32,'Earth reciprocal contact corrections'),tets=allocate(state.tets.byteLength,'Earth retained plastic material'),faces=allocate(state.triangles.byteLength,'Earth actual boundary triangles'),ties=allocate(state.ties.byteLength,'Earth coarse fine transitions');
  device.queue.writeBuffer(tets,0,state.tets);device.queue.writeBuffer(faces,0,state.triangles);device.queue.writeBuffer(ties,0,state.ties);
  const layout=device.createBindGroupLayout({entries:[0,1,2,3,4,5,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===6||binding===8?'read-only-storage':'storage',...(binding===7?{hasDynamicOffset:true,minBindingSize:96}:{})}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const mod=device.createShaderModule({label:'Live earth contacts and yielding material',code:shaderCode});const errors=(await mod.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.lineNum+': '+m.message).join('\n'));
  const stages=['predict','clear','index','grainContacts','materialContacts','material','transition','apply','finish','plastic'],pipelines={};for(const entryPoint of stages)pipelines[entryPoint]=await device.createComputePipelineAsync({label:'Earth '+entryPoint,layout:pipelineLayout,compute:{module:mod,entryPoint}});
  const buffers=[bodies,before,heads,next,delta,tets,faces,null,ties];
  function reserve(n){if(uniform&&n<=capacity)return;const old=uniform;capacity=Math.max(n,capacity*2);uniform=allocate(capacity*256,'Earth chronological step parameters',GPUBufferUsage.UNIFORM);buffers[7]=uniform;group=device.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer,...(binding===7?{size:96}:{})}}))});old?.destroy();}
  reserve(1);const validation=await device.popErrorScope();if(validation)throw Error(validation.message);
  const encodeStage=(encoder,name,n,step)=>{if(!n)return;const pass=encoder.beginComputePass({label:'Earth '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group,[step*256]);const groups=Math.ceil(n/64),limit=device.limits.maxComputeWorkgroupsPerDimension;if(groups>limit)throw Error('Earth dispatch exceeds GPU one-dimensional workgroups');pass.dispatchWorkgroups(groups);pass.end();};
  async function copy(buffer){const read=allocate(buffer.size,'Earth explicit snapshot readback',GPUBufferUsage.MAP_READ);try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,read,0,buffer.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);return new Float32Array(read.getMappedRange()).slice();}finally{read.unmap();read.destroy();owned.splice(owned.indexOf(read),1);}}
  return {bodies,tets,configuration:{dt,iterations,gravity,friction,damping,cell,dims},
   advance({steps=1,tool=null}={}){
    if(disposed||failure)throw Error(failure||'Earth GPU disposed');if(pending||capturing)return false;if(!Number.isSafeInteger(steps)||steps<1)throw Error('Explicit positive step count required');
    const nextTool=tool?[...tool.position,tool.radius]:[0,0,0,0];if(nextTool.length!==4||!nextTool.every(Number.isFinite)||nextTool[3]<0)throw Error('Invalid material tool pose');reserve(steps*slots);
    const params=new ArrayBuffer(steps*slots*256);
    for(let s=0;s<steps;s++)for(let color=0;color<slots;color++){const offset=(s*slots+color)*256,u=new Uint32Array(params,offset,24),f=new Float32Array(params,offset,24);u.set([count,grainCount,state.material.tets.length,state.faceCount,...dims,state.tieCount]);f.set([state.width,state.depth,cell,dt],8);const start=lastTool[3]>0?lastTool:nextTool;
     f.set(nextTool.map((x,k)=>start[k]+(x-start[k])*(s+1)/steps),12);f.set(nextTool.map((x,k)=>start[k]+(x-start[k])*s/steps),16);f.set([gravity,friction,damping,color-1],20);}
    device.queue.writeBuffer(uniform,0,params);const encoder=device.createCommandEncoder({label:'Live mixed earth physical steps'});
    for(let s=0;s<steps;s++){
     const step=s*slots;encodeStage(encoder,'predict',count,step);
     for(let iteration=0;iteration<iterations;iteration++){
      encodeStage(encoder,'clear',Math.max(count,cells),step);encodeStage(encoder,'index',grainCount,step);encodeStage(encoder,'grainContacts',grainCount,step);encodeStage(encoder,'materialContacts',grainCount,step);encodeStage(encoder,'transition',state.tieCount,step);encodeStage(encoder,'apply',count,step);for(let color=0;color<materialColors;color++)encodeStage(encoder,'material',state.material.tets.length,step+color+1);
     }encodeStage(encoder,'finish',count,step);encodeStage(encoder,'plastic',state.material.tets.length,step);
    }
    device.queue.submit([encoder.finish()]);lastTool=nextTool;pending=true;
    completion=device.queue.onSubmittedWorkDone().then(()=>{stepsDone+=steps;}).catch(e=>{failure=String(e);}).finally(()=>{pending=false;});return true;
   },
   async wait(){await completion;if(failure)throw Error(failure);},
   async capture(){if(disposed||failure)throw Error(failure||'Earth GPU disposed');capturing++;const read=allocate(bodies.size+tets.size,'Earth complete state snapshot',GPUBufferUsage.MAP_READ);try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(bodies,0,read,0,bodies.size);encoder.copyBufferToBuffer(tets,0,read,bodies.size,tets.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange(),floats=new Float32Array(bytes.slice(0,bodies.size)),plastic=new Float32Array(bytes.slice(bodies.size));if(failure)throw Error(failure);if(!floats.every(Number.isFinite)||!plastic.every(Number.isFinite))throw Error('Nonfinite GPU material state');return {...retainMaterial(state,floats,plastic),physicalSteps:stepsDone,physicalTime:stepsDone*dt};}finally{capturing--;read.unmap();read.destroy();owned.splice(owned.indexOf(read),1);}},
   async refined(selected){const current=await this.capture();current.material=refineMaterial(current.material,selected);return packMaterial(current);},
   read(){return {route:'webgpu/rigid-sphere-pairs/yielding-tetrahedra',bodies:count,grains:grainCount,materialPoints:state.material.nodes.length,tetrahedra:state.material.tets.length,surfaceTriangles:state.faceCount,transitionConstraints:state.tieCount,generation:state.material.generation,steps:stepsDone,simulatedSeconds:stepsDone*dt,pending,failure,configuration:this.configuration,runtimeReadbacks:0};},
   dispose(){if(disposed)return;disposed=true;device.removeEventListener?.('uncapturederror',uncaptured);for(const b of owned)b.destroy();}
  };
 }catch(error){try{await device.popErrorScope();}catch{}device.removeEventListener?.('uncapturederror',uncaptured);for(const b of owned)b.destroy();throw error;}
}
