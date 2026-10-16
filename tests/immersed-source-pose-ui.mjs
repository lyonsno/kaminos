// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
import{flamePoseToDomain,flamePoseInDomain,effectiveFlameDomainControls,defaultFlameEmitterPose}from'../scene-flame-emitter.mjs';
import{applyVolumeEmitterFamilyRuntime,resolveVolumeCoreEmitterSource}from'../volume-emitter-runtime.mjs';
const html=readFileSync(process.env.KAMINOS_POSE_UI_SOURCE || new URL('../index.html',import.meta.url),'utf8');
test('moving the immersed source refreshes only its centre/aim labels',()=>{
 const elements=new Map([['emitter-assay-family',{value:'ring'}]]);for(const suffix of ['centre-x','centre-y','centre-z','yaw','pitch']){elements.set('volume-immersed-'+suffix,{id:'volume-immersed-'+suffix,value:'0'});elements.set('volume-immersed-'+suffix+'-val',{textContent:'old'});}
 let broadRefreshes=0,applied;
 const ctx={sceneObjects:[],window:{},document:{getElementById:id=>elements.get(id)},routeExternalEmitters:null,volumeEmitterRuntimeFrame:0,flameEmitterPose:defaultFlameEmitterPose(),flameDomainTranslation:[0,0,0],flameDomainScale:1,flameEmitterInjectionSuspended:false,authoredFlamePresent:true,performance,structuredClone,flamePoseToDomain,flamePoseInDomain,effectiveFlameDomainControls,applyVolumeEmitterFamilyRuntime,emitterCompilerControls:c=>c,
 volumePrototype:{debugState:()=>({frameCount:1}),setControls:c=>applied=c,setAnalyticEmitterDescriptor:()=>({mode:'off',count:0}),setCoreEmitterSourceMode:mode=>resolveVolumeCoreEmitterSource({mode,controlFlowRate:applied.flowRate})},setVolumeControlValue:(id,v)=>elements.get(id).value=String(v),updateVolumeControlLabels:()=>broadRefreshes++,renderVolumeEmitterReceipt(){},ensureAuthoredFlameEmitter(){}};
 vm.createContext(ctx);const from=html.indexOf('  function applyVolumeEmitterFamilyRuntimeToCockpit(');vm.runInContext(html.slice(from,html.indexOf('  applyFlameEmitterPose =',from)),ctx);
 ctx.c={emitterSourceLaw:'immersed-source',immersedRadius:.2,flowRate:1,immersedYaw:0};ctx.p={position:[.2,-.4,.1],rotation:[0,0,0],scale:[1,1,1]};vm.runInContext('applyVolumeEmitterFamilyRuntimeToCockpit(c,p)',ctx);
 assert.equal(broadRefreshes,0,'a pose edit must not refresh all unrelated Workbench controls');
 for(const [suffix,value]of [['centre-x','0.20'],['centre-y','-0.40'],['centre-z','0.10'],['yaw','0.00'],['pitch','90.00']])assert.equal(elements.get('volume-immersed-'+suffix+'-val').textContent,value);
});
