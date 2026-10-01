// Resident model-specific Euler/CFG sampler; offline observers own reference data.
import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';

export const SPARSE_SAMPLER_ROUTE='trellis2.sparse-sampler.webgpu.v0';
export const SPARSE_SAMPLER_STAGES=Object.freeze(['sampler-positive-snapshot','sampler-guidance',
  'sampler-xstart','sampler-guidance-std','sampler-guidance-rescale','sampler-final-snapshot',
  'sampler-euler-delta','sampler-euler-update']);

export function buildSparseSamplerPlan(config={}){
  const {steps=12,guidanceStrength=7.5,guidanceRescale=0.7,guidanceInterval=[0.6,1],rescaleT=5,sigmaMin=1e-5}=config;
  if(!Number.isSafeInteger(steps)||steps<1)throw new RangeError('steps must be a positive integer');
  for(const [name,value] of Object.entries({guidanceStrength,guidanceRescale,rescaleT,sigmaMin})){
    if(!Number.isFinite(value))throw new TypeError(`finite ${name} required`);
  }
  if(rescaleT<=0)throw new RangeError('positive rescaleT required');
  if(sigmaMin<0||sigmaMin>=1)throw new RangeError('sigmaMin must be in [0,1)');
  if(!Array.isArray(guidanceInterval)||guidanceInterval.length!==2||!guidanceInterval.every(Number.isFinite)||
      guidanceInterval[0]>guidanceInterval[1])throw new TypeError('finite ordered guidance interval required');
  // np.linspace uses start + i*step (not subtraction of saved F32 clocks).
  const times=Array.from({length:steps+1},(_,i)=>{
    const time=i===steps?0:1+i*(-1/steps);return rescaleT*time/(1+(rescaleT-1)*time);
  });
  const schedule=Array.from({length:steps},(_,i)=>{
    const time=times[i],coefficient=sigmaMin+(1-sigmaMin)*time;
    return Object.freeze({index:i,time,previousTime:times[i+1],modelTime:Math.fround(1000*time),
      dt:Math.fround(time-times[i+1]),coefficient:Math.fround(coefficient),inverseCoefficient:Math.fround(1/coefficient),
      guided:guidanceStrength!==1&&time>=guidanceInterval[0]&&time<=guidanceInterval[1]});
  });
  const {tokenRows}=config;
  if(tokenRows!==undefined&&(!Number.isSafeInteger(tokenRows)||tokenRows<1))throw new RangeError('tokenRows must be a positive integer');
  const elements=tokenRows===undefined?32768:tokenRows*32;
  if(!Number.isSafeInteger(elements*4)||elements*4>=2**32)throw new RangeError('sampler exceeds WebGPU u32 byte addressing');
  return Object.freeze({steps:Object.freeze(schedule),guidanceStrength,guidanceRescale,
    guidanceInterval:Object.freeze([...guidanceInterval]),rescaleT,sigmaMin,elements,shape:tokenRows===undefined?[1,8,16,16,16]:[tokenRows,32],
    stages:SPARSE_SAMPLER_STAGES,stdLogicalThreads:512,stdHardwareThreads:256,
    stdAlgorithm:tokenRows===undefined?'pytorch-2.10-cuda-welford-vt2-block512/emulated512-logical-lanes/source-MLX-reference':
      'source-sparse-token-population-moment-row-tree-segment',
    arithmetic:'f32-cfg-rescale-and-euler/source-double-schedule-f32-controls'});
}

const copyShader=`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){output[i]=input[i];}}`;
const guidanceShader=`
@group(0) @binding(0) var<storage,read> positive:array<f32>;
@group(0) @binding(1) var<storage,read> negative:array<f32>;
@group(0) @binding(2) var<storage,read> controls:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){output[i]=controls[0]*positive[i]+controls[1]*negative[i];}}`;
const xstartShader=`
@group(0) @binding(0) var<storage,read> sample:array<f32>;
@group(0) @binding(1) var<storage,read> positive:array<f32>;
@group(0) @binding(2) var<storage,read> guided:array<f32>;
@group(0) @binding(3) var<storage,read> controls:array<f32>;
@group(0) @binding(4) var<storage,read_write> x0_positive:array<f32>;
@group(0) @binding(5) var<storage,read_write> x0_guided:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){
  let scaled=controls[4]*sample[i];x0_positive[i]=scaled-controls[5]*positive[i];x0_guided[i]=scaled-controls[5]*guided[i];}}`;

// The source reduction has512 logical lanes with independent even/odd online
// states. A256-hardware-lane workgroup computes two logical lanes apiece, then
// reproduces the complete512→32→1 combination tree. No input subset or new cap.
const stdShader=`
@group(0) @binding(0) var<storage,read> positive:array<f32>;
@group(0) @binding(1) var<storage,read> guided:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
struct Welford {mean:f32,m2:f32,count:f32}
fn online(value:f32,current:Welford)->Welford{
  let new_count=current.count+1.0;let delta=value-current.mean;let new_mean=current.mean+delta/new_count;
  let new_delta=value-new_mean;return Welford(new_mean,fma(delta,new_delta,current.m2),new_count);
}
fn combine(first:Welford,second:Welford)->Welford{
  if(first.count==0.0){return second;}if(second.count==0.0){return first;}
  let delta=second.mean-first.mean;let count=first.count+second.count;let fraction=second.count/count;
  return Welford(first.mean+delta*fraction,first.m2+second.m2+delta*delta*first.count*fraction,count);
}
var<workgroup> means:array<f32,512>;
var<workgroup> m2s:array<f32,512>;
var<workgroup> counts:array<f32,512>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>){
  for(var logical=lane;logical<512u;logical+=256u){
    var even=Welford(0.0,0.0,0.0);var odd=Welford(0.0,0.0,0.0);
    for(var vector_index=logical;vector_index<16384u;vector_index+=512u){
      let offset=2u*vector_index;
      even=online(select(positive[offset],guided[offset],wid.x==1u),even);
      odd=online(select(positive[offset+1u],guided[offset+1u],wid.x==1u),odd);
    }
    let value=combine(even,odd);means[logical]=value.mean;m2s[logical]=value.m2;counts[logical]=value.count;
  }
  workgroupBarrier();
  for(var offset=256u;offset>0u;offset/=2u){
    if(lane<offset){
      let value=combine(Welford(means[lane],m2s[lane],counts[lane]),
        Welford(means[lane+offset],m2s[lane+offset],counts[lane+offset]));
      means[lane]=value.mean;m2s[lane]=value.m2;counts[lane]=value.count;
    }
    workgroupBarrier();
  }
  if(lane==0u){output[wid.x]=sqrt(m2s[0]/(counts[0]-1.0));}
}`;
const rescaleShader=`
@group(0) @binding(0) var<storage,read> sample:array<f32>;
@group(0) @binding(1) var<storage,read> x0_guided:array<f32>;
@group(0) @binding(2) var<storage,read> stds:array<f32>;
@group(0) @binding(3) var<storage,read> controls:array<f32>;
@group(0) @binding(4) var<storage,read_write> rescaled:array<f32>;
@group(0) @binding(5) var<storage,read_write> mixed:array<f32>;
@group(0) @binding(6) var<storage,read_write> prediction:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){
  let denominator=select(1.0,stds[1],stds[1]>0.0);let ratio=select(1.0,stds[0]/denominator,stds[1]>0.0);
  let scaled=x0_guided[i]*ratio;let x0=controls[2]*scaled+controls[3]*x0_guided[i];
  rescaled[i]=scaled;mixed[i]=x0;prediction[i]=(controls[4]*sample[i]-x0)*controls[6];}}`;
const deltaShader=`
@group(0) @binding(0) var<storage,read> prediction:array<f32>;
@group(0) @binding(1) var<storage,read> controls:array<f32>;
@group(0) @binding(2) var<storage,read_write> delta:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){delta[i]=controls[7]*prediction[i];}}`;
const updateShader=`
@group(0) @binding(0) var<storage,read> delta:array<f32>;
@group(0) @binding(1) var<storage,read_write> sample:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i<32768u){sample[i]=sample[i]-delta[i];}}`;

// SparseTensor.std uses a 32-channel row tree, then serial row means and
// second moments. It is population variance, unlike dense torch.std's Bessel
// correction. Preserve this explicit source schedule without token caps.
const sparseTokenStdShader=rows=>`
@group(0) @binding(0) var<storage,read> positive:array<f32>;
@group(0) @binding(1) var<storage,read> guided:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(1)
fn main(@builtin(workgroup_id) wid:vec3<u32>){
  var mean_sum=0.0;var mean2_sum=0.0;
  for(var row=0u;row < ${rows}u;row++){
    var values:array<f32,32>;var squares:array<f32,32>;
    for(var channel=0u;channel<32u;channel++){let i=row*32u+channel;
      let value=select(positive[i],guided[i],wid.x==1u);values[channel]=value;squares[channel]=value*value;}
    for(var offset=16u;offset>0u;offset/=2u){for(var channel=0u;channel<offset;channel++){
      values[channel]=values[channel]+values[channel+offset];squares[channel]=squares[channel]+squares[channel+offset];}}
    mean_sum=mean_sum+values[0]*0.03125;mean2_sum=mean2_sum+squares[0]*0.03125;
  }
  let mean=mean_sum/${rows}.0;let mean2=mean2_sum/${rows}.0;output[wid.x]=sqrt(mean2 - mean * mean);
}`;

export function createTrellisSparseSamplerAdapter({route,flow,config={},conditioning,negativeConditioning}){
  const runtime=route?.runtime,plan=buildSparseSamplerPlan(config);
  if(!runtime?.createTensor||!runtime?.runKernel||flow?.runtime!==runtime)throw new TypeError('model and sampler must use the same runtime');
  if(flow.routeId!==route.routeId)throw new TypeError('model and sampler must use the same registered route');
  const sample=flow.inputs?.sample,modelPrediction=flow.outputs?.prediction;
  for(const tensor of [sample,modelPrediction]){
    if(!tensor?.buffer||tensor.dtype!=='f32'||JSON.stringify(tensor.shape)!==JSON.stringify(plan.shape)||
        tensor.byteLength!==plan.elements*4||!(tensor.usage&U.storage))throw new TypeError('complete resident F32 sparse sample/prediction required');
  }
  const contextCount=flow.plan.block.contextRows*flow.plan.block.contextChannels;
  const validateContext=values=>values instanceof Float32Array&&values.length===contextCount&&values.every(Number.isFinite);
  if(!validateContext(conditioning))throw new TypeError('complete finite positive conditioning required');
  const negative=negativeConditioning??new Float32Array(contextCount);
  if(!validateContext(negative))throw new TypeError('complete finite negative conditioning required');
  const resources=[];let running=false,disposed=false,nextStep=null,poisoned=false;
  const tensor=(name,shape=plan.shape)=>{const t=runtime.createTensor({name:`trellis.sampler.${name}`,shape,dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});resources.push(t);return t;};
  const cleanup=()=>{for(const t of resources)t.buffer?.destroy?.();};
  try{
    const positive=tensor('positive'),guided=tensor('guided'),x0Positive=tensor('x0-positive'),x0Guided=tensor('x0-guided');
    const stds=tensor('stds',[2]),rescaled=tensor('x0-rescaled'),mixed=tensor('x0-mixed'),final=tensor('prediction-final');
    const delta=tensor('delta'),controls=tensor('controls',[8]);
    const R='read-only-storage',W='storage';
    const groups=Math.ceil(plan.elements/256),limit=runtime.device?.limits?.maxComputeWorkgroupsPerDimension??65535;
    const x=Math.min(groups,limit),y=Math.ceil(groups/x);if(y>limit)throw new RangeError('sampler exceeds device dispatch capacity');
    const elementCode=code=>config.tokenRows===undefined?code:code.replaceAll('32768u',`${plan.elements}u`)
      .replaceAll('gid:vec3<u32>)','gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>)')
      .replaceAll('let i=gid.x;','let i=gid.x+gid.y*grid.x*256u;');
    const define=(name,code,bindings,dispatch=[x,y,1])=>({name,dispatch,kernel:runtime.defineComputeKernel({name:`trellis.${name}`,code:elementCode(code),
      bindings:bindings.map(([resource,access],i)=>({name:`b${i}`,resource,access}))})});
    const operations={positive:define('sampler-positive-snapshot',copyShader,[[modelPrediction,R],[positive,W]]),
      guidance:define('sampler-guidance',guidanceShader,[[positive,R],[modelPrediction,R],[controls,R],[guided,W]]),
      xstart:define('sampler-xstart',xstartShader,[[sample,R],[positive,R],[guided,R],[controls,R],[x0Positive,W],[x0Guided,W]]),
      std:define('sampler-guidance-std',config.tokenRows===undefined?stdShader:sparseTokenStdShader(config.tokenRows),[[x0Positive,R],[x0Guided,R],[stds,W]],[2,1,1]),
      rescale:define('sampler-guidance-rescale',rescaleShader,[[sample,R],[x0Guided,R],[stds,R],[controls,R],[rescaled,W],[mixed,W],[final,W]]),
      positiveFinal:define('sampler-final-snapshot',copyShader,[[positive,R],[final,W]]),
      guidedFinal:define('sampler-final-snapshot',copyShader,[[guided,R],[final,W]]),
      delta:define('sampler-euler-delta',deltaShader,[[final,R],[controls,R],[delta,W]]),
      update:define('sampler-euler-update',updateShader,[[delta,R],[sample,W]])};
    const dispatch=({name,kernel,dispatch},invocation)=>runtime.runKernel(kernel,{stage:name,dispatch,schedulerInvocation:invocation,yieldAfter:true});
    const validateStep=({sample:initial,stepIndex})=>{
      if(!Number.isSafeInteger(stepIndex)||!plan.steps[stepIndex])throw new RangeError('step index outside complete source schedule');
      if(initial!==undefined){if(!(initial instanceof Float32Array)||initial.length!==plan.elements||!initial.every(Number.isFinite))throw new TypeError('complete finite initial sample required');}
      else if(poisoned)throw new Error('failed dispatch requires a fresh sample; resident state is unverified');
      else if(nextStep===null||stepIndex!==nextStep)throw new Error(`next step must be ${nextStep??'initialized with a sample'}`);
    };
    const stepCore=async({sample:initial,stepIndex},invocation)=>{
      validateStep({sample:initial,stepIndex});const step=plan.steps[stepIndex];
      const values=new Float32Array([plan.guidanceStrength,1-plan.guidanceStrength,plan.guidanceRescale,1-plan.guidanceRescale,
        1-plan.sigmaMin,step.coefficient,step.inverseCoefficient,step.dt]);
      runtime.uploadTensor(controls,values);
      try{
        await flow.run({...(initial===undefined?{}:{sample:initial}),timestep:step.modelTime,conditioning},invocation);
        await dispatch(operations.positive,invocation);
        if(step.guided){
          await flow.run({timestep:step.modelTime,conditioning:negative},invocation);
          await dispatch(operations.guidance,invocation);
          if(plan.guidanceRescale>0){
            await dispatch(operations.xstart,invocation);await dispatch(operations.std,invocation);await dispatch(operations.rescale,invocation);
          }else await dispatch(operations.guidedFinal,invocation);
        }else await dispatch(operations.positiveFinal,invocation);
        // Delta materialization reproduces the source mx.eval boundary before
        // the subtraction. Updated state is the following forward's input.
        await dispatch(operations.delta,invocation);await dispatch(operations.update,invocation);
        nextStep=stepIndex+1;poisoned=false;
        return {sample,stepIndex,clock:step,modelCalls:step.guided?2:1,
          guidanceRescaled:step.guided&&plan.guidanceRescale>0,arithmetic:plan.arithmetic};
      }catch(error){poisoned=true;throw error;}
    };
    const guarded=async(fn)=>{
      if(disposed)throw new Error('sparse sampler adapter disposed');if(running)throw new Error('sparse sampler adapter in use');
      running=true;try{return await fn();}finally{running=false;}
    };
    return Object.freeze({plan,runtime,routeId:route.routeId,outputs:Object.freeze({sample}),
      diagnostics:Object.freeze({positive,guided,x0Positive,x0Guided,stds,rescaled,mixed,final,delta,negative:modelPrediction}),
      step(input={},invocation){return guarded(()=>stepCore({stepIndex:0,...input},invocation));},
      run({sample:initial,startStepIndex=0}={},invocation){return guarded(async()=>{
        if(!Number.isSafeInteger(startStepIndex)||!plan.steps[startStepIndex])throw new RangeError('start step outside complete source schedule');
        let result,modelCalls=0;
        for(let i=startStepIndex;i<plan.steps.length;i++){
          result=await stepCore({sample:i===startStepIndex?initial:undefined,stepIndex:i},invocation);modelCalls+=result.modelCalls;
        }
        return{...result,stepsExecuted:plan.steps.length-startStepIndex,modelCalls};
      });},
      dispose(){if(running)throw new Error('sparse sampler adapter in use');if(disposed)return;disposed=true;cleanup();}
    });
  }catch(error){cleanup();throw error;}
}
