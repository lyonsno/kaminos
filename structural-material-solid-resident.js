export const SOLID_RESIDENT_ROUTE='kaminos.deformable-material.colored-vbd.webgpu.v0';
export const solidResidentWgsl=`
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct Settings{counts:vec4u,time:vec4f,grip:vec4f,destination:vec4f,plane:vec4f};
struct Local{gradient:vec3f,energy:f32,hessian:mat3x3f,invalid:u32};
@group(0) @binding(0) var<storage,read_write> points:array<Point>;
@group(0) @binding(1) var<storage,read> elements:array<vec4u>;
@group(0) @binding(2) var<storage,read> parameters:array<f32>;
@group(0) @binding(3) var<storage,read> coefficients:array<f32>;
@group(0) @binding(4) var<storage,read> incidence:array<u32>;
@group(0) @binding(5) var<storage,read_write> bonds:array<vec4u>;
@group(0) @binding(6) var<storage,read> elementBonds:array<vec4u>;
@group(0) @binding(7) var<storage,read_write> diagnostics:array<vec4f>;
@group(0) @binding(8) var<uniform> settings:Settings;
fn eye()->mat3x3f{return mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));}
fn outer(a:vec3f,b:vec3f)->mat3x3f{return mat3x3f(a*b.x,a*b.y,a*b.z);}
fn position(index:u32,node:u32,trial:vec3f)->vec3f{if(index==node){return trial;}return points[index].position.xyz;}
fn shape(element:u32,local:u32)->vec3f{let i=element*16u+local*4u;return vec3f(parameters[i],parameters[i+1u],parameters[i+2u]);}
fn graph(element:u32,local:u32,node:u32,trial:vec3f)->Local{
 var result:Local;var mask=0u;
 for(var k=0u;k<6u;k++){let ids=elementBonds[element*2u+k/4u];if(bonds[ids[k%4u]].z==0u){mask|=1u<<k;}}
 let matrix=(element*64u+mask)*36u;var live=false;for(var k=0u;k<36u;k++){live=live||(coefficients[matrix+k]!=0.0);}
 if(!live){return result;}
 let ids=elements[element];var F=mat3x3f(vec3f(0),vec3f(0),vec3f(0));
 for(var k=0u;k<4u;k++){F+=outer(position(ids[k],node,trial),shape(element,k));}
 let J=dot(F[0],cross(F[1],F[2]));if(J<=0.0){result.invalid=1u;result.energy=1e30;return result;}
 let C=transpose(F)*F;var e=array<f32,6>((C[0][0]-1.0)*0.5,(C[1][1]-1.0)*0.5,(C[2][2]-1.0)*0.5,C[1][0],C[2][0],C[2][1]);var s=array<f32,6>();
 for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){s[row]+=coefficients[matrix+row*6u+col]*e[col];}result.energy+=e[row]*s[row];}
 let S=mat3x3f(vec3f(s[0],s[3],s[4]),vec3f(s[3],s[1],s[5]),vec3f(s[4],s[5],s[2]));let g=shape(element,local);let V=parameters[element*16u+3u];
 result.energy*=V*0.5;result.gradient=V*(F*S*g);
 var A=array<vec3f,6>(F[0]*g.x,F[1]*g.y,F[2]*g.z,F[1]*g.x+F[0]*g.y,F[2]*g.x+F[0]*g.z,F[2]*g.y+F[1]*g.z);
 for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){result.hessian+=outer(A[row],A[col])*(V*coefficients[matrix+row*6u+col]);}}
 result.hessian+=eye()*max(0.0,V*dot(g,S*g));return result;
}
fn pmb(element:u32,local:u32,node:u32,trial:vec3f)->Local{
 var result:Local;if(bonds[element].z==0u){return result;}
 let ids=elements[element];let delta=position(ids.y,node,trial)-position(ids.x,node,trial);let r=length(delta);
 if(r<=0.0){result.invalid=1u;result.energy=1e30;return result;}
 let r0=parameters[element*4u];let k=parameters[element*4u+1u];let extension=r-r0;let normal=delta/r;let N=outer(normal,normal);
 result.energy=0.5*k*extension*extension;result.gradient=select(-1.0,1.0,local==1u)*k*extension*normal;
 result.hessian=N*k+(eye()-N)*max(0.0,k*(1.0-r0/r));return result;
}
fn evaluate(node:u32,trial:vec3f)->Local{
 let point=points[node];let inertia=point.rest.w/(settings.time.x*settings.time.x);let offset=trial-point.predicted.xyz;
 var result:Local;result.gradient=inertia*offset;result.energy=0.5*inertia*dot(offset,offset);result.hessian=eye()*inertia;
 let base=settings.counts.x+1u;
 for(var index=incidence[node];index<incidence[node+1u];index++){
  let element=incidence[base+index*2u];let local=incidence[base+index*2u+1u];var term:Local;
  if(settings.counts.z==0u){term=graph(element,local,node,trial);}else{term=pmb(element,local,node,trial);}
  result.gradient+=term.gradient;result.energy+=term.energy;result.hessian+=term.hessian;result.invalid|=term.invalid;
 }
 if(settings.grip.x>=0.0&&u32(settings.grip.x)==node){let d=trial-settings.destination.xyz;let k=settings.grip.y;result.gradient+=k*d;result.energy+=0.5*k*dot(d,d);result.hessian+=eye()*k;}
 return result;
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}let p=points[i];var y=p.position.xyz+settings.time.x*p.velocity.xyz*settings.time.z+vec3f(0,-settings.time.y,0)*settings.time.x*settings.time.x;
 if(p.velocity.w==1.0){y=p.rest.xyz;}points[i].predicted=vec4f(y,0);points[i].position=vec4f(y,p.position.w);
}
@compute @workgroup_size(64) fn solve(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}let p=points[i];if(p.velocity.w==1.0||u32(p.position.w)!=settings.counts.y){return;}
 let before=evaluate(i,p.position.xyz);if(before.invalid!=0u){return;}
 let H=before.hessian;let determinant=dot(H[0],cross(H[1],H[2]));if(!(determinant>0.0)){return;}
 let inverse=transpose(mat3x3f(cross(H[1],H[2]),cross(H[2],H[0]),cross(H[0],H[1])))*(1.0/determinant);
 let delta=-(inverse*before.gradient);var step=1.0;
 for(var trial=0u;trial<settings.counts.w;trial++){
  let candidate=p.position.xyz+step*delta;let after=evaluate(i,candidate);
  if(after.invalid==0u&&after.energy<=before.energy){points[i].position=vec4f(candidate,p.position.w);return;}step*=0.5;
 }
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}let p=points[i];var x=p.position.xyz;
 var v=(x-p.predicted.xyz)/settings.time.x+p.velocity.xyz*settings.time.z+vec3f(0,-settings.time.y,0)*settings.time.x;
 if(p.velocity.w==1.0){x=p.rest.xyz;v=vec3f(0);}else if(x.y<settings.time.w){x.y=settings.time.w;v.y=max(v.y,0.0);}
 points[i].position=vec4f(x,p.position.w);points[i].velocity=vec4f(v,p.velocity.w);
}
@compute @workgroup_size(64) fn diagnose(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}let value=evaluate(i,points[i].position.xyz);let base=i*6u;
 diagnostics[base]=vec4f(value.gradient,f32(value.invalid));for(var k=0u;k<3u;k++){diagnostics[base+1u+k]=vec4f(value.hessian[k],0);}
 diagnostics[base+4u]=vec4f(value.energy,points[i].velocity.w,0,0);diagnostics[base+5u]=vec4f(0);
}
@compute @workgroup_size(64) fn damage(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bonds)){return;}let b=bonds[i];let a=dot(settings.plane.xyz,points[b.x].rest.xyz)-settings.plane.w;let c=dot(settings.plane.xyz,points[b.y].rest.xyz)-settings.plane.w;
 if(a*c<0.0){bonds[i].z=0u;}
}`;

export async function createSolidResident(device,descriptor,arrays,{onProgress=()=>{}}={}){
 if(!['graph','pmb'].includes(descriptor?.kind)||!['points','elements','bonds','colorCount'].every(k=>Number.isInteger(descriptor[k])&&descriptor[k]>0))throw new Error('Complete explicit material descriptor required');
 const n=descriptor.points,count=descriptor.elements,bondCount=descriptor.bonds;
 const expected={state:n*16,elements:count*4,bonds:bondCount*4,parameters:count*(descriptor.kind==='graph'?16:4),coefficients:descriptor.kind==='graph'?count*64*36:1,elementBonds:descriptor.kind==='graph'?count*8:4};
 for(const [name,length] of Object.entries(expected)){const Type=['state','parameters','coefficients'].includes(name)?Float32Array:Uint32Array;if(!(arrays[name] instanceof Type)||arrays[name].length!==length||!arrays[name].every(Number.isFinite))throw new Error(`Complete finite resident ${name} required`);}
  if(!(arrays.incidence instanceof Uint32Array)||arrays.incidence.length<n+1||(arrays.incidence.length-n-1)!==arrays.incidence[n]*2)throw new Error('Complete uncapped resident incidence required');
 for(let i=0;i<n;i++)if(!(arrays.state[i*16+3]>0)||!Number.isInteger(arrays.state[i*16+7])||arrays.state[i*16+7]>=descriptor.colorCount||arrays.state[i*16+7]<0||![0,1].includes(arrays.state[i*16+11]))throw new Error('Positive mass, valid color and support state required');
 for(let i=0;i<count;i++)for(let k=0;k<(descriptor.kind==='graph'?4:2);k++)if(arrays.elements[i*4+k]>=n)throw new Error('Resident element index out of range');
 for(let i=0;i<bondCount;i++)if(arrays.bonds[i*4]>=n||arrays.bonds[i*4+1]>=n||![0,1].includes(arrays.bonds[i*4+2]))throw new Error('Valid resident bond endpoints and liveness required');
 for(let i=0;i<n;i++)if(arrays.incidence[i]>arrays.incidence[i+1])throw new Error('Monotone resident incidence offsets required');
 for(let i=n+1;i<arrays.incidence.length;i+=2)if(arrays.incidence[i]>=count||arrays.incidence[i+1]>=(descriptor.kind==='graph'?4:2))throw new Error('Resident incident element out of range');
  if(descriptor.kind==='graph')for(let i=0;i<count;i++)for(let k=0;k<6;k++)if(arrays.elementBonds[i*8+k]>=bondCount)throw new Error('Resident graph edge out of range');
 const expectedIncidence=Array.from({length:n},()=>new Set());
 for(let i=0;i<count;i++){const members=Array.from(arrays.elements.slice(i*4,i*4+(descriptor.kind==='graph'?4:2)));if(new Set(members).size!==members.length||new Set(members.map(node=>arrays.state[node*16+7])).size!==members.length)throw new Error('Conflicting material update colors');members.forEach((node,local)=>expectedIncidence[node].add(`${i}:${local}`));}
 if(arrays.incidence[0]!==0)throw new Error('Resident incidence must start at zero');
 for(let node=0;node<n;node++){const actual=new Set();for(let i=arrays.incidence[node];i<arrays.incidence[node+1];i++)actual.add(`${arrays.incidence[n+1+i*2]}:${arrays.incidence[n+2+i*2]}`);if(actual.size!==arrays.incidence[node+1]-arrays.incidence[node]||actual.size!==expectedIncidence[node].size||[...actual].some(key=>!expectedIncidence[node].has(key)))throw new Error('Complete correctly owned material incidence required');}
 const owned=[],buffers={},allocate=(name,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw new Error(`Resident ${name} exceeds effective storage capacity`);const b=device.createBuffer({label:`Material ${name}`,size,usage});owned.push(b);return b;};
 let settings={timeStep:Math.fround(1/60),gravity:0,damping:1,floor:Math.fround(-1e20),lineSearchTrials:8,iterations:0},grip=null,steps=0,damageEpoch=0,operations=Promise.resolve(),failure=null;
 const valid=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'material-command-invalid'});};
 const serial=fn=>{const run=operations.then(()=>{if(failure)throw new Error(failure);return fn();});operations=run.catch(error=>{if(error.code!=='material-command-invalid')failure=error.message;});return run;};
 try{
  for(const name of [...Object.keys(expected),'incidence']){const data=arrays[name];buffers[name]=allocate(name,data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|(name==='state'||name==='bonds'?GPUBufferUsage.COPY_SRC:0));device.queue.writeBuffer(buffers[name],0,data);}
  onProgress('buffers-uploaded');
  buffers.diagnostics=allocate('diagnostics',n*6*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const alignment=device.limits.minUniformBufferOffsetAlignment,uniform=device.createBuffer({label:'Material update colors',size:descriptor.colorCount*alignment,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(uniform);
  onProgress('shader-compilation');const shader=device.createShaderModule({label:'Resident graph/PMB local energy minimization',code:solidResidentWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages.map(m=>({message:m.message,line:m.lineNum}))));
  const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===8?'uniform':[0,5,7].includes(binding)?'storage':'read-only-storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  for(const entryPoint of ['predict','solve','finish','diagnose','damage']){onProgress(`pipeline-${entryPoint}`);pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:shader,entryPoint}});}onProgress('pipelines-compiled');
  const resources=['state','elements','parameters','coefficients','incidence','bonds','elementBonds','diagnostics'].map(name=>buffers[name]);
  const groups=Array.from({length:descriptor.colorCount},(_,color)=>device.createBindGroup({layout,entries:[...resources.map((buffer,binding)=>({binding,resource:{buffer}})),{binding:8,resource:{buffer:uniform,offset:color*alignment,size:80}}]}));
  const configure=plane=>{const bytes=new ArrayBuffer(descriptor.colorCount*alignment);for(let color=0;color<descriptor.colorCount;color++){const u=new Uint32Array(bytes,color*alignment,4),f=new Float32Array(bytes,color*alignment+16,16);u.set([n,color,descriptor.kind==='graph'?0:1,settings.lineSearchTrials]);f.set([settings.timeStep,settings.gravity,settings.damping,settings.floor,grip?.index??-1,grip?.stiffness??0,0,0,...(grip?.target??[0,0,0]),0,...(plane??[0,0,0,0])]);}device.queue.writeBuffer(uniform,0,bytes);};
  const dispatch=(encoder,name,color=0,count=n)=>{const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,groups[color]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();};
  async function readNow(){configure();const encoder=device.createCommandEncoder();dispatch(encoder,'diagnose');const names=['state','bonds','diagnostics'],readbacks=names.map(name=>allocate(`readback ${name}`,buffers[name].size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));
   names.forEach((name,i)=>encoder.copyBufferToBuffer(buffers[name],0,readbacks[i],0,buffers[name].size));device.queue.submit([encoder.finish()]);
   try{onProgress('readback-await');await Promise.all(readbacks.map(b=>b.mapAsync(GPUMapMode.READ)));const state=Array.from(new Float32Array(readbacks[0].getMappedRange())),bonds=Array.from(new Uint32Array(readbacks[1].getMappedRange())),diagnostics=Array.from(new Float32Array(readbacks[2].getMappedRange()));onProgress('readback-complete');return{route:SOLID_RESIDENT_ROUTE,kind:descriptor.kind,steps,damageEpoch,settings:{...settings},grip:grip&&structuredClone(grip),state,bonds,diagnostics,claim:'Resident colored local-energy dynamics; explicit plane damage command and point-floor contact are provisional, not stress-generated shards'};}finally{for(const b of readbacks){b.destroy();owned.splice(owned.indexOf(b),1);}}
  }
  return{route:SOLID_RESIDENT_ROUTE,
   pin(indices){return serial(()=>{valid(Array.isArray(indices)&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<n),'Valid support point indices required');for(const index of indices)device.queue.writeBuffer(buffers.state,(index*16+11)*4,new Float32Array([1]));});},
   grip(index,target,stiffness){return serial(()=>{valid(Number.isInteger(index)&&index>=0&&index<n&&Array.isArray(target)&&target.length===3&&target.every(v=>Number.isFinite(Math.fround(v)))&&Number.isFinite(Math.fround(stiffness))&&Math.fround(stiffness)>0,'Valid resident grip required');grip={index,target:target.map(Math.fround),stiffness:Math.fround(stiffness)};});},
   release(){return serial(()=>{grip=null;});},
   step(request){return serial(async()=>{valid(request&&typeof request==='object','Explicit solver settings required');const {iterations,...next}=request;valid(Number.isInteger(iterations)&&iterations>0&&Number.isInteger(next.lineSearchTrials)&&next.lineSearchTrials>0&&next.lineSearchTrials<=0xffffffff&&['timeStep','gravity','damping','floor'].every(k=>Number.isFinite(next[k])&&Number.isFinite(Math.fround(next[k])))&&next.timeStep>0&&Math.fround(Math.fround(next.timeStep)**2)>0&&next.damping>=0&&next.damping<=1,'Explicit valid solver timestep, iterations, trial count, gravity, damping and floor required');settings={...Object.fromEntries(Object.entries(next).map(([key,value])=>[key,key==='lineSearchTrials'?value:Math.fround(value)])),iterations};configure();const encoder=device.createCommandEncoder();dispatch(encoder,'predict');for(let iteration=0;iteration<iterations;iteration++)for(let color=0;color<descriptor.colorCount;color++)dispatch(encoder,'solve',color);dispatch(encoder,'finish');device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();steps++;});},
   damagePlane(normal,offset){return serial(async()=>{valid(Array.isArray(normal)&&normal.length===3&&normal.every(Number.isFinite)&&Math.abs(Math.hypot(...normal)-1)<=1e-6&&Number.isFinite(Math.fround(offset)),'Explicit unit damage plane required');configure([...normal,offset]);const encoder=device.createCommandEncoder();dispatch(encoder,'damage',0,bondCount);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();damageEpoch++;});},
   read(){return serial(readNow);},
   dispose(){for(const b of owned)b.destroy();failure='Resident material disposed';}
  };
 }catch(error){for(const b of owned)b.destroy();throw error;}
}
