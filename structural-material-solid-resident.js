export const SOLID_RESIDENT_ROUTE='kaminos.deformable-material.colored-vbd.webgpu.v0';
export const solidResidentWgsl=`
override isotropicIntact:bool=false;
struct Point{rest:vec4f,position:vec4f,velocity:vec4f,predicted:vec4f};
struct Settings{counts:vec4u,time:vec4f,grip:vec4f,destination:vec4f,plane:vec4f,topology:vec4u};
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
fn graph(element:u32,local:u32,node:u32,trial:vec3f,needHessian:bool)->Local{
 var result:Local;var mask=0u;
 if(!isotropicIntact){for(var k=0u;k<6u;k++){let ids=elementBonds[element*2u+k/4u];if(bonds[ids[k%4u]].z==0u){mask|=1u<<k;}}}
 let matrix=select((element*64u+mask)*36u,element*36u,settings.topology.z==1u);var live=isotropicIntact;if(!isotropicIntact){for(var k=0u;k<36u;k++){live=live||(coefficients[matrix+k]!=0.0);}}
 if(!live){return result;}
 let ids=elements[element];var F=mat3x3f(vec3f(0),vec3f(0),vec3f(0));
 for(var k=1u;k<4u;k++){F+=outer(position(ids[k],node,trial)-position(ids[0],node,trial),shape(element,k));}
 let J=dot(F[0],cross(F[1],F[2]));if(J<=0.0){result.invalid=1u;result.energy=1e30;return result;}
 let C=transpose(F)*F;var e=array<f32,6>((C[0][0]-1.0)*0.5,(C[1][1]-1.0)*0.5,(C[2][2]-1.0)*0.5,C[1][0],C[2][0],C[2][1]);var s=array<f32,6>();
 if(isotropicIntact){let lambda=coefficients[matrix+1u];let mu=coefficients[matrix+21u];let tr=e[0]+e[1]+e[2];for(var row=0u;row<3u;row++){s[row]=2.0*mu*e[row]+lambda*tr;}for(var row=3u;row<6u;row++){s[row]=mu*e[row];}}
 else{for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){s[row]+=coefficients[matrix+row*6u+col]*e[col];}}}
 for(var row=0u;row<6u;row++){result.energy+=e[row]*s[row];}
 let S=mat3x3f(vec3f(s[0],s[3],s[4]),vec3f(s[3],s[1],s[5]),vec3f(s[4],s[5],s[2]));var g=shape(element,local);if(local==0u){g=-(shape(element,1u)+shape(element,2u)+shape(element,3u));}let V=parameters[element*16u+3u];let beta=select(0.0,parameters[element*16u+7u],settings.topology.w==1u);
 result.energy*=V*0.5;if(beta>0.0){result.energy+=V*beta*(J-1.0-log(J));}if(!needHessian){return result;}let cofactor=mat3x3f(cross(F[1],F[2]),cross(F[2],F[0]),cross(F[0],F[1]));let q=cofactor*g;result.gradient=V*(F*S*g);if(beta>0.0){result.gradient+=V*beta*(1.0-1.0/J)*q;result.hessian=outer(q,q)*(V*beta/(J*J));}
 var A=array<vec3f,6>(F[0]*g.x,F[1]*g.y,F[2]*g.z,F[1]*g.x+F[0]*g.y,F[2]*g.x+F[0]*g.z,F[2]*g.y+F[1]*g.z);
 if(isotropicIntact){let lambda=coefficients[matrix+1u];let mu=coefficients[matrix+21u];let v=A[0]+A[1]+A[2];result.hessian+=outer(v,v)*(V*lambda);for(var row=0u;row<3u;row++){result.hessian+=outer(A[row],A[row])*(V*2.0*mu);}for(var row=3u;row<6u;row++){result.hessian+=outer(A[row],A[row])*(V*mu);}}
 else{for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){result.hessian+=outer(A[row],A[col])*(V*coefficients[matrix+row*6u+col]);}}}
 result.hessian+=eye()*max(0.0,V*dot(g,S*g));return result;
}
fn pmb(element:u32,local:u32,node:u32,trial:vec3f,needHessian:bool)->Local{
 var result:Local;if(bonds[element].z==0u){return result;}
 let ids=elements[element];let delta=position(ids.y,node,trial)-position(ids.x,node,trial);let r=length(delta);
 if(r<=0.0){result.invalid=1u;result.energy=1e30;return result;}
 let r0=parameters[element*4u];let k=parameters[element*4u+1u];let extension=r-r0;let normal=delta/r;let N=outer(normal,normal);
 result.energy=0.5*k*extension*extension;if(!needHessian){return result;}result.gradient=select(-1.0,1.0,local==1u)*k*extension*normal;
 result.hessian=N*k+(eye()-N)*max(0.0,k*(1.0-r0/r));return result;
}
fn evaluate(node:u32,trial:vec3f,needHessian:bool)->Local{
 let point=points[node];let inertia=point.rest.w/(settings.time.x*settings.time.x);let offset=trial-point.predicted.xyz;
 var result:Local;result.gradient=inertia*offset;result.energy=0.5*inertia*dot(offset,offset);result.hessian=eye()*inertia;
 let base=settings.counts.x+1u;
 for(var index=incidence[node];index<incidence[node+1u];index++){
  let element=incidence[base+index*2u];let local=incidence[base+index*2u+1u];var term:Local;
  if(settings.counts.z==0u){term=graph(element,local,node,trial,needHessian);}else{term=pmb(element,local,node,trial,needHessian);}
  result.gradient+=term.gradient;result.energy+=term.energy;result.hessian+=term.hessian;result.invalid|=term.invalid;
 }
 if(settings.grip.x>=0.0&&u32(settings.grip.x)==node){let d=trial-settings.destination.xyz;let k=settings.grip.y;result.gradient+=k*d;result.energy+=0.5*k*dot(d,d);result.hessian+=eye()*k;}
 if(settings.grip.x==-2.0){let baseline=diagnostics[node*6u+5u];let d=trial-baseline.xyz-settings.destination.xyz;let k=settings.grip.y*baseline.w;result.gradient+=k*d;result.energy+=0.5*k*dot(d,d);result.hessian+=eye()*k;}
 return result;
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}let p=points[i];var y=p.position.xyz+settings.time.x*p.velocity.xyz*settings.time.z+vec3f(0,-settings.time.y,0)*settings.time.x*settings.time.x;
 if(p.velocity.w==1.0){y=p.rest.xyz;points[i].position=vec4f(y,p.position.w);}points[i].predicted=vec4f(y,0);
}
@compute @workgroup_size(64) fn solve(@builtin(global_invocation_id) id:vec3u){
 let colors=settings.counts.x+1u+incidence[settings.counts.x]*2u;let start=incidence[colors+settings.counts.y];let end=incidence[colors+settings.counts.y+1u];if(id.x>=end-start){return;}
 let i=incidence[colors+settings.topology.x+1u+start+id.x];let p=points[i];if(p.velocity.w==1.0){return;}
 let before=evaluate(i,p.position.xyz,true);if(before.invalid!=0u){return;}
 let H=before.hessian;let determinant=dot(H[0],cross(H[1],H[2]));if(!(determinant>0.0)){return;}
 let inverse=transpose(mat3x3f(cross(H[1],H[2]),cross(H[2],H[0]),cross(H[0],H[1])))*(1.0/determinant);
 let delta=-(inverse*before.gradient);var step=1.0;
 for(var trial=0u;trial<settings.counts.w;trial++){
  let candidate=p.position.xyz+step*delta;let after=evaluate(i,candidate,false);
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
 let i=id.x;if(i>=settings.counts.x){return;}let value=evaluate(i,points[i].position.xyz,true);let base=i*6u;
 diagnostics[base]=vec4f(value.gradient,f32(value.invalid));for(var k=0u;k<3u;k++){diagnostics[base+1u+k]=vec4f(value.hessian[k],0);}
 diagnostics[base+4u]=vec4f(value.energy,points[i].velocity.w,0,0);
}
@compute @workgroup_size(64) fn capturePatch(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=settings.counts.x){return;}diagnostics[i*6u+5u]=vec4f(points[i].position.xyz,diagnostics[i*6u+5u].w);
}
@compute @workgroup_size(64) fn stress(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&elements)||settings.counts.z!=0u){return;}let base=settings.counts.x*6u+i*7u;var mask=0u;
 if(!isotropicIntact){for(var k=0u;k<6u;k++){let ids=elementBonds[i*2u+k/4u];if(bonds[ids[k%4u]].z==0u){mask|=1u<<k;}}}
 let matrix=select((i*64u+mask)*36u,i*36u,settings.topology.z==1u);var live=isotropicIntact;if(!isotropicIntact){for(var k=0u;k<36u;k++){live=live||(coefficients[matrix+k]!=0.0);}}
 for(var k=0u;k<7u;k++){diagnostics[base+k]=vec4f(0);}if(!live){return;}
 let ids=elements[i];var F=mat3x3f(vec3f(0),vec3f(0),vec3f(0));for(var k=1u;k<4u;k++){F+=outer(points[ids[k]].position.xyz-points[ids[0]].position.xyz,shape(i,k));}
 let J=dot(F[0],cross(F[1],F[2]));if(J<=0.0){diagnostics[base+6u]=vec4f(0,0,1,1);return;}
 let C=transpose(F)*F;let e=array<f32,6>((C[0][0]-1.0)*0.5,(C[1][1]-1.0)*0.5,(C[2][2]-1.0)*0.5,C[1][0],C[2][0],C[2][1]);var s=array<f32,6>();var energy=0.0;
 if(isotropicIntact){let lambda=coefficients[matrix+1u];let mu=coefficients[matrix+21u];let tr=e[0]+e[1]+e[2];for(var row=0u;row<3u;row++){s[row]=2.0*mu*e[row]+lambda*tr;}for(var row=3u;row<6u;row++){s[row]=mu*e[row];}}
 else{for(var row=0u;row<6u;row++){for(var col=0u;col<6u;col++){s[row]+=coefficients[matrix+row*6u+col]*e[col];}}}
 for(var row=0u;row<6u;row++){energy+=e[row]*s[row];}
 let S=mat3x3f(vec3f(s[0],s[3],s[4]),vec3f(s[3],s[1],s[5]),vec3f(s[4],s[5],s[2]));let beta=select(0.0,parameters[i*16u+7u],settings.topology.w==1u);var sigma=F*S*transpose(F)*(1.0/J);if(beta>0.0){sigma+=eye()*(beta*(1.0-1.0/J));energy+=2.0*beta*(J-1.0-log(J));}
 for(var k=0u;k<3u;k++){diagnostics[base+k]=vec4f(sigma[k],0);diagnostics[base+3u+k]=vec4f(F[k],0);}
 diagnostics[base+6u]=vec4f(parameters[i*16u+3u],energy*parameters[i*16u+3u]*0.5,1,0);
}
@compute @workgroup_size(64) fn damage(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&bonds)){return;}let b=bonds[i];let a=dot(settings.plane.xyz,points[b.x].rest.xyz)-settings.plane.w;let c=dot(settings.plane.xyz,points[b.y].rest.xyz)-settings.plane.w;
 if(a*c<0.0&&(settings.topology.y==0u||(diagnostics[b.x*6u+4u].z==1.0&&diagnostics[b.y*6u+4u].z==1.0))){bonds[i].z=0u;}
}`;

const devicePrograms=new WeakMap();
async function materialProgram(device,onProgress,energyKernel){
 if(!devicePrograms.has(device))devicePrograms.set(device,new Map());
 const programs=devicePrograms.get(device);
 if(!programs.has(energyKernel)){
  const pending=(async()=>{
   onProgress('shader-compilation');const shader=device.createShaderModule({label:'Resident graph/PMB local energy minimization',code:solidResidentWgsl}),info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages.map(m=>({message:m.message,line:m.lineNum}))));
   const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===8?'uniform':[0,5,7].includes(binding)?'storage':'read-only-storage'}}))}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
   for(const entryPoint of ['predict','solve','finish','diagnose','damage','capturePatch','stress']){onProgress(`pipeline-${entryPoint}`);pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module:shader,entryPoint,constants:{isotropicIntact:energyKernel==='isotropic-intact-v1'}}});}return{layout,pipelines};
  })();programs.set(energyKernel,pending);pending.catch(()=>{if(programs.get(energyKernel)===pending)programs.delete(energyKernel);});
 }else onProgress('pipelines-reused');
 return programs.get(energyKernel);
}

export function selectSolidEnergyKernel(descriptor,arrays,requested='auto'){
 if(!['auto','dense-reference'].includes(requested))throw new Error('Unknown solid energy kernel');
 if(requested==='dense-reference'||descriptor.kind!=='graph'||descriptor.constitutiveLayout!=='separated-intact-tetrahedra-v1')return 'dense-reference';
 const c=arrays.coefficients;
 if(!(c instanceof Float32Array)||c.length!==descriptor.elements*36)return 'dense-reference';
 for(let t=0;t<descriptor.elements;t++){
  const base=t*36,lambda=c[base+1],mu=c[base+21],diagonal=Math.fround(lambda+2*mu);
  if(!(Number.isFinite(lambda)&&Number.isFinite(mu)&&mu>0&&lambda+2*mu/3>0))return 'dense-reference';
  for(let row=0;row<6;row++)for(let col=0;col<6;col++){
   const expected=row<3&&col<3?(row===col?diagonal:lambda):(row===col?mu:0);
   if(c[base+row*6+col]!==expected)return 'dense-reference';
  }
 }
 return 'isotropic-intact-v1';
}

export async function createSolidResident(device,descriptor,arrays,{onProgress=()=>{},energyKernel:requestedKernel='auto'}={}){
 if(!['graph','pmb'].includes(descriptor?.kind)||!['points','elements','bonds','colorCount'].every(k=>Number.isInteger(descriptor[k])&&descriptor[k]>0))throw new Error('Complete explicit material descriptor required');
 if(descriptor.bufferLayout!=='compact-color-incidence-v1')throw new Error('Explicit compact material buffer layout required; reprepare legacy buffers');
 const n=descriptor.points,count=descriptor.elements,bondCount=descriptor.bonds;
 const separated=descriptor.constitutiveLayout==='separated-intact-tetrahedra-v1';if(descriptor.constitutiveLayout!==undefined&&!separated)throw new Error('Unknown constitutive layout');if(separated&&descriptor.kind!=='graph')throw new Error('Separated tetrahedral layout requires graph material');
 const barrier=Math.fround(descriptor.volumeBarrier??0);if(!(Number.isFinite(barrier)&&barrier>=0)||barrier>0&&descriptor.kind!=='graph')throw new Error('Explicit nonnegative graph volume barrier required');
 const expected={state:n*16,elements:count*4,bonds:bondCount*4,parameters:count*(descriptor.kind==='graph'?16:4),coefficients:descriptor.kind==='graph'?count*(separated?1:64)*36:1,elementBonds:descriptor.kind==='graph'?count*8:4};
 for(const [name,length] of Object.entries(expected)){const Type=['state','parameters','coefficients'].includes(name)?Float32Array:Uint32Array;if(!(arrays[name] instanceof Type)||arrays[name].length!==length||!arrays[name].every(Number.isFinite))throw new Error(`Complete finite resident ${name} required`);}
 const energyKernel=selectSolidEnergyKernel(descriptor,arrays,requestedKernel);
 if(barrier>0&&Array.from({length:count},(_,i)=>arrays.parameters[i*16+7]).some(v=>v!==barrier))throw new Error('Resident volume barrier coefficients disagree with descriptor');
 if(!(arrays.incidence instanceof Uint32Array)||arrays.incidence.length<n+1)throw new Error('Complete uncapped resident incidence required');
 const colorBase=n+1+arrays.incidence[n]*2;
 if(arrays.incidence.length!==colorBase+descriptor.colorCount+1+n)throw new Error('Complete compact material color schedule required');
 const colorOffsets=Array.from(arrays.incidence.slice(colorBase,colorBase+descriptor.colorCount+1)),colorNodes=Array.from(arrays.incidence.slice(colorBase+descriptor.colorCount+1));
 if(colorOffsets[0]!==0||colorOffsets.at(-1)!==n||new Set(colorNodes).size!==n||colorNodes.some(i=>i>=n)||colorOffsets.some((value,i)=>i&&value<=colorOffsets[i-1]))throw new Error('Compact colors must partition all material points exactly once');
 const colorSizes=colorOffsets.slice(1).map((end,i)=>end-colorOffsets[i]);
 for(let color=0;color<descriptor.colorCount;color++)if(colorNodes.slice(colorOffsets[color],colorOffsets[color+1]).some(node=>arrays.state[node*16+7]!==color))throw new Error('Compact schedule disagrees with material colors');
 for(let i=0;i<n;i++)if(!(arrays.state[i*16+3]>0)||!Number.isInteger(arrays.state[i*16+7])||arrays.state[i*16+7]>=descriptor.colorCount||arrays.state[i*16+7]<0||![0,1].includes(arrays.state[i*16+11]))throw new Error('Positive mass, valid color and support state required');
 for(let i=0;i<count;i++)for(let k=0;k<(descriptor.kind==='graph'?4:2);k++)if(arrays.elements[i*4+k]>=n)throw new Error('Resident element index out of range');
 for(let i=0;i<bondCount;i++)if(arrays.bonds[i*4]>=n||arrays.bonds[i*4+1]>=n||![0,1].includes(arrays.bonds[i*4+2]))throw new Error('Valid resident bond endpoints and liveness required');
 if(separated&&Array.from({length:bondCount},(_,i)=>arrays.bonds[i*4+2]).some(v=>v!==1))throw new Error('Separated material requires intact internal bonds');
 for(let i=0;i<n;i++)if(arrays.incidence[i]>arrays.incidence[i+1])throw new Error('Monotone resident incidence offsets required');
 for(let i=n+1;i<colorBase;i+=2)if(arrays.incidence[i]>=count||arrays.incidence[i+1]>=(descriptor.kind==='graph'?4:2))throw new Error('Resident incident element out of range');
  if(descriptor.kind==='graph')for(let i=0;i<count;i++)for(let k=0;k<6;k++)if(arrays.elementBonds[i*8+k]>=bondCount)throw new Error('Resident graph edge out of range');
 if(descriptor.kind==='graph'){
  const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for(let element=0;element<count;element++)for(let edge=0;edge<6;edge++){
   const [a,b]=pairs[edge].map(local=>arrays.elements[element*4+local]),index=arrays.elementBonds[element*8+edge],x=arrays.bonds[index*4],y=arrays.bonds[index*4+1];
   if(Math.min(a,b)!==Math.min(x,y)||Math.max(a,b)!==Math.max(x,y))throw new Error('Resident constitutive edge disagrees with controlled bond endpoints');
  }
 }else{
  if(count!==bondCount)throw new Error('Resident constitutive bond and element counts must agree');
  for(let i=0;i<count;i++)if(arrays.elements[i*4]!==arrays.bonds[i*4]||arrays.elements[i*4+1]!==arrays.bonds[i*4+1])throw new Error('Resident constitutive bond disagrees with its material element');
 }
 const expectedIncidence=Array.from({length:n},()=>new Set());
 for(let i=0;i<count;i++){const members=Array.from(arrays.elements.slice(i*4,i*4+(descriptor.kind==='graph'?4:2)));if(new Set(members).size!==members.length||new Set(members.map(node=>arrays.state[node*16+7])).size!==members.length)throw new Error('Conflicting material update colors');members.forEach((node,local)=>expectedIncidence[node].add(`${i}:${local}`));}
 if(arrays.incidence[0]!==0)throw new Error('Resident incidence must start at zero');
 for(let node=0;node<n;node++){const actual=new Set();for(let i=arrays.incidence[node];i<arrays.incidence[node+1];i++)actual.add(`${arrays.incidence[n+1+i*2]}:${arrays.incidence[n+2+i*2]}`);if(actual.size!==arrays.incidence[node+1]-arrays.incidence[node]||actual.size!==expectedIncidence[node].size||[...actual].some(key=>!expectedIncidence[node].has(key)))throw new Error('Complete correctly owned material incidence required');}
 const owned=[],buffers={},allocate=(name,size,usage)=>{if(size>device.limits.maxStorageBufferBindingSize)throw new Error(`Resident ${name} exceeds effective storage capacity`);const b=device.createBuffer({label:`Material ${name}`,size,usage});owned.push(b);return b;};
 const runId=crypto.randomUUID();let settings={timeStep:Math.fround(1/60),gravity:0,damping:1,floor:Math.fround(-1e20),lineSearchTrials:8,iterations:0},grip=null,steps=0,damageEpoch=0,operations=Promise.resolve(),failure=null;
 const valid=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'material-command-invalid'});};
 const serial=fn=>{const run=operations.then(()=>{if(failure)throw new Error(failure);return fn();});operations=run.catch(error=>{if(error.code!=='material-command-invalid')failure=error.message;});return run;};
 try{
  for(const name of [...Object.keys(expected),'incidence']){const data=arrays[name];buffers[name]=allocate(name,data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|(name==='state'||name==='bonds'?GPUBufferUsage.COPY_SRC:0));device.queue.writeBuffer(buffers[name],0,data);}
  onProgress('buffers-uploaded');
  buffers.diagnostics=allocate('diagnostics',(n*6+count*7)*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
  const alignment=device.limits.minUniformBufferOffsetAlignment,uniform=device.createBuffer({label:'Material update colors',size:descriptor.colorCount*alignment,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(uniform);
  const {layout,pipelines}=await materialProgram(device,onProgress,energyKernel);onProgress('pipelines-compiled');
  const resources=['state','elements','parameters','coefficients','incidence','bonds','elementBonds','diagnostics'].map(name=>buffers[name]);
  const groups=Array.from({length:descriptor.colorCount},(_,color)=>device.createBindGroup({layout,entries:[...resources.map((buffer,binding)=>({binding,resource:{buffer}})),{binding:8,resource:{buffer:uniform,offset:color*alignment,size:96}}]}));
  const configure=(plane,restricted=false)=>{const bytes=new ArrayBuffer(descriptor.colorCount*alignment);for(let color=0;color<descriptor.colorCount;color++){const u=new Uint32Array(bytes,color*alignment,4),f=new Float32Array(bytes,color*alignment+16,16);u.set([n,color,descriptor.kind==='graph'?0:1,settings.lineSearchTrials]);f.set([settings.timeStep,settings.gravity,settings.damping,settings.floor,grip?.index??-1,grip?.stiffness??0,0,0,...(grip?.target??[0,0,0]),0,...(plane??[0,0,0,0])]);new Uint32Array(bytes,color*alignment+80,4).set([descriptor.colorCount,restricted?1:0,separated?1:0,barrier>0?1:0]);}device.queue.writeBuffer(uniform,0,bytes);};
  const dispatch=(encoder,name,color=0,count=n)=>{const pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,groups[color]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();};
  let mirroredBonds=Array.from(arrays.bonds),bondMirrorEpoch=0;
  async function readNow({full=true,stress=true}={}){configure();const encoder=device.createCommandEncoder();if(full)dispatch(encoder,'diagnose');if(stress&&descriptor.kind==='graph')dispatch(encoder,'stress',0,count);
   const ranges=[{name:'state',offset:0,size:buffers.state.size}];if(full||bondMirrorEpoch!==damageEpoch)ranges.push({name:'bonds',offset:0,size:buffers.bonds.size});if(full||stress&&descriptor.kind==='graph')ranges.push({name:'diagnostics',offset:full?0:n*6*16,size:full?buffers.diagnostics.size:count*7*16});
   const readbacks=ranges.map(({name,size})=>allocate(`readback ${name}`,size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));ranges.forEach(({name,offset,size},i)=>encoder.copyBufferToBuffer(buffers[name],offset,readbacks[i],0,size));device.queue.submit([encoder.finish()]);
   try{onProgress('readback-await');await Promise.all(readbacks.map(b=>b.mapAsync(GPUMapMode.READ)));const mapped=Object.fromEntries(ranges.map(({name},i)=>[name,readbacks[i].getMappedRange()])),state=Array.from(new Float32Array(mapped.state));if(mapped.bonds){mirroredBonds=Array.from(new Uint32Array(mapped.bonds));bondMirrorEpoch=damageEpoch;}const raw=mapped.diagnostics?new Float32Array(mapped.diagnostics):null,diagnostics=full?Array.from(raw.slice(0,n*24)):null;const stresses=stress&&descriptor.kind==='graph'?Array.from({length:count},(_,i)=>{const b=(full?n*24:0)+i*28,matrix=start=>Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>raw[b+start+c*4+r]));return{stress:matrix(0),F:matrix(12),volume:raw[b+24],energy:raw[b+25],active:raw[b+26]===1,invalid:raw[b+27]!==0};}):null;onProgress('readback-complete');return{route:SOLID_RESIDENT_ROUTE,runId,kind:descriptor.kind,model:{kind:descriptor.kind,points:n,elements:count,bonds:bondCount},steps,damageEpoch,settings:{...settings},grip:grip&&structuredClone(grip),state,bonds:[...mirroredBonds],diagnostics,stresses,observation:{kind:full?'full-diagnostic':'frame',stressCurrent:stress&&descriptor.kind==='graph',readbackBytes:ranges.reduce((sum,r)=>sum+r.size,0)},claim:'Resident colored local-energy dynamics and live graph Cauchy stress; selected plane release and point-floor contact remain provisional'};}finally{for(const b of readbacks){b.destroy();owned.splice(owned.indexOf(b),1);}}
  }
  return{route:SOLID_RESIDENT_ROUTE,
   device,stateBuffer(){if(failure)throw new Error(failure);return buffers.state;},
   pin(indices){return serial(()=>{valid(Array.isArray(indices)&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<n),'Valid support point indices required');for(const index of indices)device.queue.writeBuffer(buffers.state,(index*16+11)*4,new Float32Array([1]));});},
   grip(index,target,stiffness){return serial(()=>{valid(Number.isInteger(index)&&index>=0&&index<n&&Array.isArray(target)&&target.length===3&&target.every(v=>Number.isFinite(Math.fround(v)))&&Number.isFinite(Math.fround(stiffness))&&Math.fround(stiffness)>0,'Valid resident grip required');grip={index,target:target.map(Math.fround),stiffness:Math.fround(stiffness)};});},
   capturePatch(patch,stiffness){return serial(async()=>{valid(Array.isArray(patch)&&patch.length&&new Set(patch.map(p=>p.index)).size===patch.length&&patch.every(p=>Number.isInteger(p.index)&&p.index>=0&&p.index<n&&Number.isFinite(p.weight)&&p.weight>0)&&Math.abs(patch.reduce((s,p)=>s+p.weight,0)-1)<1e-6&&Number.isFinite(Math.fround(stiffness))&&stiffness>0,'Normalized finite resident patch required');const weights=new Float32Array(n*24);for(const p of patch)weights[p.index*24+23]=p.weight;device.queue.writeBuffer(buffers.diagnostics,0,weights);grip={index:-2,target:[0,0,0],stiffness:Math.fround(stiffness),patch:structuredClone(patch)};configure();const encoder=device.createCommandEncoder();dispatch(encoder,'capturePatch');device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();});},
   movePatch(displacement){return serial(()=>{valid(grip?.index===-2&&Array.isArray(displacement)&&displacement.length===3&&displacement.every(v=>Number.isFinite(Math.fround(v))),'Active resident patch and finite displacement required');grip.target=displacement.map(Math.fround);});},
   release(){return serial(()=>{grip=null;});},
   step(request,{wait=true}={}){return serial(async()=>{valid(typeof wait==='boolean','Explicit boolean completion policy required');valid(request&&typeof request==='object','Explicit solver settings required');const {iterations,...next}=request;valid(Number.isInteger(iterations)&&iterations>0&&Number.isInteger(next.lineSearchTrials)&&next.lineSearchTrials>0&&next.lineSearchTrials<=0xffffffff&&['timeStep','gravity','damping','floor'].every(k=>Number.isFinite(next[k])&&Number.isFinite(Math.fround(next[k])))&&next.timeStep>0&&Math.fround(Math.fround(next.timeStep)**2)>0&&next.damping>=0&&next.damping<=1,'Explicit valid solver timestep, iterations, trial count, gravity, damping and floor required');settings={...Object.fromEntries(Object.entries(next).map(([key,value])=>[key,key==='lineSearchTrials'?value:Math.fround(value)])),iterations};const start=performance.now();configure();const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass(),run=(name,color=0,size=n)=>{pass.setPipeline(pipelines[name]);pass.setBindGroup(0,groups[color]);pass.dispatchWorkgroups(Math.ceil(size/64));};run('predict');for(let iteration=0;iteration<iterations;iteration++)for(let color=0;color<descriptor.colorCount;color++)run('solve',color,colorSizes[color]);run('finish');pass.end();const command=encoder.finish(),encoded=performance.now();device.queue.submit([command]);const submitted=performance.now();if(wait)await device.queue.onSubmittedWorkDone();const completed=performance.now();steps++;return{encodingMilliseconds:encoded-start,submitMilliseconds:submitted-encoded,completionWaitMilliseconds:wait?completed-submitted:null,totalMilliseconds:completed-start,completion:wait?'completed':'submitted',iterations,colorCount:descriptor.colorCount,solveDispatches:iterations*descriptor.colorCount,solveWorkgroups:iterations*colorSizes.reduce((sum,count)=>sum+Math.ceil(count/64),0)};});},
   damagePlane(normal,offset,nodes){return serial(async()=>{valid(!separated,'Separated material requires an interior cut, not edge removal');valid(Array.isArray(normal)&&normal.length===3&&normal.every(Number.isFinite)&&Math.abs(Math.hypot(...normal)-1)<=1e-6&&Number.isFinite(Math.fround(offset)),'Explicit unit damage plane required');if(nodes!==undefined){valid(Array.isArray(nodes)&&nodes.length&&new Set(nodes).size===nodes.length&&nodes.every(i=>Number.isInteger(i)&&i>=0&&i<n),'Explicit material component nodes required');for(let i=0;i<n;i++)device.queue.writeBuffer(buffers.diagnostics,(i*24+18)*4,new Float32Array([0]));for(const i of nodes)device.queue.writeBuffer(buffers.diagnostics,(i*24+18)*4,new Float32Array([1]));}configure([...normal,offset],nodes!==undefined);const encoder=device.createCommandEncoder();dispatch(encoder,'damage',0,bondCount);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();damageEpoch++;});},
   read(){return serial(async()=>({...await readNow(),energyKernel,volumeBarrier:barrier,constitutiveLayout:descriptor.constitutiveLayout??'directional-edge-release-64-v0'}));},
   readFrame({stress=false}={}){return serial(async()=>{valid(typeof stress==='boolean','Explicit boolean frame stress policy required');return{...await readNow({full:false,stress}),energyKernel,volumeBarrier:barrier,constitutiveLayout:descriptor.constitutiveLayout??'directional-edge-release-64-v0'};});},
   dispose(){for(const b of owned)b.destroy();failure='Resident material disposed';}
  };
 }catch(error){for(const b of owned)b.destroy();throw error;}
}
