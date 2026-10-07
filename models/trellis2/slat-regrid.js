// Source generate.py::_requantize_coords at TRELLIS2MLX34a7a570.
// For the decoder's power-of-two resolution, centered binary64 scaling is
// exactly rational below u32 overflow. Integer ties-even preserves that law
// without an F32 approximation or downloading coordinates. Atomic presence
// and the existing hierarchical scan preserve np.unique's lexical row order.
import {WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
import {createSLatDecoderKernelOps,decoderDispatch} from './slat-decoder-ops.js';
export const SLAT_REGRID_SOURCE=Object.freeze({repo:'lyonsno/trellis2mlx',
  commit:'34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6',file:'generate.py',function:'_requantize_coords'});
export function buildSLatRegridPlan({tokenRows,sourceResolution,meshResolution=1024}={}){
  for(const [name,value] of Object.entries({tokenRows,sourceResolution,meshResolution}))
    if(!Number.isSafeInteger(value)||value<1)throw RangeError('positive '+name+' required');
  if(!Number.isInteger(Math.log2(sourceResolution)))throw RangeError('source-F64-equivalent regrid requires the decoder power-of-two resolution');
  const resolution=Math.floor(meshResolution/16),candidateRows=resolution**3,flagGroups=Math.ceil(candidateRows/8),
    maxNumerator=(2*sourceResolution-1)*(resolution-1);
  if(resolution<1||!Number.isSafeInteger(candidateRows*12)||candidateRows*12>0xffffffff||
    2*sourceResolution>0xffffffff||maxNumerator>0xffffffff||tokenRows*12>0xffffffff)
    throw RangeError('complete regrid exceeds exact integer addressing capacity');
  return Object.freeze({tokenRows,sourceResolution,meshResolution,resolution,candidateRows,flagGroups,
    inputShape:Object.freeze([tokenRows,3]),rounding:'source-F64-equivalent-ties-even',
    coordinateOrder:'z-y-x-lexicographic',source:SLAT_REGRID_SOURCE});
}
const entry=`@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let i=gid.x+gid.y*grid.x*256u;`;
export function slatRegridShaders(p){
  const r=p.resolution;
  return {
    clear:`@group(0) @binding(0) var<storage,read_write> flags:array<atomic<u32>>;
${entry}if(i<${p.flagGroups*8}u){atomicStore(&flags[i],0u);}}`,
    mark:`@group(0) @binding(0) var<storage,read> coordinates:array<i32>;
@group(0) @binding(1) var<storage,read_write> flags:array<atomic<u32>>;
fn source_round(v:i32)->u32{
 if(v<0){return 0u;}if(v>=${p.sourceResolution}){return ${r-1}u;}
 let n=(u32(v)*2u+1u)*${r-1}u;let q=n/${2*p.sourceResolution}u;let rem=n%${2*p.sourceResolution}u;
 let up=rem>${p.sourceResolution}u||(rem==${p.sourceResolution}u&&(q&1u)!=0u);
 return min(q+select(0u,1u,up),${r-1}u);
}
${entry}if(i>=${p.tokenRows}u){return;}
 let z=source_round(coordinates[i*3u]);let y=source_round(coordinates[i*3u+1u]);let x=source_round(coordinates[i*3u+2u]);
 // F32 1.0 bits let the production positive-membership scan read this buffer.
 atomicStore(&flags[(z*${r}u+y)*${r}u+x],0x3f800000u);}`,
    compact:`@group(0) @binding(0) var<storage,read> flags:array<f32>;
@group(0) @binding(1) var<storage,read> prefix:array<u32>;
@group(0) @binding(2) var<storage,read_write> coordinates:array<i32>;
${entry}if(i>=${p.candidateRows}u||!(flags[i]>0.0)){return;}
 let row=i/8u;var earlier=0u;for(var j=row*8u;j<i;j++){if(flags[j]>0.0){earlier++;}}
 let dest=prefix[row]+earlier;
 coordinates[dest*3u]=i32(i/${r*r}u);coordinates[dest*3u+1u]=i32((i/${r}u)%${r}u);coordinates[dest*3u+2u]=i32(i%${r}u);}`
  };
}
export function createTrellisSLatRegridAdapter({route,tokenRows,sourceResolution,meshResolution=1024,coordinateTensor}={}){
  const plan=buildSLatRegridPlan({tokenRows,sourceResolution,meshResolution}),runtime=route?.runtime;
  if(!coordinateTensor?.buffer||coordinateTensor.dtype!=='i32'||!(coordinateTensor.usage&U.storage)||
    coordinateTensor.byteLength!==tokenRows*12||JSON.stringify(coordinateTensor.shape)!==JSON.stringify(plan.inputShape))
    throw TypeError('complete resident Int32 decoded coordinates required');
  if(tokenRows*12>(runtime?.device?.limits?.maxStorageBufferBindingSize??134217728))
    throw RangeError('complete coordinate input exceeds effective binding capacity');
  const ops=createSLatDecoderKernelOps(runtime),limit=runtime.device?.limits?.maxComputeWorkgroupsPerDimension??65535;
  let disposed=false,running=false,state='new',output;
  const outputs={};Object.defineProperty(outputs,'coordinates',{enumerable:true,get:()=>output?.coordinates});
  const dispatch=async(stage,code,args,groups,invocation,readBindings)=>{
    const kernel=runtime.defineComputeKernel({name:'trellis.'+stage,code,bindings:args.map((resource,i)=>
      ({name:'b'+i,resource,access:i<readBindings?'read-only-storage':'storage'}))});
    await runtime.runKernel(kernel,{stage,dispatch:decoderDispatch(groups,limit),schedulerInvocation:invocation,yieldAfter:true});
  };
  try{
    const flags=ops.allocate('regrid-presence',[plan.flagGroups,8]),code=slatRegridShaders(plan);
    return Object.freeze({plan,runtime,routeId:route.routeId,inputs:Object.freeze({coordinates:coordinateTensor}),outputs:Object.freeze(outputs),
      async run(invocation){
        if(disposed)throw Error('SLat regrid disposed');if(running)throw Error('SLat regrid in use');
        if(state!=='new')throw Error(state==='failed'?'failed SLat regrid is poisoned':'single SLat regrid already completed');
        running=true;state='running';
        try{
          await dispatch('slat-regrid-clear',code.clear,[flags],Math.ceil(plan.flagGroups*8/256),invocation,0);
          await dispatch('slat-regrid-mark',code.mark,[coordinateTensor,flags],Math.ceil(tokenRows/256),invocation,1);
          const {count,prefix}=await ops.subdivision(flags,invocation);
          if(count>plan.candidateRows)throw Error('regrid count exceeds unique support capacity');
          const coordinates=ops.allocate('regridded-coordinates',[count,3],'i32');
          await dispatch('slat-regrid-compact',code.compact,[flags,prefix,coordinates],Math.ceil(plan.candidateRows/256),invocation,2);
          await ops.settle();ops.release(flags);ops.release(prefix);
          output=Object.freeze({coordinates,resolution:plan.resolution,metadataReadbackBytes:ops.metadataReadbackBytes,
            coordinateBytesToCPUDuringServing:0,coordinateOrder:plan.coordinateOrder,rounding:plan.rounding});
          state='completed';return output;
        }catch(error){state='failed';output=undefined;throw error;}finally{running=false;}
      },dispose(){if(running)throw Error('SLat regrid in use');if(disposed)return;disposed=true;ops.dispose();}
    });
  }catch(error){ops.dispose();throw error;}
}
