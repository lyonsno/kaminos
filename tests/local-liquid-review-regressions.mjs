import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const THREE=await import(pathToFileURL(path.join(root,'lib/three.webgpu.js')));
const {defaultLocalLiquidSetup}=await import(pathToFileURL(path.join(root,'local-liquid-setup.mjs')));
const hostSource=await fs.readFile(path.join(root,'local-liquid-host.mjs'),'utf8');
const witnessSource=await fs.readFile(path.join(root,'local-liquid-witness.mjs'),'utf8');
let environmentUv;
const calls=[],gpuTextures=new Map();
const device={lost:new Promise(()=>{}),addEventListener(){},removeEventListener(){},
  createCommandEncoder(){return {finish(){return {};}};},queue:{submit(){calls.push({op:'submit'});}}};
let currentTarget=null,override=null,clearColor=new THREE.Color(),clearAlpha=1,atSolver=null;
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
globalThis.__bathtubReviewSolver=async()=>({available:true,step(){},setLiveInletPacket(){},destroy(){},getDebugState(){return {};},
  render(options){
    const {hostFrame}=options;
    atSolver={sceneColorWrites:[...hostFrame.sceneColor.view.texture.writes],targetWrites:[...hostFrame.target.view.texture.writes]};
    atSolver.opticalOptions=Object.fromEntries(Object.entries(options).filter(([key])=>key!=='hostFrame'&&key!=='externalCamera'));
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
test('current host color initializes the liquid destination before overlay',()=>assert.deepEqual(atSolver.targetWrites,['host-scene-color']));
test('host forwards one validated optical diagnostic override without changing the saved setup',()=>{
  host.setPaused(true);
  const setupBefore=host.state().setup;
  assert.deepEqual(host.setOpticalOptions({opticalDebugMode:'transmitted_transport'}),
    {opticalDebugMode:'transmitted_transport'});
  host.render({advance:false});
  assert.deepEqual(atSolver.opticalOptions,{opticalDebugMode:'transmitted_transport'});
  assert.deepEqual(host.state().setup,setupBefore);
  assert.throws(()=>host.setOpticalOptions({rendererMode:'screen_space_surface'}),
    /Local liquid host requires screen_space_refraction/);
  assert.deepEqual(host.opticalOptions,{opticalDebugMode:'transmitted_transport'});
  host.render({advance:false});
  assert.equal(host.state().failure,null);
  assert.throws(()=>host.setOpticalOptions({particleCount:1}),/Unsupported local liquid optical option/);
  assert.throws(()=>host.setOpticalOptions({opticalDebugMode:'made_up'}),/Unsupported finger fluid optical debug mode/);
});
after(()=>host.dispose());
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
