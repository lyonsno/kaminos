// Serving composition from the live image encoder's resident conditioning.
// Model adapters below are the production kernels, not injectable model or
// reference callbacks. Initial noise is CPU-authored input; learned fields
// and coordinates stay resident. Mesh extraction/UV/PBR are later consumers.
import {createTrellisSparseFlowAdapter} from './sparse-flow.js';
import {createTrellisSparseSamplerAdapter} from './sparse-sampler.js';
import {createTrellisSparseDecoderAdapter} from './sparse-decoder.js';
import {createTrellisOccupancyCoordinatesAdapter} from './occupancy-coordinates.js';
import {createTrellisSLatFlowAdapter} from './slat-flow.js';
import {createTrellisSLatSamplerAdapter} from './slat-sampler.js';
import {createTrellisSLatCascadeSupportAdapter} from './slat-cascade.js';
import {createTrellisSLatScaleAdapter} from './slat-scale.js';
import {createTrellisSLatDecoderAdapter} from './slat-decoder.js';

// A replayable browser Gaussian stream, not an assertion of MLX RNG parity.
// The complete arrays are retained as open diagnostic input, including on
// failure. Counter high bits prevent a silently repeated 32-bit stream.
function browserNoise(seed){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw RangeError('unsigned32 browser noise seed required');
  let counter=0n;
  const uniform=()=>{
    const lo=Number(counter&0xffffffffn),hi=Number(counter>>32n);counter++;
    let value=(lo^Math.imul(hi,0x9e3779b9)^seed)>>>0;
    value=Math.imul(value^(value>>>16),0x21f0aaad)>>>0;
    value=Math.imul(value^(value>>>15),0x735a2d97)>>>0;value=(value^(value>>>15))>>>0;
    return (value+0.5)/4294967296;
  };
  return count=>{
    const values=new Float32Array(count);
    for(let i=0;i<count;i+=2){const radius=Math.sqrt(-2*Math.log(uniform())),angle=2*Math.PI*uniform();
      values[i]=radius*Math.cos(angle);if(i+1<count)values[i+1]=radius*Math.sin(angle);}
    return values;
  };
}

export function createTrellisGenerationFromConditioningAdapter({route,conditioningTensor,models,
  meshResolution=1024,seed=42,initialNoise={},onPhase}={}){
  const runtime=route?.runtime,roles=['sparseFlow','occupancyDecoder','lowResolutionShape','highResolutionShape','shapeDecoder','textureFlow','textureDecoder'];
  if(!runtime?.runKernel||!conditioningTensor?.buffer)throw TypeError('registered runtime and resident image conditioning required');
  for(const role of roles)if(!models?.[role]?.weights)throw TypeError('actual model weight role required: '+role);
  if(models.lowResolutionShape.weights===models.highResolutionShape.weights)
    throw TypeError('source cascade requires the separate high-resolution model, not low-resolution weight reuse');
  if(onPhase!==undefined&&typeof onPhase!=='function')throw TypeError('phase observer must be a function');
  const gaussian=browserNoise(seed),owned=[],noiseInputs={},phases=[];
  let state='new',phase='new',result,disposed=false;
  const own=a=>{owned.push(a);return a;},noise=(stage,shape)=>{
    const count=shape.reduce((a,b)=>a*b,1),values=initialNoise[stage]??gaussian(count);
    if(!(values instanceof Float32Array)||values.length!==count||!values.every(Number.isFinite))
      throw TypeError('complete finite initial noise required for '+stage+' '+shape);
    noiseInputs[stage]=Object.freeze({shape:Object.freeze([...shape]),values,
      source:initialNoise[stage]===undefined?'browser-u32-counter-mix/Box-Muller/F32':'explicit-caller-F32-input',seed});
    return values;
  };
  const enter=async name=>{phase=name;phases.push({phase:name});await onPhase?.({phase:name,routeId:route.routeId});};
  const shapeFlow=(role,coordinates,concatTensor)=>own(createTrellisSLatFlowAdapter({route,
    config:{...models[role].config,tokenRows:coordinates.shape[0],mode:role==='textureFlow'?'texture':'shape'},
    weights:models[role].weights,conditioningTensor,coordinateTensor:coordinates,...(concatTensor?{concatTensor}:{})}));
  const sampleShape=async(role,flow,stage,invocation)=>{
    const sampler=own(createTrellisSLatSamplerAdapter({route,flow,config:{...models[role].config,
      tokenRows:flow.plan.tokenRows,mode:flow.plan.mode},conditioningTensor}));
    await sampler.run({sample:noise(stage,flow.plan.inputShape)},invocation);return sampler.outputs.sample;
  };
  return Object.freeze({runtime,routeId:route.routeId,inputs:Object.freeze({conditioning:conditioningTensor}),
    get state(){return state;},get phase(){return phase;},get noiseInputs(){return Object.freeze({...noiseInputs});},
    get outputs(){return result;},
    async run(invocation){
      if(disposed)throw Error('generation adapter disposed');
      if(state!=='new')throw Error(state==='running'?'generation adapter in use':'generation adapter is '+state);
      state='running';
      try{
        await enter('sparse-structure-sampling');
        const sparse=own(createTrellisSparseFlowAdapter({route,config:models.sparseFlow.config,
          weights:models.sparseFlow.weights,phases:models.sparseFlow.phases,conditioningTensor})),
          sparseSampler=own(createTrellisSparseSamplerAdapter({route,flow:sparse,config:models.sparseFlow.config,conditioningTensor}));
        await sparseSampler.run({sample:noise('sparse',sparse.plan.prefix.inputShape)},invocation);
        await enter('occupancy-decoding');
        const occupancy=own(createTrellisSparseDecoderAdapter({route,config:models.occupancyDecoder.config,
          weights:models.occupancyDecoder.weights,sampleTensor:sparseSampler.outputs.sample}));
        await occupancy.run({},invocation);
        const coordinates=own(createTrellisOccupancyCoordinatesAdapter({route,resolution:occupancy.plan.outputResolution,
          logitsTensor:occupancy.outputs.logits}));await coordinates.run(invocation);
        const lrCoordinates=await coordinates.coordinates(),lrResolution=coordinates.plan.outputResolution;
        await enter('low-resolution-shape-sampling');
        const lrFlow=shapeFlow('lowResolutionShape',lrCoordinates),lrSample=await sampleShape('lowResolutionShape',lrFlow,'lowResolutionShape',invocation);
        await enter('learned-cascade-support');
        const support=own(createTrellisSLatCascadeSupportAdapter({route,
          config:{...models.shapeDecoder.config,tokenRows:lrCoordinates.shape[0],resolution:lrResolution},
          weights:models.shapeDecoder.weights,siluTable:models.shapeDecoder.siluTable,sampleTensor:lrSample,
          coordinateTensor:lrCoordinates,meshResolution})),hr=await support.run(invocation),rows=hr.coordinates.shape[0];
        await enter('high-resolution-shape-sampling');
        const hrFlow=shapeFlow('highResolutionShape',hr.coordinates),hrSample=await sampleShape('highResolutionShape',hrFlow,'highResolutionShape',invocation),
          shapeScale=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,sampleTensor:hrSample}));
        await shapeScale.run(invocation);
        await enter('learned-geometry-decoding');
        const geometryDecoder=own(createTrellisSLatDecoderAdapter({route,
          config:{...models.shapeDecoder.config,tokenRows:rows,resolution:hr.resolution,mode:'shape',structureOnly:false},
          weights:models.shapeDecoder.weights,siluTable:models.shapeDecoder.siluTable,
          sampleTensor:shapeScale.outputs.sample,coordinateTensor:hr.coordinates})),geometry=await geometryDecoder.run(invocation);
        await enter('shape-conditioned-texture-sampling');
        const shapeNormalize=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,direction:'normalize',sampleTensor:shapeScale.outputs.sample}));
        await shapeNormalize.run(invocation);
        const textureFlow=shapeFlow('textureFlow',hr.coordinates,shapeNormalize.outputs.sample),
          textureSample=await sampleShape('textureFlow',textureFlow,'texture',invocation),
          textureScale=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,mode:'texture',sampleTensor:textureSample}));
        await textureScale.run(invocation);
        await enter('shape-guided-material-decoding');
        const textureDecoder=own(createTrellisSLatDecoderAdapter({route,
          config:{...models.textureDecoder.config,tokenRows:rows,resolution:hr.resolution,mode:'texture'},
          weights:models.textureDecoder.weights,siluTable:models.textureDecoder.siluTable,
          sampleTensor:textureScale.outputs.sample,coordinateTensor:hr.coordinates,guideSubdivisions:geometry.subdivisions})),
          material=await textureDecoder.run(invocation);
        await runtime.device?.queue?.onSubmittedWorkDone?.();
        result=Object.freeze({geometry,material,shapeCodes:shapeScale.outputs.sample,textureCodes:textureScale.outputs.sample,
          lowResolutionRows:lrCoordinates.shape[0],highResolutionRows:rows,meshResolution,
          modelIdentities:Object.freeze(Object.fromEntries(roles.map(role=>[role,models[role].identity??null]))),
          phases:Object.freeze(phases.map(Object.freeze)),initialNoise:Object.freeze({...noiseInputs}),
          featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,
          handoff:'resident learned geometry/material fields; post-model mesh/UV/PBR consumers outstanding',
          comparison:'browser generation; no assertion of matched MLX noise or model fidelity'});
        state='completed';phase='completed';return result;
      }catch(error){state='failed';result=undefined;throw error;}
    },
    dispose(){if(state==='running')throw Error('generation adapter in use');if(disposed)return;disposed=true;
      for(const a of owned.reverse())a.dispose();}
  });
}
