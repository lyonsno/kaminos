import {compositeDivergence,COMPOSITE_GRID_ID} from './volume-composite-grid.mjs';
import {createCompositeSolidsGPU} from './volume-composite-solids-gpu.mjs';

// Dormant fixed-topology, diagonal-preconditioned CG candidate. Pressure is warm
// across steps; RHS, directions and reductions are rebuilt from current inputs.
// All iteration decisions stay on GPU. The explicit dispatch budget is still
// encoded in full; converged solves skip arithmetic, not command submission.
// readback adjudicates corrected face flux, independently of recursive residual.
export function createCompositePCGGPU(device,grid,{tolerance=1e-5,uniformCounts=false,residentSolids=false}={}){
  if(!Number.isFinite(tolerance)||tolerance<=0||!Number.isFinite(Math.fround(tolerance))||Math.fround(tolerance)===0)throw new Error('positive float32 tolerance required');
  const n=grid.cells.length,m=grid.faces.length,groups=Math.ceil(n/64);
  if(!n||!m)throw new Error('PCG requires nonempty cells and faces');
  if(Math.ceil(Math.max(n,m)/64)>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('PCG dispatch exceeds device capacity');
  const rows=Array.from({length:n},()=>[]);
  grid.faces.forEach((f,i)=>{const k=f.area/f.distance;rows[f.a].push([f.b,k,i,1]);if(f.b>=0)rows[f.b].push([f.a,k,i,-1]);});
  const nodes=new Float32Array(n*4),links=[];
  grid.cells.forEach((c,i)=>{nodes.set([links.length/4,rows[i].length,c.volume,grid.diagonal[i]],i*4);for(const link of rows[i])links.push(...link);});
  if(Math.max(n,m,links.length/4)>=2**24)throw new Error('topology indices exceed exact float32 integer representation');
  const owned=[],shaders=[];
  const alloc=(label,size,data)=>{if(size>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw new Error(`${label} exceeds device capacity`);
    const b=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;};
  const shader=(label,code)=>{const s=device.createShaderModule({label,code});shaders.push(s);return s;};
  // Opt-in assay: topology counts are data; arithmetic and dispatches stay identical.
  const countsBuffer=(a,b=0)=>{const buffer=device.createBuffer({label:'PCG counts',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(buffer);device.queue.writeBuffer(buffer,0,new Uint32Array([a,b,0,0]));return buffer;};
  const counts=uniformCounts?countsBuffer(n,m):null;
  let nodeBuffer,linkBuffer,faceBuffer,fluxBuffer,cells,control,partials;
  try{
    nodeBuffer=alloc('PCG nodes',nodes.byteLength,nodes);const packed=Float32Array.from(links);linkBuffer=alloc('PCG adjacency',packed.byteLength,packed);
    faceBuffer=alloc('PCG faces',m*16,Float32Array.from(grid.faces.flatMap(f=>[f.a,f.b,f.area/f.distance,f.area/f.distance])));
    fluxBuffer=alloc('PCG shared flux',m*4);cells=alloc('PCG cell state',n*32);control=alloc('PCG control',32);
    partials=[alloc('PCG partial reduction',groups*16)];let count=groups;
    while(count>1){count=Math.ceil(count/64);partials.push(alloc('PCG reduction level',count*16));}
  }catch(e){for(const b of owned)b.destroy();throw e;}
  const solids=residentSolids?createCompositeSolidsGPU(device,grid,{nodes:nodeBuffer,links:linkBuffer,faces:faceBuffer,flux:fluxBuffer,cells}):null;
  if(solids)shaders.push(...solids.shaders);
  const common=/* wgsl */`
fn finite(x:f32)->bool{return abs(x)<=3.402823466e38;}
fn combine(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return vec4<f32>(a.x+b.x,0.0,max(a.z,b.z),max(a.w,b.w));}
var<workgroup> scratch:array<vec4<f32>,64>;
`;
  const main=shader('warm composite PCG',/* wgsl */`
${uniformCounts?'@group(0) @binding(7) var<uniform> counts:vec4<u32>;':`const N:u32=${n}u;const M:u32=${m}u;`}
struct Cell{p:f32,r:f32,d:f32,ad:f32,rhs:f32,expansion:f32,pad0:f32,pad1:f32}
@group(0) @binding(0) var<storage,read> nodes:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> links:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> faces:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> flux:array<f32>;
@group(0) @binding(4) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(5) var<storage,read_write> partial:array<vec4<f32>>;
// rho,alpha,beta,active,reserved,iterations,failure,trueResidual
@group(0) @binding(6) var<storage,read_write> ctrl:array<f32>;
${residentSolids?`@group(0) @binding(${uniformCounts?8:7}) var<storage,read> active:array<u32>;`:''}
${common}
fn emit(value:vec4<f32>,lane:u32,group:u32){
  scratch[lane]=value;workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){scratch[lane]=combine(scratch[lane],scratch[lane+stride]);}workgroupBarrier();}
  if(lane==0u){partial[group]=scratch[0];}
}
fn component(i:u32,direction:bool)->f32{if(direction){return cells[i].d;}return cells[i].p;}
fn product(i:u32,direction:bool)->f32{
  let row=nodes[i];var v=component(i,direction)*row.w;
  for(var j=0u;j<u32(row.y);j++){let link=links[u32(row.x)+j];if(link.x>=0.0){let k=u32(link.x);v-=${residentSolids?'faces[u32(link.z)].z':'link.y'}*component(k,direction);}}
  return v;
}
@compute @workgroup_size(64) fn recover(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<N&&ctrl[6]>0.0){cells[id.x].p=0.0;}}
@compute @workgroup_size(64) fn initialize(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
  let i=id.x;var value=vec4<f32>(0.0);
  if(i<N){let row=nodes[i];var sum=0.0;var bad=0.0;
    ${residentSolids?'if(active[i]==0u){cells[i].expansion=0.0;}':''}
    for(var j=0u;j<u32(row.y);j++){let link=links[u32(row.x)+j];let q=flux[u32(link.z)];sum+=q*link.w;if(!finite(q)){bad=1.0;}}
    let b=cells[i].expansion*row.z-sum;let r=b-product(i,false);let z=r/max(row.w,1e-30);
    cells[i].rhs=b;cells[i].r=r;cells[i].d=z;
    if(!finite(b)||!finite(r)||!finite(z)||!finite(cells[i].expansion)){bad=1.0;}
    value=vec4<f32>(r*z,0.0,abs(r)/row.z,bad);
  }emit(value,lane,group.x);
}
@compute @workgroup_size(64) fn apply(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
  let i=id.x;var value=vec4<f32>(0.0);
  if(i<N&&ctrl[3]>0.0){let ad=product(i,true);cells[i].ad=ad;let v=cells[i].d*ad;value=vec4<f32>(v,0.0,0.0,select(1.0,0.0,finite(v)));}emit(value,lane,group.x);
}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i<N&&ctrl[3]>0.0){cells[i].p+=ctrl[1]*cells[i].d;cells[i].r-=ctrl[1]*cells[i].ad;}
}
@compute @workgroup_size(64) fn measure(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
  let i=id.x;var value=vec4<f32>(0.0);
  if(i<N&&ctrl[3]>0.0){let row=nodes[i];let r=cells[i].r;let trueR=cells[i].rhs-product(i,false);let rho=r*r/max(row.w,1e-30);
    value=vec4<f32>(rho,0.0,abs(trueR)/row.z,select(1.0,0.0,finite(rho)&&finite(trueR)&&finite(cells[i].p)));}emit(value,lane,group.x);
}
@compute @workgroup_size(64) fn direction(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i<N&&ctrl[3]>0.0){cells[i].d=cells[i].r/max(nodes[i].w,1e-30)+ctrl[2]*cells[i].d;}
}
@compute @workgroup_size(64) fn project(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i<M&&ctrl[6]==0.0){let f=faces[i];var pb=0.0;if(f.y>=0.0){pb=cells[u32(f.y)].p;}flux[i]+=f.z*(cells[u32(f.x)].p-pb);}
}`.replace(/\b(N|M)\b/g,x=>uniformCounts?(x==='N'?'counts.x':'counts.y'):x));
  const layout=device.createBindGroupLayout({entries:Array.from({length:7+Number(uniformCounts)+Number(residentSolids)},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7&&uniformCounts?'uniform':binding<3||binding===7+Number(uniformCounts)?'read-only-storage':'storage'}}))});
  const pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['recover','initialize','apply','update','measure','direction','project'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pl,compute:{module:main,entryPoint}})]));
  const bind=device.createBindGroup({layout,entries:[nodeBuffer,linkBuffer,faceBuffer,fluxBuffer,cells,partials[0],control,...(counts?[counts]:[]),...(solids?[solids.active]:[])].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const reductions=[];let count=groups;
  for(let level=1;level<partials.length;level++){
    const s=shader('PCG hierarchical reduction',/* wgsl */`
@group(0) @binding(0) var<storage,read> src:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> dst:array<vec4<f32>>;
${uniformCounts?'@group(0) @binding(2) var<uniform> counts:vec4<u32>;':''}
${common}
@compute @workgroup_size(64) fn reduce(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
  var v=vec4<f32>(0.0);if(id.x<${uniformCounts?'counts.x':`${count}u`}){v=src[id.x];}scratch[lane]=v;workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){scratch[lane]=combine(scratch[lane],scratch[lane+stride]);}workgroupBarrier();}
  if(lane==0u){dst[group.x]=scratch[0];}
}`);
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module:s,entryPoint:'reduce'}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[partials[level-1],partials[level],...(uniformCounts?[countsBuffer(count)]:[])].map((buffer,binding)=>({binding,resource:{buffer}}))});
    count=Math.ceil(count/64);reductions.push({pipeline,group,count});
  }
  const decisions=shader('PCG scalar decisions',/* wgsl */`
@group(0) @binding(0) var<storage,read> reduced:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> ctrl:array<f32>;
const TOL:f32=${Math.fround(tolerance)};
fn finite(x:f32)->bool{return abs(x)<=3.402823466e38;}
fn fail(){ctrl[6]=1.0;ctrl[3]=0.0;}
@compute @workgroup_size(1) fn start(){let v=reduced[0];ctrl[0]=v.x;ctrl[5]=0.0;ctrl[6]=0.0;ctrl[7]=v.z;ctrl[3]=select(0.0,1.0,v.z>TOL);
  if(v.w>0.0||!finite(v.x)||!finite(v.z)){fail();}}
@compute @workgroup_size(1) fn alpha(){if(ctrl[3]==0.0){return;}let v=reduced[0];
  if(v.w>0.0||!finite(v.x)||v.x<=0.0||ctrl[0]<=0.0){fail();return;}ctrl[1]=ctrl[0]/v.x;if(!finite(ctrl[1])){fail();}}
@compute @workgroup_size(1) fn beta(){if(ctrl[3]==0.0){return;}let v=reduced[0];ctrl[5]+=1.0;ctrl[7]=v.z;
  if(v.w>0.0||!finite(v.x)||!finite(v.z)){fail();return;}
  if(v.z<=TOL){ctrl[3]=0.0;return;}ctrl[2]=v.x/ctrl[0];ctrl[0]=v.x;if(!finite(ctrl[2])||v.x<=0.0){fail();}}
`);
  const decisionPipelines=Object.fromEntries(['start','alpha','beta'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:'auto',compute:{module:decisions,entryPoint}})]));
  const decisionGroups=Object.fromEntries(Object.entries(decisionPipelines).map(([name,p])=>[name,device.createBindGroup({layout:p.getBindGroupLayout(0),entries:[partials.at(-1),control].map((buffer,binding)=>({binding,resource:{buffer}}))})]));
  const intakeShader=shader('PCG target intake',/* wgsl */`
@group(0) @binding(0) var<storage,read> expansion:array<f32>;
@group(0) @binding(1) var<storage,read_write> cells:array<f32>;
${uniformCounts?'@group(0) @binding(2) var<uniform> counts:vec4<u32>;':''}
@compute @workgroup_size(64) fn intake(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<${uniformCounts?'counts.x':`${n}u`}){cells[id.x*8u+5u]=expansion[id.x];}}
`);
  const intake=device.createComputePipeline({layout:'auto',compute:{module:intakeShader,entryPoint:'intake'}}),cpuTarget=alloc('PCG CPU input target',n*4);
  let generation=0,encoded=-1,inputRoute='none',hasInput=false,destroyed=false,budget=0,warm=false,hasPressure=false;
  const alive=()=>{if(destroyed)throw new Error('PCG destroyed');};
  const validate=iterations=>{alive();if(!Number.isInteger(iterations)||iterations<0)throw new Error('explicit nonnegative iteration budget required');};
  const encode=(encoder,targetBuffer,iterations,reset)=>{
    if(reset){encoder.clearBuffer(cells);encoder.clearBuffer(control);}
    solids?.encode(encoder);
    const group=device.createBindGroup({layout:intake.getBindGroupLayout(0),entries:[targetBuffer,cells,...(counts?[counts]:[])].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass({label:'warm composite PCG'});
    const call=(pipeline,group,count)=>{pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);};
    const mainCall=(name,count=groups)=>call(pipelines[name],bind,count);
    const reduce=()=>{for(const r of reductions)call(r.pipeline,r.group,r.count);};
    const decide=name=>call(decisionPipelines[name],decisionGroups[name],1);
    call(intake,group,groups);mainCall('recover');mainCall('initialize');reduce();decide('start');
    for(let i=0;i<iterations;i++){mainCall('apply');reduce();decide('alpha');mainCall('update');mainCall('measure');reduce();decide('beta');mainCall('direction');}
    mainCall('project',Math.ceil(m/64));pass.end();
    warm=hasPressure&&!reset;hasPressure=true;budget=iterations;hasInput=false;encoded=generation;
  };
  return {shaders,fluxBuffer,
    bindSolids(textures){alive();if(!solids)throw Error('resident solids not enabled');solids.bind(textures);},
    setInput(flux,target=new Float32Array(n)){
      alive();if(flux.length!==m||target.length!==n||!flux.every(Number.isFinite)||!target.every(Number.isFinite))throw new Error('finite complete flux/target arrays required');
      const q=Float32Array.from(flux),t=Float32Array.from(target);if(!q.every(Number.isFinite)||!t.every(Number.isFinite))throw new Error('input exceeds float32 range');
      const d=compositeDivergence(grid,q);for(const c of grid.components)if(!c.grounded){const sum=c.ids.reduce((s,i)=>s+(t[i]-d[i])*grid.cells[i].volume,0);if(Math.abs(sum)>tolerance*c.ids.reduce((s,i)=>s+grid.cells[i].volume,0))throw new Error('sealed component has incompatible net source/flux');}
      device.queue.writeBuffer(fluxBuffer,0,q);device.queue.writeBuffer(cpuTarget,0,t);hasInput=true;generation++;inputRoute='cpu-upload';
    },
    encode(encoder,{iterations,reset=false}={}){validate(iterations);if(!hasInput)throw new Error('setInput required before projection');encode(encoder,cpuTarget,iterations,reset);},
    encodeGPU(encoder,{targetBuffer,iterations,reset=false}={}){
      validate(iterations);if(!targetBuffer||targetBuffer.size!==n*4||!(targetBuffer.usage&GPUBufferUsage.STORAGE)||owned.includes(targetBuffer))throw new Error('distinct complete GPU target storage required');
      generation++;inputRoute='gpu-buffers';encode(encoder,targetBuffer,iterations,reset);
    },
    async readback(){
      alive();if(encoded<0||encoded!==generation)throw new Error('current input has not been encoded');
      const captured=generation,b=device.createBuffer({size:m*4+n*32+32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const e=device.createCommandEncoder();e.copyBufferToBuffer(fluxBuffer,0,b,0,m*4);e.copyBufferToBuffer(cells,0,b,m*4,n*32);e.copyBufferToBuffer(control,0,b,m*4+n*32,32);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
        if(captured!==generation)throw new Error('projection changed during readback');
        const raw=b.getMappedRange(),flux=new Float32Array(raw.slice(0,m*4)),state=new Float32Array(raw.slice(m*4,m*4+n*32)),c=new Float32Array(raw.slice(m*4+n*32));
        const pressure=Float32Array.from({length:n},(_,i)=>state[i*8]),target=Float32Array.from({length:n},(_,i)=>state[i*8+5]);
        const d=compositeDivergence(grid,flux),maxDivergenceError=d.reduce((s,v,i)=>Math.max(s,Math.abs(v-target[i])),0),targetFinite=target.every(Number.isFinite);
        const converged=c[6]===0&&targetFinite&&pressure.every(Number.isFinite)&&Number.isFinite(maxDivergenceError)&&maxDivergenceError<=tolerance;
        return {flux,pressure,target,converged,receipt:{identity:COMPOSITE_GRID_ID,route:'gpu-composite-pcg-candidate',inputRoute,generation:captured,iterations:c[5],iterationBudget:budget,warmStartRequested:warm,tolerance,maxDivergenceError,gpuTrueResidual:c[7],breakdown:c[6]!==0,converged,targetFinite,cells:n,faces:m,innerFeedback:true,liveFlame:false}};
      }finally{b.destroy();}
    },
    destroy(){if(!destroyed){solids?.destroy();owned.forEach(b=>b.destroy());destroyed=true;}},
  };
}
