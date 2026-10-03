import {buildSparseBlockPlan,sparseBlockWeightShapes} from './sparse-block.js';
import {buildSparseDecoderPlan,sparseDecoderWeightShapes} from './sparse-decoder.js';
import {buildSLatDecoderPlan,slatDecoderWeightShapes} from './slat-decoder.js';

export const GENERATION_ROLES=Object.freeze(['sparseFlow','occupancyDecoder','lowResolutionShape','highResolutionShape','shapeDecoder','textureFlow','textureDecoder']);
export function generationInputShapes(m){
  const c=1024,h=4096,models={};
  for(const role of GENERATION_ROLES){
    const config=m.models?.[role]?.config;if(!config)throw TypeError('complete model config required '+role);
    if(['sparseFlow','lowResolutionShape','highResolutionShape','textureFlow'].includes(role)){
      const p=buildSparseBlockPlan({...config,...(role==='sparseFlow'?{}:{tokenRows:1})}),channels=p.channels,
        ci=role==='sparseFlow'?8:role==='textureFlow'?64:32,co=role==='sparseFlow'?8:32;
      const shapes={'prefix.input.weight':[channels,ci],'prefix.input.bias':[channels],
        'prefix.time0.weight':[channels,config.frequencyDim],'prefix.time0.bias':[channels],
        'prefix.time2.weight':[channels,channels],'prefix.time2.bias':[channels],
        'prefix.mod.weight':[6*channels,channels],'prefix.mod.bias':[6*channels],
        'terminal.weight':[co,channels],'terminal.bias':[co],gelu:[65536]};
      for(let i=0;i<config.numBlocks;i++)for(const [key,shape]of Object.entries(sparseBlockWeightShapes(p)))shapes['block'+i+'.'+key]=shape;
      models[role]=shapes;
    }else if(role==='occupancyDecoder')models[role]=sparseDecoderWeightShapes(buildSparseDecoderPlan(config));
    else models[role]=slatDecoderWeightShapes(buildSLatDecoderPlan({...config,tokenRows:1,mode:role==='textureDecoder'?'texture':'shape'}));
  }
  return{image:[1,512,512,3],models,phases:[4096,64,2],silu:[65536],
    dinoPrefix:{patchProjection:[1024,16,16,3],patchBias:[1024],classToken:[1,1,1024],registerTokens:[1,4,1024],ropeCos:[1024,64],ropeSin:[1024,64]},
    dinoLayer:{norm1Weight:[c],norm1Bias:[c],qWeight:[c,c],qBias:[c],kWeight:[c,c],vWeight:[c,c],vBias:[c],oWeight:[c,c],oBias:[c],
      layerScale1:[c],norm2Weight:[c],norm2Bias:[c],mlpUpWeight:[h,c],mlpUpBias:[h],mlpDownWeight:[c,h],mlpDownBias:[c],layerScale2:[c]}};
}
export function validateGenerationInputs(m){
  if(m?.schema!=='trellis2.generation-inputs.v0'||m.status!=='succeeded'||m.modelCalls!==0)throw TypeError('successful model-free checkpoint package required');
  if(m.meshResolution!==1024||!Number.isInteger(m.seed)||m.seed<0||m.seed>0xffffffff)throw TypeError('explicit source1024cascade configuration and unsigned32 seed required');
  // Pin the source architecture before deriving coverage from caller-controlled configs.
  for(const role of ['shapeDecoder','textureDecoder','occupancyDecoder']){
    const expected=role==='occupancyDecoder'?{resolution:16,latentChannels:8,outChannels:1,channels:[512,128,32],numResBlocks:2,numResBlocksMiddle:2}:
      {latentChannels:32,channels:[1024,512,256,128,64],numBlocks:[4,16,8,4,0]};
    for(const [key,value]of Object.entries(expected))if(JSON.stringify(m.models?.[role]?.config?.[key])!==JSON.stringify(value))
      throw TypeError('canonical decoder architecture required '+role+'.'+key);
  }
  const shapes=generationInputShapes(m),admitted=new Set();
  const tensor=(key,shape)=>{
    const row=m.tensors?.[key];if(!row||row.dtype!=='float32'||JSON.stringify(row.shape)!==JSON.stringify(shape)||
      row.byteLength!==shape.reduce((n,x)=>n*x,4)||!/^[a-f0-9]{64}$/.test(row.sha256??''))throw TypeError('complete identified tensor required '+key);
    if(!/^[\w.-]+$/.test(row.file??''))throw TypeError('safe tensor file required '+key);admitted.add(key);
  };
  tensor(m.image?.pixelTensor,shapes.image);
  if(!/^[a-f0-9]{64}$/.test(m.dino?.identity?.files?.['model.safetensors']?.sha256??'')||m.dino?.layers?.length!==24)
    throw TypeError('identified complete24layer DINO checkpoint required');
  for(const [key,shape]of Object.entries(shapes.dinoPrefix))tensor(m.dino.prefix?.[key],shape);
  for(const layer of m.dino.layers)for(const [key,shape]of Object.entries(shapes.dinoLayer))tensor(layer?.[key],shape);
  const identity=m.models.highResolutionShape.identity?.sha256;
  if(!identity||identity===m.models.lowResolutionShape.identity?.sha256)throw TypeError('separate high-resolution checkpoint required');
  for(const [role,weightShapes]of Object.entries(shapes.models)){
    const model=m.models[role],c=model.config;
    if(!/^[a-f0-9]{64}$/.test(model.identity?.sha256??''))throw TypeError('identified checkpoint required '+role);
    if(JSON.stringify(Object.keys(model.tensors??{}).sort())!==JSON.stringify(Object.keys(weightShapes).sort()))throw TypeError('complete parameter coverage required '+role);
    if('gelu' in weightShapes){
      for(const [key,value]of Object.entries({channels:1536,heads:12,contextChannels:1024,contextRows:1029,hidden:8192,frequencyDim:256,numBlocks:30}))
        if(c[key]!==value)throw TypeError('explicit full model config required '+role+'.'+key);
      const tex=role==='textureFlow',sparse=role==='sparseFlow';
      for(const [key,value]of Object.entries({steps:12,guidanceStrength:tex?1:7.5,guidanceRescale:tex?0:sparse?.7:.5,
        guidanceInterval:tex?[.6,.9]:[.6,1],rescaleT:sparse?5:3,sigmaMin:1e-5}))
        if(JSON.stringify(c[key])!==JSON.stringify(value))throw TypeError('explicit source sampler config required '+role+'.'+key);
    }
    for(const [key,shape]of Object.entries(weightShapes))tensor(model.tensors[key],shape);
    if(role==='sparseFlow')tensor(model.phases,shapes.phases);
    if(role==='shapeDecoder'||role==='textureDecoder')tensor(model.siluTable,shapes.silu);
  }
  const geluHash=m.tensors[m.models.sparseFlow.tensors.gelu].sha256,siluHash=m.tensors[m.models.shapeDecoder.siluTable].sha256;
  for(const role of ['lowResolutionShape','highResolutionShape','textureFlow'])
    if(m.tensors[m.models[role].tensors.gelu].sha256!==geluHash)throw TypeError('shared GELU activation table content identity required '+role);
  if(m.tensors[m.models.textureDecoder.siluTable].sha256!==siluHash)throw TypeError('shared SiLU activation table content identity required textureDecoder');
  return Object.freeze({tensorCount:admitted.size,tensorKeys:Object.freeze([...admitted]),shapes});
}

export async function loadGenerationInputs(m,fetchTensor){
  const plan=validateGenerationInputs(m);
  const loadModels=async()=>{const table=await fetchTensor(m.models.sparseFlow.tensors.gelu),
    silu=await fetchTensor(m.models.shapeDecoder.siluTable),models={};
  for(const role of GENERATION_ROLES){
    const model=m.models[role],flat={};
    for(const [key,name]of Object.entries(model.tensors))flat[key]=key==='gelu'?table:await fetchTensor(name);
    let weights=flat;
    if('gelu' in plan.shapes.models[role])weights={
      prefix:Object.fromEntries(Object.entries(flat).filter(([k])=>k.startsWith('prefix.')).map(([k,v])=>[k.slice(7),v])),
      blocks:Array.from({length:model.config.numBlocks},(_,i)=>({...Object.fromEntries(Object.entries(flat).filter(([k])=>k.startsWith('block'+i+'.'))
        .map(([k,v])=>[k.slice(('block'+i+'.').length),v])),gelu:table})),terminal:{weight:flat['terminal.weight'],bias:flat['terminal.bias']}};
    models[role]={config:model.config,identity:model.identity,weights,
      ...(model.phases?{phases:await fetchTensor(model.phases)}:{}),...(model.siluTable?{siluTable:silu}:{})};
  }
  return models;};
  const prefixWeights={};for(const [key,name]of Object.entries(m.dino.prefix))prefixWeights[key]=await fetchTensor(name);
  return{loadModels,prefixWeights,pixelValues:await fetchTensor(m.image.pixelTensor),dinoIdentity:m.dino.identity,
    meshResolution:m.meshResolution,seed:m.seed,
    async loadLayerWeights(i){if(!Number.isInteger(i)||i<0||i>23)throw RangeError('actual DINO layer index required');
      const weights={};for(const [key,name]of Object.entries(m.dino.layers[i]))weights[key]=await fetchTensor(name);return weights;}};
}
