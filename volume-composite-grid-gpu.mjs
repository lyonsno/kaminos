import {compositeDivergence,COMPOSITE_GRID_ID} from './volume-composite-grid.mjs';

// Reference GPU projection, dormant until a consumer explicitly constructs it.
// Weighted Jacobi is deliberately a correctness baseline, not the selected
// interactive solver. Caller supplies its work budget; readback reports whether
// actual projected flux meets the requested divergence tolerance.
export function createCompositePressureGPU(device,grid){
  const n=grid.cells.length,m=grid.faces.length;
  if(!n||!m)throw new Error('GPU composite projection requires nonempty cells and faces');
  const rows=Array.from({length:n},()=>[]);
  grid.faces.forEach((f,i)=>{const k=f.area/f.distance;rows[f.a].push([f.b,k,i,1]);if(f.b>=0)rows[f.b].push([f.a,k,i,-1]);});
  const nodes=new Float32Array(n*4),links=[];
  grid.cells.forEach((c,i)=>{nodes.set([links.length/4,rows[i].length,c.volume,grid.diagonal[i]],i*4);for(const link of rows[i])links.push(...link);});
  if(Math.max(n,m,links.length/4)>=2**24)throw new Error('topology indices exceed exact float32 integer representation');
  const faceData=Float32Array.from(grid.faces.flatMap(f=>[f.a,f.b,f.area/f.distance,0]));
  const owned=[];
  const alloc=(label,size,data)=>{
    if(size>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw new Error(`${label} exceeds device buffer capacity`);
    const b=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;
  };
  let nodeBuffer,linkBuffer,faceBuffer,fluxBuffer,pressure,state;
  try{
    nodeBuffer=alloc('composite cell topology',nodes.byteLength,nodes);
    const packed=new Float32Array(links);linkBuffer=alloc('composite adjacency',packed.byteLength,packed);
    faceBuffer=alloc('composite faces',faceData.byteLength,faceData);
    fluxBuffer=alloc('composite shared flux',m*4);pressure=[alloc('composite pressure A',n*4),alloc('composite pressure B',n*4)];
    state=alloc('composite target and rhs',n*8);
  }catch(e){for(const b of owned)b.destroy();throw e;}
  const code=/* wgsl */`
const N:u32=${n}u;const M:u32=${m}u;
@group(0) @binding(0) var<storage,read> nodes:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> links:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> faces:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> flux:array<f32>;
@group(0) @binding(4) var<storage,read> pin:array<f32>;
@group(0) @binding(5) var<storage,read_write> pout:array<f32>;
@group(0) @binding(6) var<storage,read_write> state:array<vec2<f32>>;
@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=N){return;}let row=nodes[i];var div=0.0;
  for(var j=0u;j<u32(row.y);j++){let link=links[u32(row.x)+j];div+=flux[u32(link.z)]*link.w;}
  state[i].y=state[i].x*row.z-div;pout[i]=0.0;
}
@compute @workgroup_size(64)
fn iterate(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=N){return;}let row=nodes[i];var sum=state[i].y;
  for(var j=0u;j<u32(row.y);j++){let link=links[u32(row.x)+j];if(link.x>=0.0){sum+=link.y*pin[u32(link.x)];}}
  if(row.w>0.0){pout[i]=pin[i]+(sum/row.w-pin[i])*(2.0/3.0);}else{pout[i]=0.0;}
}
@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=M){return;}let f=faces[i];var pb=0.0;if(f.y>=0.0){pb=pin[u32(f.y)];}
  flux[i]+=f.z*(pin[u32(f.x)]-pb);
}`;
  const shader=device.createShaderModule({label:'stationary composite pressure',code});
  const layout=device.createBindGroupLayout({entries:Array.from({length:7},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,
    buffer:{type:[0,1,2,4].includes(binding)?'read-only-storage':'storage'}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['initialize','iterate','project'].map(entryPoint=>[entryPoint,device.createComputePipeline({layout:pipelineLayout,compute:{module:shader,entryPoint}})]));
  const groups=[0,1].map(p=>device.createBindGroup({layout,entries:[nodeBuffer,linkBuffer,faceBuffer,fluxBuffer,pressure[p],pressure[1-p],state].map((b,binding)=>({binding,resource:{buffer:b}}))}));
  let current=0,iterations=0,hasInput=false,generation=0,encodedGeneration=-1;
  let targets=new Float32Array(n);
  return {
    shader,fluxBuffer,
    setInput(flux,target=new Float32Array(n)){
      if(flux.length!==m||target.length!==n||!flux.every(Number.isFinite)||!target.every(Number.isFinite))throw new Error('finite complete flux/target arrays required');
      const nextTargets=Float32Array.from(target),q=Float32Array.from(flux);
      if(!q.every(Number.isFinite)||!nextTargets.every(Number.isFinite))throw new Error('input exceeds float32 range');
      const divergence=compositeDivergence(grid,q);
      for(const c of grid.components)if(!c.grounded){const sum=c.ids.reduce((s,i)=>s+(nextTargets[i]-divergence[i])*grid.cells[i].volume,0);
        if(Math.abs(sum)>1e-7*c.ids.reduce((s,i)=>s+grid.cells[i].volume,0))throw new Error('sealed component has incompatible net source/flux');}
      const values=new Float32Array(n*2);nextTargets.forEach((v,i)=>values[i*2]=v);
      device.queue.writeBuffer(fluxBuffer,0,q);device.queue.writeBuffer(state,0,values);targets=nextTargets;hasInput=true;generation++;
    },
    encode(encoder,{iterations:budget}){
      if(!hasInput)throw new Error('setInput required before projection');
      if(!Number.isInteger(budget)||budget<0)throw new Error('explicit nonnegative iteration budget required');
      if(Math.ceil(Math.max(n,m)/64)>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('composite dispatch exceeds device capacity');
      const dispatch=(name,p,count)=>{const pass=encoder.beginComputePass({label:`composite ${name}`});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,groups[p]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();};
      dispatch('initialize',1,n);current=0;
      for(let i=0;i<budget;i++){dispatch('iterate',current,n);current=1-current;}
      dispatch('project',current,m);iterations=budget;hasInput=false;encodedGeneration=generation;
    },
    async readback({tolerance=1e-5}={}){
      if(encodedGeneration<0||encodedGeneration!==generation)throw new Error('current input has not been encoded');
      if(!Number.isFinite(tolerance)||tolerance<=0)throw new Error('positive finite tolerance required');
      const captured=generation,b=device.createBuffer({size:(n+m)*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const e=device.createCommandEncoder();e.copyBufferToBuffer(fluxBuffer,0,b,0,m*4);e.copyBufferToBuffer(pressure[current],0,b,m*4,n*4);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
        if(captured!==generation)throw new Error('projection changed during readback');
        const raw=b.getMappedRange(),flux=new Float32Array(raw.slice(0,m*4)),p=new Float32Array(raw.slice(m*4));
        if(!p.every(Number.isFinite))throw new Error('nonfinite GPU pressure');
        const div=compositeDivergence(grid,flux),maxDivergenceError=div.reduce((s,v,i)=>Math.max(s,Math.abs(v-targets[i])),0);
        const converged=maxDivergenceError<=tolerance;
        return {flux,pressure:p,converged,receipt:{identity:COMPOSITE_GRID_ID,route:'gpu-composite-reference',generation:captured,iterations,tolerance,maxDivergenceError,converged,cells:n,faces:m,innerFeedback:true,liveFlame:false}};
      }finally{b.destroy();}
    },
    destroy(){for(const b of owned)b.destroy();},
  };
}
