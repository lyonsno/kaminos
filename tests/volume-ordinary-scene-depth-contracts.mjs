import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
// Fail first on the pre-fix ordinary fragment, which always marches to infinity.
const fragment=core.match(/fn fs\(in: VSOut\)[\s\S]*?\n}/)[0];
assert.match(fragment,/ordinarySceneDepthEndT\(in\)/,'ordinary emissive raymarch must clip to scene depth without switching to fsProduct');
const {ordinarySceneDepthPixel,validateOrdinarySceneDepth}=await import('../volume-ordinary-scene-depth.mjs');
assert.deepEqual(ordinarySceneDepthPixel([0.25,0.75],[200,100]),[50,25]);
assert.deepEqual(ordinarySceneDepthPixel([1,0],[200,100]),[199,99]);
assert.deepEqual(ordinarySceneDepthPixel([0,1],[200,100]),[0,0]);
const device={},camera={};const texture={sampleCount:1,format:'depth24plus',width:200,height:100,createView:()=>({})};
assert.equal(validateOrdinarySceneDepth({device,camera,texture},{device,camera}),texture);
assert.throws(()=>validateOrdinarySceneDepth({device:{},camera,texture},{device,camera}),/device-mismatch/);
assert.throws(()=>validateOrdinarySceneDepth({device,camera:{},texture},{device,camera}),/camera-mismatch/);
assert.throws(()=>validateOrdinarySceneDepth(null,{device,camera}),/missing/);
// Observed Three prepass on the actual route is MSAA. Preserve it, do not
// disable scene antialiasing to make the consumer's binding convenient.
assert.equal(validateOrdinarySceneDepth({device,camera,texture:{...texture,sampleCount:4}},{device,camera}).sampleCount,4);
assert.throws(()=>validateOrdinarySceneDepth({device,camera,texture:{...texture,format:'rgba8unorm'}},{device,camera}),/format/);
// Exercise the actual host provider before any prepass can submit: a failed
// shared-device acquisition must report its own refusal, not a null dereference.
const shell=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const providerBody=shell.match(/ordinarySceneDepthProvider = \(\) => \{([\s\S]*?)\n  };/)[1];
let sceneRenders=0;
const provider=new Function('ordinaryDepthEnabled','sharedGpu','camera','syncViewportRendererSize','fireLightFieldPass','renderSceneFrame','renderer','prePass',`let sceneRenderedForVolume=false;\n${providerBody}`);
const invoke=enabled=>provider(enabled,null,{updateMatrixWorld(){}},()=>{},null,()=>{sceneRenders++;},{backend:{get:()=>({texture})}},{getTexture:()=>({})});
assert.throws(()=>invoke(true),/ordinary-scene-depth-shared-device-unavailable/);
assert.equal(sceneRenders,0,'unavailable shared device must refuse before rendering scene depth');
assert.equal(invoke(false),null,'disabled depth does not require the shared device');
console.log('ordinary scene-depth contracts passed');
