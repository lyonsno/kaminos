// kaminos-test: node
import assert from 'node:assert/strict';
import {resolveSceneGIControlState} from '../scene-gi-settings.mjs';
assert.equal(resolveSceneGIControlState().temporal,true,'Noah accepted temporal GI as the fresh-scene default');
assert.equal(resolveSceneGIControlState({temporal:false}).temporal,false,'an explicit saved temporal setting remains authoritative');
assert.equal(resolveSceneGIControlState({temporal:true,temporalWeight:.8}).temporalWeight,.8);
for(const value of [{temporal:1},{temporalWeight:1},{temporalWeight:-1},{temporalWeight:NaN}])assert.throws(()=>resolveSceneGIControlState(value));
const {default:History}=await import('../scene-gi-history.mjs');
const {PerspectiveCamera,Texture}=await import('../lib/three.webgpu.js');
const camera=new PerspectiveCamera();camera.updateMatrixWorld();
const sample={value:new Texture()};
const history=new History(sample,sample,sample,sample,camera);
assert.equal(history.valid.value,false);
assert.equal(history.frames,0);
history.requestFrames();assert.equal(history.pendingFrames,45);history.weight.value=0;history.requestFrames();assert.equal(history.pendingFrames,1);history.weight.value=.9;
const output=history.getGINode(),original=output.value;
const saved=output.sample();
const renderer={getRenderTarget:()=>null,setRenderTarget(){},getMRT:()=>null,setMRT(){},autoClear:true};
history.quad.render=()=>{};
history.renderFrame(renderer,16,8);
assert.equal(history.frames,1);assert.equal(history.valid.value,true);
assert.notEqual(output.value,original,'history must publish the newly written target');
assert.equal(saved.value,output.value,'cloned sampling nodes must follow the current target');
const previous=output.value;history.renderFrame(renderer,16,8);
assert.notEqual(output.value,previous);assert.equal(history.frames,2);
history.reset('lighting-change');assert.equal(history.valid.value,false);
history.renderFrame(renderer,8,4);assert.deepEqual(history.size,[8,4]);
history.dispose();
console.log('GI history settings, reset and alternating texture identity pass');

// Exercise the actual ordinary RAF predicate, independently of inspection draws.
const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('  function animate() {'),end=html.indexOf('\n  compositionHost =',begin);
for(const enabled of [true,false]) {
  let remaining=45,draws=0;
  const scope={outputCaptureExtent:null,recordingExtent:null,document:{getElementById:()=>({textContent:''})},requestAnimationFrame(){},controls:{update(){}},viewProjection:null,workbenchSceneFrames:{tick(){}},performance:{now:()=>0},
    fingerFluidPyroCompositionRequested:()=>false,isKaminosVolumeSmokeRoute:()=>false,
    isSceneItemVisible:()=>true,isAuthoredKilnCollisionRoute:()=>false,volumeBridge:null,fireLightFieldPass:null,localLiquidHost:null,
    foregroundServiceActive:false,sceneRenderedForVolume:false,needsRender:true,idleFrames:0,IDLE_THRESHOLD:3,
    syncAuthoredWaterFlameTransport(){},syncViewportQuality(){},syncViewportRendererSize(){},fireProxySync:null,
    sceneGI:{historyStatus:()=>null,needsHistoryFrame:()=>enabled&&remaining>0,requestHistoryFrames(){if(enabled)remaining=45;}},
    renderSceneFrame(){draws++;remaining--;},
  };
  for(const name of ['updateHybridSplatOverlayFrame','updateMotionAgencyFrame','updateMotionDecisionFrame','updateMotionPhraseControlFrame','updateMotionTrackFrame','updateGeneratedPoseOutputMapFrame','updateGeneratedPoseTemporalFrame','updateForgeHostStationFrame'])scope[name]=()=>false;
  runInNewContext(html.slice(begin,end)+';for(let tick=0;tick<90;tick++)animate();',scope);
  assert.equal(draws,enabled?45:4,'ordinary RAF must settle enabled history and preserve disabled idle behavior');
}

// Ordinary material MRTs also contain live history uniforms and textures.
// Exercise the observer shipped by the browser bundle without needing a GPU.
const bundle=readFileSync(new URL('../lib/three.webgpu.js',import.meta.url),'utf8');
const observerStart=bundle.indexOf('class NodeMaterialObserver {');
const observerEnd=bundle.indexOf('\n// Pre-compiled RegExp',observerStart);
const Observer=runInNewContext(bundle.slice(observerStart,observerEnd)+';NodeMaterialObserver',{
  refreshUniforms:[],_materialCache:new WeakMap(),_geometryCache:new WeakMap(),_lightsCache:new WeakMap(),
});
for(const hasMRT of [false,true]) {
  const observer=new Observer({material:{},object:{},context:{},renderer:{getMRT:()=>hasMRT?{has:()=>false}:null}});
  // Two previously initialized ordinary objects share this compiled program.
  observer.firstInitialization=()=>false;observer.equals=()=>true;observer.getLights=()=>[];
  const object={object:{},bundle:null,lightsNode:{}};
  const frame={renderId:1,renderer:{getMRT:()=>hasMRT?{has:()=>false}:null}};
  assert.equal(observer.needsRefresh(object,frame),true);
  assert.equal(observer.needsRefresh(object,frame),hasMRT,
    'each MRT receiver must refresh external uniforms even when its material is unchanged');
}
