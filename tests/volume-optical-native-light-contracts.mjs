import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const body=core.slice(core.indexOf('  function encodeDraw('),core.indexOf('  async function sampleOpticalTraceChunk('));
const ordinary={},readback={},pipelines=[],draws=[];
let lightingUpdates=0;
const context={sceneSourceFrameConsumer:null,sceneSourcePreparedEncoders:new Set(),ordinarySceneDepthFallback:{},
  ordinarySceneDepthTexture:null,ordinarySceneDepthBindGroup:{},ordinaryDepthPipelines:new Map(),
  ordinaryMultisampleShader:null,ordinaryMultisamplePipelineLayout:{},opticalTraceReadbackPipeline:null,
  pipeline:ordinary,readbackPipeline:readback,leanStockPipeline:{},leanStockReadbackPipeline:{},
  selectRaymarchPipeline:p=>p,scenePointBindGroup:null,distributedGroup:null,
  uniforms:Object.assign(new Float32Array(400),{368:2}),state:{physicalColor:{}},
  encodeSharedSceneSource:()=>{},emissiveLightField:{encode:()=>lightingUpdates++},currentFluid:0,
  sceneVolumeSourceRequested:false,sceneVolumeSource:null,transparentCanvas:true,
  gridSize:64,gridHeight:128,EMISSIVE_LIGHT_GRID:32,fluidBindGroup:()=>({}),shader:{},productRaymarchPipelineLayout:{},WGSL:'',format:'bgra8unorm',
  device:{createRenderPipeline:descriptor=>{pipelines.push(descriptor);return descriptor;},createShaderModule:()=>({})}};
vm.createContext(context);vm.runInContext(body,context);
const encoder={beginRenderPass:()=>({setPipeline:p=>draws.push(p),setBindGroup:()=>{},draw:()=>{},end:()=>{}})};
context.encodeDraw(encoder,{},'trace',readback,{opticalTrace:true});
assert.equal(draws.at(-1).fragment?.constants.OPTICAL_TRACE_CAPTURE,true,'native six-direction trace must select a trace-specialized pipeline');
assert.equal(draws.at(-1).fragment.constants.LEAN_STOCK_RAYMARCH,false);
assert.equal(lightingUpdates,1,'trace must evaluate the native incident-light field');
assert.equal(context.state.physicalColor.incidentLight.model,'six-direction-single-scattering-v1');
context.encodeDraw(encoder,{},'ordinary',readback);
assert.equal(draws.at(-1),readback,'ordinary rendering must retain its pipeline');
context.ordinarySceneDepthTexture={sampleCount:4};
context.encodeDraw(encoder,{},'trace-msaa',readback,{opticalTrace:true});
assert.equal(draws.at(-1).fragment.constants.OPTICAL_TRACE_CAPTURE,true,'MSAA depth must retain trace specialization');
context.encodeDraw(encoder,{},'ordinary-msaa',readback);
assert.equal(draws.at(-1).fragment.constants.OPTICAL_TRACE_CAPTURE,false,'MSAA trace and ordinary pipelines must not alias');
assert.equal(lightingUpdates,4);
console.log('native incident-light capture selects independent trace pipelines with unchanged ordinary rendering');
