// Seeded OU streams use the same global xorshift draw order as the offline
// StochasticSignalSet. Input changes initialize stream starting points; each
// simulation step evolves them independently on GPU with a shared jump matrix.
const pipelines=new WeakMap();
const next=x=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
function apply(matrix,value){let out=0;for(let i=0;i<32;i++)if((value>>>i)&1)out^=matrix[i];return out>>>0;}
function jumpMatrix(draws){
 let power=Uint32Array.from({length:32},(_,i)=>next(2**i)),result=Uint32Array.from({length:32},(_,i)=>2**i);
 for(let n=draws;n>0;n=Math.floor(n/2)){if(n%2)result=Uint32Array.from(result,x=>apply(power,x));power=Uint32Array.from(power,x=>apply(power,x));}
 return result;
}
const CODE=/* wgsl */`
struct InletNode {value:f32,rng:u32,step:u32,initial:u32}
struct InletTime {step:u32,count:u32,decay:f32,kick:f32}
@group(0) @binding(0) var<uniform> time:InletTime;
@group(0) @binding(1) var<storage,read_write> nodes:array<InletNode>;
@group(0) @binding(2) var<storage,read> jump:array<u32>;
fn nextRandom(value:u32)->u32{var x=value;x^=x<<13u;x^=x>>17u;x^=x<<5u;return x;}
fn nextStep(value:u32)->u32{var result=0u;for(var i=0u;i<32u;i++){if(((value>>i)&1u)!=0u){result^=jump[i];}}return result;}
@compute @workgroup_size(64) fn evolveInlet(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let index=gid.x+gid.y*groups.x*64u;if(index>=time.count){return;}var n=nodes[index];if(time.step<n.step){n.value=0;n.rng=n.initial;n.step=0u;}
 loop{if(n.step>=time.step){break;}var rng=n.rng;var gaussian=0.0;for(var j=0u;j<12u;j++){rng=nextRandom(rng);gaussian+=f32(rng)*(1.0/4294967296.0);}gaussian-=6.0;
  n.value=n.value*time.decay+time.kick*gaussian;n.rng=nextStep(n.rng);n.step++;}
 nodes[index]=n;
}
`;
export function createGPUStochasticSignalSet(device,{seed=1,count=1,label='GPU inlet streams'}={}){
 if(!Number.isSafeInteger(count)||count<1)throw Error('GPU inlet stream count must be a positive integer');
 const bytes=count*16;if(!Number.isSafeInteger(bytes)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('GPU inlet streams exceed device storage limits');
 const U=GPUBufferUsage,buffer=device.createBuffer({label,size:bytes,usage:U.STORAGE|U.COPY_DST|U.COPY_SRC}),time=device.createBuffer({label:label+' time',size:16,usage:U.UNIFORM|U.COPY_DST}),jump=device.createBuffer({label:label+' RNG stride',size:128,usage:U.STORAGE|U.COPY_DST});
 const states=new Uint32Array(count*4);let rng=((Math.max(1,Math.floor(Number(seed)||1))>>>0)*2654435761+1013904223)>>>0;
 for(let j=0;j<count;j++){states[j*4+1]=rng;states[j*4+3]=rng;for(let k=0;k<12;k++)rng=next(rng);}
 device.queue.writeBuffer(buffer,0,states);device.queue.writeBuffer(jump,0,jumpMatrix(12*count));
 if(!pipelines.has(device)){const module=device.createShaderModule({label:'GPU seeded inlet dynamics',code:CODE});pipelines.set(device,device.createComputePipeline({label:'GPU seeded inlet dynamics',layout:'auto',compute:{module,entryPoint:'evolveInlet'}}));}
 const pipeline=pipelines.get(device),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:time}},{binding:1,resource:{buffer}},{binding:2,resource:{buffer:jump}}]});let destroyed=false;
 return{buffer,count,
  encode(encoder,step,tauSteps){
   if(destroyed)throw Error('GPU inlet streams disposed');const target=Math.max(0,Math.floor(Number(step)||0));if(target>0xffffffff)throw Error('GPU inlet step exceeds u32 clock capacity');
   const tau=Math.max(1,Number(tauSteps)||1),decay=Math.exp(-1/tau),kick=.45*Math.sqrt(1-decay*decay),data=new ArrayBuffer(16);new Uint32Array(data).set([target,count]);new Float32Array(data).set([decay,kick],2);device.queue.writeBuffer(time,0,data);
   const pass=encoder.beginComputePass({label:'GPU seeded inlet evolution'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);const work=Math.ceil(count/64),x=Math.min(work,device.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(work/x));pass.end();
  },
  destroy(){destroyed=true;buffer.destroy();time.destroy();jump.destroy();},
 };
}
