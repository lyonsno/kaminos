// Matrix-free unsmoothed-aggregation multigrid PCG.
// Algorithm: Sun et al., Leapfrog Flow Maps, TOG 2025, sections 5.1/5.3.
// This WGSL implementation uses explicit dispatch ordering and a symmetric
// smoother. It does not yet reproduce the CUDA tiled/fused/trimmed fast path.
export const AMGPCG_IDENTITY='kaminos.pressure.uaamg-pcg.v1';

export function resolvePressureAlgorithm(c,converged,enabled) {
  const algorithm=c.pressureAlgorithm??'sor';
  if(!['sor','amgpcg'].includes(algorithm))throw Error(`Unknown pressure algorithm: ${algorithm}`);
  if(algorithm==='amgpcg'&&!converged)throw Error('AMGPCG requires a converged pressure boundary mode');
  const iterations=c.pressureCgIterations===undefined?6:Number(c.pressureCgIterations);
  if(algorithm==='amgpcg'&&(!Number.isSafeInteger(iterations)||iterations<1))throw Error('CG iterations must be a positive integer');
  return {algorithm,iterations:enabled?iterations:0};
}

export function amgpcgPlan(dims,limits={}) {
  if(!Array.isArray(dims)||dims.length!==3||dims.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('AMGPCG dimensions must be three positive integers');
  const levels=[{dims:[...dims],count:dims.reduce((a,b)=>a*b,1)}];
  while(Math.max(...levels.at(-1).dims)>8){const d=levels.at(-1).dims.map(n=>Math.ceil(n/2));levels.push({dims:d,count:d.reduce((a,b)=>a*b,1)});}
  const count=levels[0].count,groups=Math.ceil(count/128);
  let bytes=0;
  for(const l of levels){for(const size of [l.count*16,l.count*4,l.count*4]){if(size>Math.min(limits.maxBufferSize??Infinity,limits.maxStorageBufferBindingSize??Infinity))throw Error('AMGPCG buffer exceeds acquired GPU limits');bytes+=size;}bytes+=48;}
  for(const size of [count*4,count*16,groups*16,32,48,32]){if(size>Math.min(limits.maxBufferSize??Infinity,limits.maxStorageBufferBindingSize??Infinity))throw Error('AMGPCG buffer exceeds acquired GPU limits');bytes+=size;}
  bytes+=(levels.length-1)*48;
  if((limits.maxComputeWorkgroupStorageSize??16384)<12288)throw Error('AMGPCG coarse solve requires 12 KiB workgroup storage');
  return {identity:AMGPCG_IDENTITY,levels,count,groups,residentBytes:bytes,coarseSymmetricSweeps:10,prolongationScale:2};
}

const gridWgsl=`
struct Params { dims:vec4<u32>, other:vec4<u32>, flags:vec4<u32> };
@group(0) @binding(0) var<uniform> u:Params;
fn inside(c:vec3<i32>,d:vec3<u32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(d));}
fn index(c:vec3<i32>,d:vec3<u32>)->u32{return u32(c.x)+d.x*(u32(c.y)+d.y*u32(c.z));}
fn position(i:u32,d:vec3<u32>)->vec3<i32>{return vec3<i32>(vec3<u32>(i%d.x,(i/d.x)%d.y,i/(d.x*d.y)));}
fn axis(a:u32)->vec3<i32>{var v=vec3<i32>(0);v[a]=1;return v;}
`;

export const AMGPCG_MULTIGRID_WGSL=gridWgsl+`
@group(0) @binding(1) var<storage,read_write> coef:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> x:array<f32>;
@group(0) @binding(3) var<storage,read_write> b:array<f32>;
@group(0) @binding(4) var<storage,read> otherCoef:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> otherX:array<f32>;
@group(0) @binding(6) var<storage,read_write> otherB:array<f32>;
fn neighborSum(c:vec3<i32>)->f32{
 let i=index(c,u.dims.xyz);var sum=0.0;
 for(var a=0u;a<3u;a++){let p=c+axis(a);let n=c-axis(a);
  if(inside(p,u.dims.xyz)){sum+=coef[i][a+1u]*x[index(p,u.dims.xyz)];}
  if(inside(n,u.dims.xyz)){let j=index(n,u.dims.xyz);sum+=coef[j][a+1u]*x[j];}
 }return sum;
}
fn smoothCell(c:vec3<u32>,parity:u32){
 if(any(c>=u.dims.xyz)||((c.x+c.y+c.z)&1u)!=parity){return;}
 let i=index(vec3<i32>(c),u.dims.xyz);let diagonal=coef[i].x;
 if(diagonal>0.0){x[i]=(b[i]+neighborSum(vec3<i32>(c)))/diagonal;}else{x[i]=0.0;}
}
@compute @workgroup_size(4,4,4) fn red(@builtin(global_invocation_id)c:vec3<u32>){smoothCell(c,0u);}
@compute @workgroup_size(4,4,4) fn black(@builtin(global_invocation_id)c:vec3<u32>){smoothCell(c,1u);}

// R=P^T/8, constant P. Diagonal includes exposed Dirichlet faces, while
// internal fine edges cancel in R*A*P. Partial edge aggregates keep this same R.
@compute @workgroup_size(4,4,4) fn coarsen(@builtin(global_invocation_id)c:vec3<u32>){
 if(any(c>=u.dims.xyz)){return;}var result=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var xx=0;xx<2;xx++){
  let q=vec3<i32>(c*2u)+vec3<i32>(xx,y,z);if(!inside(q,u.other.xyz)){continue;}
  let v=otherCoef[index(q,u.other.xyz)];result.x+=v.x;
  for(var a=0u;a<3u;a++){let n=q+axis(a);if(!inside(n,u.other.xyz)){continue;}
   if(all(vec3<u32>(n)/2u==c)){result.x-=2.0*v[a+1u];}else{result[a+1u]+=v[a+1u];}
  }
 }}}
 coef[index(vec3<i32>(c),u.dims.xyz)]=result*0.125;
}
@compute @workgroup_size(4,4,4) fn restrictResidual(@builtin(global_invocation_id)c:vec3<u32>){
 if(any(c>=u.other.xyz)){return;}var sum=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var xx=0;xx<2;xx++){
  let q=vec3<i32>(c*2u)+vec3<i32>(xx,y,z);if(!inside(q,u.dims.xyz)){continue;}
  let i=index(q,u.dims.xyz);if(coef[i].x>0.0){sum+=b[i]-coef[i].x*x[i]+neighborSum(q);}
 }}}
 let j=index(vec3<i32>(c),u.other.xyz);otherB[j]=sum*0.125;otherX[j]=0.0;
}
@compute @workgroup_size(4,4,4) fn prolong(@builtin(global_invocation_id)c:vec3<u32>){
 if(any(c>=u.dims.xyz)){return;}let i=index(vec3<i32>(c),u.dims.xyz);
 if(coef[i].x>0.0){x[i]+=2.0*otherX[index(vec3<i32>(c/2u),u.other.xyz)];}
}

// The whole bottom lattice fits in one workgroup. No cross-workgroup barrier
// is assumed. 512*(16+4+4)=12 KiB, including boundary/occupancy in the diagonal.
var<workgroup> cx:array<f32,512>;
var<workgroup> cb:array<f32,512>;
var<workgroup> ca:array<vec4<f32>,512>;
fn coarseSmooth(lane:u32,parity:u32){
 for(var i=lane;i<u.dims.w;i+=128u){let c=position(i,u.dims.xyz);
  if(((c.x+c.y+c.z)&1)!=i32(parity)){continue;}let diagonal=ca[i].x;var sum=0.0;
  for(var a=0u;a<3u;a++){let p=c+axis(a);let n=c-axis(a);
   if(inside(p,u.dims.xyz)){sum+=ca[i][a+1u]*cx[index(p,u.dims.xyz)];}
   if(inside(n,u.dims.xyz)){let j=index(n,u.dims.xyz);sum+=ca[j][a+1u]*cx[j];}
  }
  if(diagonal>0.0){cx[i]=(cb[i]+sum)/diagonal;}else{cx[i]=0.0;}
 }
 workgroupBarrier();
}
@compute @workgroup_size(128) fn coarseSolve(@builtin(local_invocation_index)lane:u32){
 for(var i=lane;i<u.dims.w;i+=128u){cx[i]=0.0;cb[i]=b[i];ca[i]=coef[i];}workgroupBarrier();
 for(var n=0;n<5;n++){coarseSmooth(lane,0u);coarseSmooth(lane,1u);}
 for(var n=0;n<5;n++){coarseSmooth(lane,1u);coarseSmooth(lane,0u);}
 for(var i=lane;i<u.dims.w;i+=128u){x[i]=cx[i];}
}
`;

export const AMGPCG_CG_WGSL=gridWgsl+`
@group(0) @binding(1) var<storage,read> coef:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> solution:array<f32>;
@group(0) @binding(3) var<storage,read_write> residual:array<f32>;
@group(0) @binding(4) var<storage,read_write> vectors:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> stats:array<f32>;
@group(0) @binding(6) var<storage,read_write> partials:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> preconditioned:array<f32>;
fn apply(i:u32,direction:bool)->f32{
 let c=position(i,u.dims.xyz);var value=0.0;
 if(direction){value=coef[i].x*vectors[i].x;}else{value=coef[i].x*solution[i];}
 for(var a=0u;a<3u;a++){let p=c+axis(a);let n=c-axis(a);
  if(inside(p,u.dims.xyz)){let j=index(p,u.dims.xyz);var v=solution[j];if(direction){v=vectors[j].x;}value-=coef[i][a+1u]*v;}
  if(inside(n,u.dims.xyz)){let j=index(n,u.dims.xyz);var v=solution[j];if(direction){v=vectors[j].x;}value-=coef[j][a+1u]*v;}
 }return value;
}
var<workgroup> sums:array<vec4<f32>,128>;
fn blockSum(lane:u32,value:vec4<f32>)->vec4<f32>{
 sums[lane]=value;workgroupBarrier();
 for(var stride=64u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 return sums[0];
}
@compute @workgroup_size(128) fn rhsSum(@builtin(global_invocation_id)g:vec3<u32>,@builtin(local_invocation_index)lane:u32,@builtin(workgroup_id)group:vec3<u32>){
 var v=vec4<f32>(0);if(g.x<u.dims.w&&coef[g.x].x>0.0){v=vec4<f32>(residual[g.x],1,0,0);}
 let total=blockSum(lane,v);if(lane==0u){partials[group.x]=total;}
}
@compute @workgroup_size(128) fn initialize(@builtin(global_invocation_id)g:vec3<u32>){
 let i=g.x;if(i>=u.dims.w){return;}var r=0.0;
 if(coef[i].x>0.0){r=residual[i]-select(0.0,stats[5],u.flags.x==1u)-apply(i,false);}
 vectors[i]=vec4<f32>(0,0,r,0);residual[i]=r;preconditioned[i]=0.0;
}
@compute @workgroup_size(128) fn directionDot(@builtin(global_invocation_id)g:vec3<u32>,@builtin(local_invocation_index)lane:u32,@builtin(workgroup_id)group:vec3<u32>){
 var v=vec4<f32>(0);if(g.x<u.dims.w){let i=g.x;let ap=apply(i,true);vectors[i].y=ap;v.x=vectors[i].x*ap;}
 let total=blockSum(lane,v);if(lane==0u){partials[group.x]=total;}
}
@compute @workgroup_size(128) fn residualDot(@builtin(global_invocation_id)g:vec3<u32>,@builtin(local_invocation_index)lane:u32,@builtin(workgroup_id)group:vec3<u32>){
 var v=vec4<f32>(0);if(g.x<u.dims.w){let i=g.x;let r=vectors[i].z;v=vec4<f32>(r*preconditioned[i],r*r,0,0);}
 let total=blockSum(lane,v);if(lane==0u){partials[group.x]=total;}
}
fn totalPartials(lane:u32)->vec4<f32>{var v=vec4<f32>(0);for(var i=lane;i<u.other.w;i+=128u){v+=partials[i];}return blockSum(lane,v);}
@compute @workgroup_size(128) fn reduceRhs(@builtin(local_invocation_index)lane:u32){
 let v=totalPartials(lane);if(lane==0u){stats[5]=v.x/max(v.y,1.0);}
}
@compute @workgroup_size(128) fn reduceDirection(@builtin(local_invocation_index)lane:u32){
 let v=totalPartials(lane);if(lane==0u){stats[3]=v.x;stats[1]=0.0;
  if(v.x>0.0){stats[1]=stats[0]/v.x;}else if(stats[0]>0.0){stats[6]=1.0;}
  stats[7]+=1.0;
 }
}
@compute @workgroup_size(128) fn reduceResidual(@builtin(local_invocation_index)lane:u32){
 let v=totalPartials(lane);if(lane==0u){var beta=0.0;if(stats[0]>0.0){beta=v.x/stats[0];}stats[2]=beta;stats[0]=v.x;stats[4]=v.y;}
}
@compute @workgroup_size(128) fn updateDirection(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i<u.dims.w){vectors[i].x=preconditioned[i]+stats[2]*vectors[i].x;}}
@compute @workgroup_size(128) fn updateSolution(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=u.dims.w){return;}
 solution[i]+=stats[1]*vectors[i].x;let r=vectors[i].z-stats[1]*vectors[i].y;
 vectors[i].z=r;residual[i]=r;preconditioned[i]=0.0;
}
`;

export const AMGPCG_BRIDGE_WGSL=`
struct Bridge {dims:vec4<u32>,flags:vec4<u32>};
@group(0) @binding(0) var<uniform> u:Bridge;
@group(0) @binding(1) var<storage,read_write> pressure:array<vec4<f32>>;
@group(0) @binding(2) var solids:texture_3d<u32>;
@group(0) @binding(3) var<storage,read_write> coef:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> solution:array<f32>;
@group(0) @binding(5) var<storage,read_write> rhs:array<f32>;
fn inside(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(u.dims.xyz));}
fn index(c:vec3<i32>)->u32{return u32(c.x)+u.dims.x*(u32(c.y)+u.dims.y*u32(c.z));}
fn blocked(c:vec3<i32>)->bool{return inside(c)&&u.flags.y==1u&&textureLoad(solids,c,0).x!=0u;}
@compute @workgroup_size(4,4,4) fn importPressure(@builtin(global_invocation_id)g:vec3<u32>){
 if(any(g>=u.dims.xyz)){return;}let c=vec3<i32>(g);let i=index(c);var a=vec4<f32>(0);
 if(!blocked(c)){
  for(var axis=0u;axis<3u;axis++){var d=vec3<i32>(0);d[axis]=1;
   for(var sign=-1;sign<=1;sign+=2){let n=c+d*sign;
    if(inside(n)){if(!blocked(n)){a.x+=1.0;if(sign==1){a[axis+1u]=1.0;}}}
    else if((u.flags.x&2u)!=0u||(axis==1u&&sign==1&&(u.flags.x&1u)!=0u)){a.x+=1.0;}
   }
  }
 }
 coef[i]=a;rhs[i]=select(0.0,-pressure[i].x,a.x>0.0);
 solution[i]=select(0.0,pressure[i].y,u.flags.z==1u&&a.x>0.0);
}
@compute @workgroup_size(4,4,4) fn exportPressure(@builtin(global_invocation_id)g:vec3<u32>){if(any(g>=u.dims.xyz)){return;}let i=index(vec3<i32>(g));pressure[i].y=solution[i];}
`;

const devicePipelines=new WeakMap();
const used={
 coarsen:[0,1,4],red:[0,1,2,3],black:[0,1,2,3],restrictResidual:[0,1,2,3,5,6],prolong:[0,1,2,5],coarseSolve:[0,1,2,3],
 rhsSum:[0,1,3,6],reduceRhs:[0,5,6],initialize:[0,1,2,3,4,5,7],
 directionDot:[0,1,2,4,6],residualDot:[0,4,6,7],reduceDirection:[0,5,6],reduceResidual:[0,5,6],updateDirection:[0,4,5,7],updateSolution:[0,2,3,4,5,7],
 importPressure:[0,1,2,3,4,5],exportPressure:[0,1,4],
};
function pipelinesFor(device){
 if(devicePipelines.has(device))return devicePipelines.get(device);
 const all={};
 for(const [code,names] of [[AMGPCG_MULTIGRID_WGSL,['coarsen','red','black','restrictResidual','prolong','coarseSolve']],[AMGPCG_CG_WGSL,['rhsSum','reduceRhs','initialize','directionDot','residualDot','reduceDirection','reduceResidual','updateDirection','updateSolution']],[AMGPCG_BRIDGE_WGSL,['importPressure','exportPressure']]]){
  const module=device.createShaderModule({label:'AMGPCG',code});
  for(const entryPoint of names)all[entryPoint]=device.createComputePipeline({label:`AMGPCG ${entryPoint}`,layout:'auto',compute:{module,entryPoint}});
 }
 devicePipelines.set(device,all);return all;
}

export function createAmgpcgPressure(device,dims){
 const plan=amgpcgPlan(dims,device.limits),pipelines=pipelinesFor(device),owned=[];
 const buffer=(label,size,extra=0)=>{const b=device.createBuffer({label:`AMGPCG ${label}`,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|extra});owned.push(b);return b;};
 const uniform=(label,values)=>{const b=device.createBuffer({label:`AMGPCG ${label}`,size:values.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,values);return b;};
 const levels=plan.levels.map((l,i)=>({...l,coef:buffer(`coefficients ${i}`,l.count*16),x:buffer(`correction ${i}`,l.count*4),b:buffer(`residual ${i}`,l.count*4)}));
 levels.forEach((l,i)=>{const next=levels[i+1]??l;l.uniform=uniform(`level ${i}`,new Uint32Array([...l.dims,l.count,...next.dims,next.count,0,0,0,0]));if(i){const fine=levels[i-1];l.coarsenUniform=uniform(`coarsen ${i}`,new Uint32Array([...l.dims,l.count,...fine.dims,fine.count,0,0,0,0]));}});
 const top=levels[0],solution=buffer('solution',plan.count*4),vectors=buffer('CG vectors',plan.count*16),stats=buffer('CG scalars',32),partials=buffer('dot partials',plan.groups*16);
 const cgValues=new Uint32Array([...dims,plan.count,0,0,0,plan.groups,0,0,0,0]);
 const cgUniform=uniform('CG dimensions',cgValues),bridgeValues=new Uint32Array([...dims,plan.count,0,0,1,0]),bridgeUniform=uniform('existing pressure bridge',bridgeValues);
 const groups=new Map();let lastPressure=null,lastSolid=null,bridgeResources=null;
 const resource=v=>v?.createView?v.createView():{buffer:v};
 function group(stage,resources){const candidates=groups.get(stage)??[];for(const c of candidates)if(used[stage].every(i=>c.resources[i]===resources[i]))return c.group;
  const value=device.createBindGroup({label:`AMGPCG ${stage}`,layout:pipelines[stage].getBindGroupLayout(0),entries:used[stage].map(binding=>({binding,resource:resource(resources[binding])}))});candidates.push({resources,group:value});groups.set(stage,candidates);return value;
 }
 const mgResources=levels.map((l,i)=>{const next=levels[i+1]??l;return [l.uniform,l.coef,l.x,l.b,l.coef,next.x,next.b];});
 const cgResources=[cgUniform,top.coef,solution,top.b,vectors,stats,partials,top.x];
 const cells=d=>d.map(n=>Math.ceil(n/4));
 let encodeCount=0;
 return {plan,solution,stats,coefficients:top.coef,levels,
  encode(encoder,{pressure,solid,openTop=false,openWorld=false,iterations=6,warmStart=true,timestampWrites}={}){
   if(!Number.isSafeInteger(iterations)||iterations<1)throw Error('CG iterations must be a positive integer');
   if(!pressure||!solid)throw Error('AMGPCG requires pressure buffer and solid texture');
   if(lastPressure!==pressure||lastSolid!==solid){for(const name of ['importPressure','exportPressure'])groups.delete(name);lastPressure=pressure;lastSolid=solid;bridgeResources=[bridgeUniform,pressure,solid,top.coef,solution,top.b];}
   bridgeValues[4]=(openTop?1:0)|(openWorld?2:0);bridgeValues[5]=solid.width===dims[0]&&solid.height===dims[1]&&solid.depthOrArrayLayers===dims[2]?1:0;bridgeValues[6]=warmStart?1:0;
   cgValues[8]=!openTop&&!openWorld?1:0;
   device.queue.writeBuffer(bridgeUniform,0,bridgeValues);device.queue.writeBuffer(cgUniform,0,cgValues);device.queue.writeBuffer(stats,0,new Float32Array(8));
   const pass=encoder.beginComputePass({label:'AMGPCG pressure solve',...(timestampWrites?{timestampWrites}:{})});
   const run=(stage,res,dispatch)=>{pass.setPipeline(pipelines[stage]);pass.setBindGroup(0,group(stage,res));pass.dispatchWorkgroups(...dispatch);};
   run('importPressure',bridgeResources,cells(dims));
   for(let i=1;i<levels.length;i++)run('coarsen',[levels[i].coarsenUniform,levels[i].coef,null,null,levels[i-1].coef],cells(levels[i].dims));
   if(cgValues[8]){run('rhsSum',cgResources,[plan.groups]);run('reduceRhs',cgResources,[1]);}
   run('initialize',cgResources,[plan.groups]);
   const vcycle=()=>{
    for(let i=0;i<levels.length-1;i++){const l=levels[i],r=mgResources[i];run('red',r,cells(l.dims));run('black',r,cells(l.dims));run('restrictResidual',r,cells(levels[i+1].dims));}
    run('coarseSolve',mgResources.at(-1),[1]);
    for(let i=levels.length-2;i>=0;i--){const l=levels[i],r=mgResources[i];run('prolong',r,cells(l.dims));run('black',r,cells(l.dims));run('red',r,cells(l.dims));}
   };
   vcycle();run('residualDot',cgResources,[plan.groups]);run('reduceResidual',cgResources,[1]);run('updateDirection',cgResources,[plan.groups]);
   for(let i=0;i<iterations;i++){
    run('directionDot',cgResources,[plan.groups]);run('reduceDirection',cgResources,[1]);run('updateSolution',cgResources,[plan.groups]);
    if(i+1<iterations){vcycle();run('residualDot',cgResources,[plan.groups]);run('reduceResidual',cgResources,[1]);run('updateDirection',cgResources,[plan.groups]);}
   }
   run('residualDot',cgResources,[plan.groups]);run('reduceResidual',cgResources,[1]);
   run('exportPressure',bridgeResources,cells(dims));pass.end();encodeCount++;
   return {identity:AMGPCG_IDENTITY,algorithm:'amgpcg',iterations,iterationUnit:'CG iteration with one multigrid V-cycle',grid:[...dims],levels:levels.map(l=>[...l.dims]),residentBytes:plan.residentBytes,cellVisits:4*plan.count+levels.slice(0,-1).reduce((n,l)=>n+l.count,0)+iterations*(4*levels.slice(0,-1).reduce((n,l)=>n+l.count,0)+10*levels.at(-1).count+4*plan.count)+(cgValues[8]?plan.count:0),dispatchCount:3+(levels.length-1)+(cgValues[8]?2:0)+iterations*(6*(levels.length-1)+7)+2,coarseSymmetricSweeps:10,warmStart,pureNeumann:cgValues[8]===1,encodeCount,implementation:'separate-stages-untrimmed',workgroupStorageBytes:12288};
  },
  destroy(){owned.forEach(b=>b.destroy());groups.clear();}
 };
}
