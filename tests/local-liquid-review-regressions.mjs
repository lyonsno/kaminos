import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const THREE=await import(pathToFileURL(path.join(root,'lib/three.webgpu.js')));
const {defaultLocalLiquidSetup}=await import(pathToFileURL(path.join(root,'local-liquid-setup.mjs')));
const hostSource=await fs.readFile(path.join(root,'local-liquid-host.mjs'),'utf8');
const coreSource=await fs.readFile(path.join(root,'finger-fluid-webgpu-core.js'),'utf8');
const witnessSource=await fs.readFile(path.join(root,'local-liquid-witness.mjs'),'utf8');
let environmentUv;
const calls=[],gpuTextures=new Map();
let solverDebugState={effectiveRendererMode:'screen_space_refraction',opticalDebugMode:'shaded'};
const device={lost:new Promise(()=>{}),addEventListener(){},removeEventListener(){},
  createCommandEncoder(){return {finish(){return {};}};},queue:{submit(){calls.push({op:'submit'});}}};
let currentTarget=null,override=null,clearColor=new THREE.Color(),clearAlpha=1,atSolver=null;
let pixelReadback=[2.5,1.25,.75,2];
const nativeTexture=texture=>{
  if(!gpuTextures.has(texture))gpuTextures.set(texture,{name:texture.name, writes:[],createView(){return {texture:this};}});
  return gpuTextures.get(texture);
};
const renderer={
  backend:{device,get(texture){return {texture:nativeTexture(texture)};}},xr:{enabled:false},
  toneMapping:THREE.ACESFilmicToneMapping,outputColorSpace:THREE.SRGBColorSpace,
  getRenderTarget:()=>currentTarget,setRenderTarget(value){currentTarget=value;},
  getRenderObjectFunction:()=>override,setRenderObjectFunction(value){override=value;},
  getClearColor(target){return target.copy(clearColor);},getClearAlpha:()=>clearAlpha,
  setClearColor(value,alpha){clearColor.copy(value);clearAlpha=alpha;},
  getDrawingBufferSize(target){return target.set(640,480);},
  async readRenderTargetPixelsAsync(target,x,y,width,height){
    calls.push({op:'read-pixel',target:target.texture.name,x,y,width,height});
    return new Uint16Array(pixelReadback.map(THREE.DataUtils.toHalfFloat));
  },
  initRenderTarget(target){nativeTexture(target.texture);calls.push({op:'allocate',target:target.texture.name});},
  copyTextureToTexture(source,target){nativeTexture(target).writes=[...nativeTexture(source).writes];},
  render(object){
    const op=object.isScene?'scene-depth':object.name==='Render Pipeline'?'present':'environment';
    if(currentTarget)nativeTexture(currentTarget.texture).writes.push(op);
    calls.push({op,target:currentTarget ? (currentTarget.texture.name || 'unnamed-environment-target') : 'canvas'});
  },
};
const pipeline={outputColorTransform:true,needsUpdate:false,render(){
  nativeTexture(currentTarget.texture).writes.push('host-scene-color');
  calls.push({op:'host-scene-color',target:currentTarget.texture.name});
}};
globalThis.__bathtubReviewSolver=async()=>({available:true,step(){},setLiveInletPacket(){},destroy(){},getDebugState(){return solverDebugState;},
  render({hostFrame,opticalDebugMode='shaded',rendererMode='screen_space_refraction'}){
    solverDebugState={effectiveRendererMode:rendererMode,opticalDebugMode,
      opticalQueryEvidence:{effectiveRoute:'kaminos/finger-fluid/hybrid-optical-query-v0',fallbackReason:null}};
    atSolver={sceneColorWrites:[...hostFrame.sceneColor.view.texture.writes],targetWrites:[...hostFrame.target.view.texture.writes]};
    calls.push({op:'solver',...atSolver});
  }});
globalThis.__bathtubTestTsl={...THREE.TSL,uv:()=>({x:.5,y:0,flipY(){return {...this,y:1-this.y};}}),equirectDirection(p){environmentUv=p;return THREE.TSL.vec3(0,Math.sin((p.y-.5)*Math.PI),0);}};
const instrumented=hostSource.replace('createWebGPUFingerFluidSolver,','')
  .replace(/import \{ ([^\n]+) \} from '\.\/lib\/three\.tsl\.js';/, 'const { $1 } = globalThis.__bathtubTestTsl;')
  .replace(/from '(\.\/[^']+)'/g,(_match,rel)=>`from '${new URL(rel,pathToFileURL(path.join(root,'local-liquid-host.mjs'))).href}'`)
  +'\nconst createWebGPUFingerFluidSolver=globalThis.__bathtubReviewSolver;\n';
const {createLocalLiquidHost}=await import('data:text/javascript;base64,'+Buffer.from(instrumented).toString('base64'));
const scene=new THREE.Scene();scene.environment=new THREE.Texture({width:1024,height:512});
const camera=new THREE.PerspectiveCamera(40,4/3,.01,100);camera.position.set(4.8,4.8,6.5);camera.lookAt(0,-.5,0);
const host=await createLocalLiquidHost({renderer,scene,camera,pipeline,device,setup:defaultLocalLiquidSetup()});
host.render();
assert.deepEqual(atSolver.sceneColorWrites,['host-scene-color']);
assert.deepEqual(atSolver.targetWrites,['host-scene-color']);
assert.equal(typeof host.readOpticalAnchors,'function','local host exposes exact optical anchor readback');
const queryMetadataBranch=coreSource.match(/if \(opticalDebugMode == 38\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.ok(queryMetadataBranch.includes('refractionQuery.confidence,\n      1.0,'),
  'query metadata keeps a write alpha of one so source-over blending cannot corrupt the sampled fields');
const transmissionValidityLine=coreSource.match(/let transmissionQueryValidity[^\n]*/)?.[0] || '';
assert.equal(transmissionValidityLine,'',
  'environment query radiance remains eligible until a ray-validity predicate distinguishes valid environment exits');
const diagnosticOutputHelper=coreSource.match(/fn refractionDiagnosticOutput\([\s\S]*?\n\}/)?.[0] || '';
assert.ok(diagnosticOutputHelper.includes('output.depth = 0.0;'),
  'diagnostic sentinel pixels bypass camera-far-dependent projected ordering depth');
assert.ok(coreSource.includes('return refractionDiagnosticOutput(vec4<f32>(-1.0, 0.0, 0.0, 1.0), supportOrderingDepth);')
  && coreSource.includes('return refractionDiagnosticOutput(vec4<f32>(-2.0, 0.0, 0.0, 1.0), supportOrderingDepth);'),
  'unsupported and host-occluded sentinels use the diagnostic-only depth override');
await assert.rejects(host.readOpticalAnchors([{id:'pool',x:8,y:7}]),/paused/, 'anchor readback requires frozen water');
host.setPaused(true);
host.setOpticalOptions({opticalDebugMode:'refraction_query_metadata'});
host.render({advance:false});
const opticalAnchors=await host.readOpticalAnchors([{id:'pool-center',x:8,y:7}]);
assert.equal(opticalAnchors.schema,'kaminos.local-liquid-optical-anchor-readback.v0');
assert.equal(opticalAnchors.coordinateSpace,'host_output_target_texels_top_left_v0');
assert.equal(opticalAnchors.frameId,'local-liquid-2');
assert.equal(opticalAnchors.cameraIdentity,camera.uuid);
assert.equal(opticalAnchors.opticalDebugMode,'refraction_query_metadata');
assert.deepEqual(opticalAnchors.fields,['hitKindCode','distanceMeters','confidence','writeAlpha']);
assert.equal(opticalAnchors.opticalQueryRoute,'kaminos/finger-fluid/hybrid-optical-query-v0');
assert.deepEqual(opticalAnchors.pixels,[{id:'pool-center',x:8,y:7,hasLiquidSupport:true,
  sampleStatus:'visible_liquid_sample',isVisibleLiquidSample:true,rgba:[2.5,1.25,.75,2]}]);
pixelReadback=[-1,0,0,1];
const unsupportedAnchor=await host.readOpticalAnchors([{id:'outside-support',x:8,y:7}]);
assert.equal(unsupportedAnchor.pixels[0].sampleStatus,'no_liquid_support');
assert.equal(unsupportedAnchor.pixels[0].hasLiquidSupport,false);
assert.equal(unsupportedAnchor.pixels[0].isVisibleLiquidSample,false);
pixelReadback=[-2,0,0,1];
const occludedAnchor=await host.readOpticalAnchors([{id:'host-occluded',x:8,y:7}]);
assert.equal(occludedAnchor.pixels[0].sampleStatus,'host_occluded');
assert.equal(occludedAnchor.pixels[0].hasLiquidSupport,true);
assert.equal(occludedAnchor.pixels[0].isVisibleLiquidSample,false);
assert.ok(calls.some(call=>call.op==='read-pixel'&&call.target==='Local liquid composed color'&&call.x===8&&call.y===7),
  'readback samples the requested host output texel');
await assert.rejects(host.readOpticalAnchors([{id:'outside',x:640,y:7}]),/outside host output texels/);
host.dispose();
delete globalThis.__bathtubReviewSolver;

test('top of the world-radiance texture addresses the northern hemisphere',()=>assert.equal(Math.sin((environmentUv.y-.5)*Math.PI),1));

const finallyStart=witnessSource.lastIndexOf('} finally {')+'} finally {'.length;
const cleanupBody=witnessSource.slice(finallyStart,witnessSource.lastIndexOf('}'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runCleanup=new AsyncFunction('context','browser','report','save','path','args','page','fs','assert','process',cleanupBody);
let contextCloseCalls=0,saved=null;
const report={status:'passed',phase:'complete'};
await runCleanup({tracing:{async stop(){throw Error('injected trace archive write failure');}},async close(){contextCloseCalls++;}},
  {async close(){throw Error('injected browser close failure');}},report,async()=>{saved=structuredClone(report);},path,{out:'/unwritten/review-mock'},null,fs,assert,{});
test('failed artifact finalization cannot preserve a successful witness',()=>{assert.equal(saved.status,'failed');assert.equal(saved.failurePhase,'artifact-finalization');});
test('explicit recording context is closed to flush video',()=>assert.equal(contextCloseCalls,1));
