// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {configureMaterialSideAODepth} from '../scene-ao-depth.mjs';
const module=await import('../scene-lighting-graph.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const factory=()=>{assert.equal(typeof module.createSceneLightingGraph,'function','ordinary lighting resources must construct outside the page initializer');return module.createSceneLightingGraph;};
function fixture(){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,2,.01,100),renderer={getDrawingBufferSize:v=>v.set(80,40)};
 const ao={radius:{value:0},scale:{value:0},thickness:{value:0},distanceFallOff:{value:0},updateBefore(){},setDepthPass(...args){this.depthPass=args;},getTextureNode:()=>THREE.TSL.texture(new THREE.Texture())};
 const calls=[],gi={owner:'injected real-domain factory',reflections:{settings:{enabled:false}}};
 const settings={radius:3,scale:2,thickness:.1,falloff:1};
 const result=factory()({THREE,scene,camera,renderer,aoSettings:settings,aoIntensityValue:.7,giOptions:{filterImplementation:'shared',surfaceReuse:true},
  aoCompute:(depth,normal,c)=>{calls.push({kind:'ao',depth,normal,camera:c});return ao;},
  configureMaterialSideAODepth:(...args)=>{calls.push({kind:'depth',args});return configureMaterialSideAODepth(...args);},
  denoise:(...args)=>{calls.push({kind:'denoise',args});return THREE.TSL.texture(new THREE.Texture());},
  createSceneGI:(...args)=>{calls.push({kind:'gi',args});return gi;}});
 return {result,ao,calls,scene,camera,renderer,gi};
}
test('actual vendored Three lighting graph constructs without DOM or GPU admission',()=>{
 assert.equal(typeof document,'undefined');assert.equal(typeof window,'undefined');const f=fixture(),r=f.result;
 assert.equal(r.renderPipeline.renderer,f.renderer);assert.equal(r.sceneGI,f.gi);assert.equal(r.scenePass.isPassNode,true);
 assert.equal(r.prePass.transparent,false);assert.equal(r.prePass.getTexture('output').type,THREE.UnsignedByteType);
 assert.deepEqual([r.depthRT.width,r.depthRT.height],[40,20]);assert.equal(r.depthRT.texture.type,THREE.FloatType);
 assert.equal(r.depthMaterial.blending,THREE.NoBlending);assert.equal(r.depthMaterial.name,'LinearDepthToColor');
});
test('AO values, depth ownership and GI inputs retain the ordinary scene contract',()=>{
 const f=fixture(),r=f.result;
 assert.deepEqual([f.ao.radius.value,f.ao.scale.value,f.ao.thickness.value,f.ao.distanceFallOff.value],[3,2,.1,1]);
 assert.deepEqual(f.ao.depthPass,[null,null,null]);assert.equal(r.aoIntensity.value,.7);
 assert.deepEqual(f.calls.map(c=>c.kind),['ao','depth','denoise','gi']);
 const [scene,camera,intensity,options]=f.calls.at(-1).args;
 assert.equal(scene,f.scene);assert.equal(camera,f.camera);assert.equal(intensity,r.aoIntensity);assert.equal(options.renderer,f.renderer);
 assert.equal(options.filterImplementation,'shared');assert.equal(options.surfaceReuse,true);
 assert.equal(f.calls[2].args[1],r.prePassDepth);assert.equal(f.calls[2].args[3],f.camera);
});
