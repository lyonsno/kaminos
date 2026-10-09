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
import {createTrellisDinoV3ConditioningAdapter} from './dinov3-serving.js';
import {generationRoles} from './generation-inputs.js';

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

// The live consumer of DINO's exact output. Only normalized image pixels and
// checkpoint weights enter from CPU; no learned context crosses an artifact.
export function createTrellisImageGenerationAdapter({route,pixelValues,prefixWeights,loadLayerWeights,
  dinoIdentity=null,models,loadModels,modelInputs,loadModel,meshResolution=1024,pipelineType='1024_cascade',seed=42,initialNoise={},onPhase,onNoiseInput}={}){
  if(onNoiseInput!==undefined&&typeof onNoiseInput!=='function')throw TypeError('noise input observer must be a function');
  const staged=loadModel!==undefined||modelInputs!==undefined;
  if(staged){
    if(typeof loadModel!=='function'||!modelInputs||models!==undefined||loadModels!==undefined)
      throw TypeError('one complete staged checkpoint input source required');
  }else{
    if(models!==undefined&&loadModels!==undefined)throw TypeError('one checkpoint input source required');
    if(models===undefined&&typeof loadModels!=='function')throw TypeError('complete generation checkpoint inputs or loader required');
  }
  let state='new',phase='new',result,disposed=false,generation;
  const enter=async e=>{phase=e.phase;await onPhase?.({...e,routeId:route.routeId});},
    producer=createTrellisDinoV3ConditioningAdapter({route,pixelValues,prefixWeights,loadLayerWeights,
      modelIdentity:dinoIdentity,onPhase:enter});
  return Object.freeze({runtime:route.runtime,routeId:route.routeId,
    get state(){return state;},get phase(){return phase;},get outputs(){return result;},
    get conditioning(){return producer.outputs?.conditioning;},
    get noiseInputs(){return generation?.noiseInputs??Object.freeze({});},
    async run(invocation){
      if(disposed)throw Error('image generation adapter disposed');if(state!=='new')throw Error('image generation adapter is '+state);
      state='running';
      try{
        const dino=await producer.run(invocation);
        if(loadModels)await enter({phase:'generation-checkpoint-input-loading'});
        const checkpointModels=staged?modelInputs:models??await loadModels();
        generation=createTrellisGenerationFromConditioningAdapter({route,conditioningTensor:dino.conditioning,
          models:checkpointModels,...(staged?{loadModel}:{}),meshResolution,pipelineType,seed,initialNoise,onPhase:enter,onNoiseInput});
        const fields=await generation.run(invocation);
        result=Object.freeze({...fields,conditioning:dino.conditioning,dino});state='completed';phase='completed';return result;
      }catch(error){state='failed';result=undefined;throw error;}
    },
    dispose(){if(state==='running')throw Error('image generation adapter in use');if(disposed)return;disposed=true;
      generation?.dispose();producer.dispose();}
  });
}

export function createTrellisGenerationFromConditioningAdapter({route,conditioningTensor,models,loadModel,
  meshResolution=1024,pipelineType='1024_cascade',seed=42,initialNoise={},onPhase,onNoiseInput}={}){
  const runtime=route?.runtime,roles=generationRoles({pipelineType}),cascade=pipelineType==='1024_cascade';
  // Canonical source resolution is enforced by the input-package boundary;
  // this generic composition also supports smaller operation fixtures.
  if(!runtime?.runKernel||!conditioningTensor?.buffer)throw TypeError('registered runtime and resident image conditioning required');
  const staged=loadModel!==undefined;
  if(staged&&typeof loadModel!=='function')throw TypeError('per-role checkpoint loader required');
  for(const role of roles)if(staged?!models?.[role]?.config:!models?.[role]?.weights)throw TypeError('actual model weight role required: '+role);
  if(cascade&&((!staged&&models.lowResolutionShape.weights===models.highResolutionShape.weights) ||
    (staged&&models.lowResolutionShape.identity?.sha256&&
      models.lowResolutionShape.identity.sha256===models.highResolutionShape.identity?.sha256)))
    throw TypeError('source cascade requires the separate high-resolution model, not low-resolution weight reuse');
  if(onPhase!==undefined&&typeof onPhase!=='function')throw TypeError('phase observer must be a function');
  if(onNoiseInput!==undefined&&typeof onNoiseInput!=='function')throw TypeError('noise input observer must be a function');
  const gaussian=browserNoise(seed),owned=new Set(),noiseInputs={},phases=[];
  let state='new',phase='new',result,disposed=false;
  const own=a=>{owned.add(a);return a;},retire=async(...adapters)=>{
    await runtime.device?.queue?.onSubmittedWorkDone?.();
    for(const a of adapters){a.dispose();owned.delete(a);}
  },noise=async(stage,shape)=>{
    const count=shape.reduce((a,b)=>a*b,1),values=initialNoise[stage]??gaussian(count);
    if(!(values instanceof Float32Array)||values.length!==count||!values.every(Number.isFinite))
      throw TypeError('complete finite initial noise required for '+stage+' '+shape);
    noiseInputs[stage]=Object.freeze({shape:Object.freeze([...shape]),values,
      source:initialNoise[stage]===undefined?'browser-u32-counter-mix/Box-Muller/F32':'explicit-caller-F32-input',seed});
    // The observer can preserve exact CPU-authored input before a native
    // process fails; it does not supply or replace learned output.
    await onNoiseInput?.({stage,...noiseInputs[stage]});
    return values;
  };
  const enter=async name=>{phase=name;phases.push({phase:name});await onPhase?.({phase:name,routeId:route.routeId});};
  // Checkpoint arrays are scoped to construction/upload, not the entire
  // generation promise. Returned adapters own GPU parameters, not a cache
  // of all seven CPU checkpoints.
  const consume=async(role,name,factory)=>{
    if(staged){phase='generation-checkpoint-input-loading';
      await onPhase?.({phase,modelRole:role,routeId:route.routeId});}
    const checkpoint=staged?await loadModel(role):models[role];
    if(!checkpoint?.weights||checkpoint.role!==undefined&&checkpoint.role!==role)
      throw TypeError('actual checkpoint weights for model role required: '+role);
    await enter(name);
    return factory({...models[role],weights:checkpoint.weights,phases:checkpoint.phases,siluTable:checkpoint.siluTable});
  };
  const shapeFlow=(role,coordinates,concatTensor)=>consume(role,
    role==='lowResolutionShape'?'low-resolution-shape-sampling':role==='highResolutionShape'?'high-resolution-shape-sampling':'shape-conditioned-texture-sampling',
    model=>own(createTrellisSLatFlowAdapter({route,
      config:{...model.config,tokenRows:coordinates.shape[0],mode:role==='textureFlow'?'texture':'shape'},
      weights:model.weights,conditioningTensor,coordinateTensor:coordinates,...(concatTensor?{concatTensor}:{})})));
  const sampleShape=async(role,flow,stage,invocation)=>{
    const sampler=own(createTrellisSLatSamplerAdapter({route,flow,config:{...models[role].config,
      tokenRows:flow.plan.tokenRows,mode:flow.plan.mode},conditioningTensor}));
    await sampler.run({sample:await noise(stage,flow.plan.inputShape)},invocation);return{sampler,sample:sampler.outputs.sample};
  };
  return Object.freeze({runtime,routeId:route.routeId,inputs:Object.freeze({conditioning:conditioningTensor}),
    get state(){return state;},get phase(){return phase;},get noiseInputs(){return Object.freeze({...noiseInputs});},
    get outputs(){return result;},
    async run(invocation){
      if(disposed)throw Error('generation adapter disposed');
      if(state!=='new')throw Error(state==='running'?'generation adapter in use':'generation adapter is '+state);
      state='running';
      try{
        const sparse=await consume('sparseFlow','sparse-structure-sampling',model=>own(createTrellisSparseFlowAdapter({route,config:model.config,
          weights:model.weights,phases:model.phases,conditioningTensor}))),
          sparseSampler=own(createTrellisSparseSamplerAdapter({route,flow:sparse,config:models.sparseFlow.config,conditioningTensor}));
        await sparseSampler.run({sample:await noise('sparse',sparse.plan.prefix.inputShape)},invocation);
        const occupancy=await consume('occupancyDecoder','occupancy-decoding',model=>own(createTrellisSparseDecoderAdapter({route,config:model.config,
          weights:model.weights,sampleTensor:sparseSampler.outputs.sample})));
        await occupancy.run({},invocation);
        const coordinates=own(createTrellisOccupancyCoordinatesAdapter({route,resolution:occupancy.plan.outputResolution,
          logitsTensor:occupancy.outputs.logits}));await coordinates.run(invocation);
        const lrCoordinates=await coordinates.coordinates(invocation),lrResolution=coordinates.plan.outputResolution;
        await retire(occupancy,sparseSampler,sparse);
        const lrFlow=await shapeFlow('lowResolutionShape',lrCoordinates),lr=await sampleShape('lowResolutionShape',lrFlow,'lowResolutionShape',invocation);
        // The decoder expands the latent coordinate grid, not the final mesh grid.
        let finalCoordinates=lrCoordinates,finalResolution=lrResolution,finalSample=lr.sample,sampledAdapters;
        if(cascade){
          const support=await consume('shapeDecoder','learned-cascade-support',model=>own(createTrellisSLatCascadeSupportAdapter({route,
            config:{...model.config,tokenRows:lrCoordinates.shape[0],resolution:lrResolution},
            weights:model.weights,siluTable:model.siluTable,sampleTensor:lr.sample,
            coordinateTensor:lrCoordinates,meshResolution}))),hr=await support.run(invocation);
          await retire(lr.sampler,lrFlow,coordinates);
          const hrFlow=await shapeFlow('highResolutionShape',hr.coordinates),hrSample=await sampleShape('highResolutionShape',hrFlow,'highResolutionShape',invocation);
          finalCoordinates=hr.coordinates;finalResolution=hr.resolution;finalSample=hrSample.sample;
          sampledAdapters=[hrSample.sampler,hrFlow];
        }else sampledAdapters=[lr.sampler,lrFlow];
        const rows=finalCoordinates.shape[0],shapeScale=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,sampleTensor:finalSample}));
        await shapeScale.run(invocation);
        await retire(...sampledAdapters);
        const geometryDecoder=await consume('shapeDecoder','learned-geometry-decoding',model=>own(createTrellisSLatDecoderAdapter({route,
          config:{...model.config,tokenRows:rows,resolution:finalResolution,mode:'shape',structureOnly:false},
          weights:model.weights,siluTable:model.siluTable,
          sampleTensor:shapeScale.outputs.sample,coordinateTensor:finalCoordinates}))),geometry=await geometryDecoder.run(invocation);
        const shapeNormalize=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,direction:'normalize',sampleTensor:shapeScale.outputs.sample}));
        const textureFlow=await shapeFlow('textureFlow',finalCoordinates,shapeNormalize.outputs.sample);
        await shapeNormalize.run(invocation);
        const textureSample=await sampleShape('textureFlow',textureFlow,'texture',invocation),
          textureScale=own(createTrellisSLatScaleAdapter({route,tokenRows:rows,mode:'texture',sampleTensor:textureSample.sample}));
        await textureScale.run(invocation);
        await retire(textureSample.sampler,textureFlow,shapeNormalize);
        const textureDecoder=await consume('textureDecoder','shape-guided-material-decoding',model=>own(createTrellisSLatDecoderAdapter({route,
          config:{...model.config,tokenRows:rows,resolution:finalResolution,mode:'texture'},
          weights:model.weights,siluTable:model.siluTable,
          sampleTensor:textureScale.outputs.sample,coordinateTensor:finalCoordinates,guideSubdivisions:geometry.subdivisions}))),
          material=await textureDecoder.run(invocation);
        await runtime.device?.queue?.onSubmittedWorkDone?.();
        result=Object.freeze({geometry,material,shapeCodes:shapeScale.outputs.sample,textureCodes:textureScale.outputs.sample,
          lowResolutionRows:lrCoordinates.shape[0],highResolutionRows:rows,meshResolution,pipelineType,
          modelIdentities:Object.freeze(Object.fromEntries(roles.map(role=>[role,models[role].identity??null]))),
          phases:Object.freeze(phases.map(Object.freeze)),initialNoise:Object.freeze({...noiseInputs}),
          featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,
          handoff:'resident learned geometry/material fields; post-model mesh/UV/PBR consumers outstanding',
          comparison:'browser generation; no assertion of matched MLX noise or model fidelity'});
        state='completed';phase='completed';return result;
      }catch(error){state='failed';result=undefined;throw error;}
    },
    dispose(){if(state==='running')throw Error('generation adapter in use');if(disposed)return;disposed=true;
      for(const a of [...owned].reverse())a.dispose();owned.clear();}
  });
}
