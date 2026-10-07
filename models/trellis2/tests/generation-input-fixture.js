import {generationInputShapes} from '../generation-inputs.js';
const cfg={channels:1536,heads:12,contextChannels:1024,contextRows:1029,hidden:8192,frequencyDim:256,numBlocks:30,
  steps:12,guidanceStrength:7.5,guidanceRescale:.5,guidanceInterval:[.6,1],rescaleT:3,sigmaMin:1e-5},
  dc={channels:[1024,512,256,128,64],numBlocks:[4,16,8,4,0],latentChannels:32},
  m={schema:'trellis2.generation-inputs.v0',status:'succeeded',modelCalls:0,meshResolution:1024,seed:42,
    image:{pixelTensor:'image.pixels'},dino:{identity:{files:{'model.safetensors':{sha256:'a'.repeat(64)}}},prefix:{},layers:Array.from({length:24},()=>({}))},
    models:{},tensors:{}};
for(const [role,config]of Object.entries({sparseFlow:{...cfg,guidanceRescale:.7,rescaleT:5},lowResolutionShape:cfg,
  highResolutionShape:cfg,textureFlow:{...cfg,guidanceStrength:1,guidanceRescale:0,guidanceInterval:[.6,.9]},
  shapeDecoder:dc,textureDecoder:{...dc,mode:'texture'},occupancyDecoder:{resolution:16,latentChannels:8,outChannels:1,channels:[512,128,32],numResBlocks:2,numResBlocksMiddle:2}}))
  m.models[role]={config,identity:{sha256:(role==='highResolutionShape'?'b':'a').repeat(64)},tensors:{}};
const shapes=generationInputShapes(m),tensor=(key,shape)=>{
  m.tensors[key]={file:key+'.f32',dtype:'float32',shape,byteLength:shape.reduce((n,x)=>n*x,4),sha256:'c'.repeat(64)};return key;};
tensor('image.pixels',shapes.image);
for(const [key,shape]of Object.entries(shapes.dinoPrefix))m.dino.prefix[key]=tensor('dino.'+key,shape);
for(const [i,layer]of m.dino.layers.entries())for(const [key,shape]of Object.entries(shapes.dinoLayer))layer[key]=tensor('dino.layer'+i+'.'+key,shape);
for(const [role,weightShapes]of Object.entries(shapes.models))for(const [key,shape]of Object.entries(weightShapes))m.models[role].tensors[key]=tensor(role+'.'+key,shape);
m.models.sparseFlow.phases=tensor('sparse.phases',shapes.phases);
for(const role of ['shapeDecoder','textureDecoder'])m.models[role].siluTable=tensor('shared.silu',shapes.silu);
export {m};
