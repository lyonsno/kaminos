// kaminos-test: node
import assert from 'node:assert/strict';
import {NodeMaterial, TSL} from '../lib/three.webgpu.js';

// The hook must wrap actual material light evaluation, before emission/fog;
// a final getOutput rewrite would still pay for the original shader.
const material=new NodeMaterial();
const original=material.setupOutgoingLight;
material.setupOutgoingLight=()=>TSL.vec3(.2,.3,.4);
const replacement=TSL.vec3(.5,.6,.7);
let calls=0;
const builder={material,renderer:{lighting:{enabled:false}},lightsNode:null,
 context:{getOutgoingLight(node,b){calls++;assert.equal(b.material,material);return replacement;}}};
assert.equal(material.setupLighting(builder),replacement,'material shading must admit reuse before emission');
assert.equal(calls,1);
material.setupOutgoingLight=original;
console.log('material-light reuse hook passed');
const {applyCachedLighting,specularVisibility,supportsShadingReuse}=await import('../scene-shading-cache.mjs');
for(const ao of [0,.2,.6,1])for(const sceneAO of [0,.1,.8,1])for(const nv of [0,.5,1])for(const roughness of [.05,.4,1]){
 const direct=[.3,.7,1],diffuse=[.1,.2,.3],specular=[.2,.4,.6];
 const base=direct.map((d,i)=>d+ao*diffuse[i]+specularVisibility(ao,nv,roughness)*specular[i]);
 const expected=direct.map((d,i)=>d+ao*sceneAO*diffuse[i]+specularVisibility(ao*sceneAO,nv,roughness)*specular[i]);
 const actual=applyCachedLighting({base,diffuse,specular,materialAO:ao,sceneAO,nv,roughness});
 actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12));
}
assert.equal(supportsShadingReuse({isMeshStandardMaterial:true}),true);
for(const option of ['transparent','transmissionNode','clearcoatNode','sheenNode','backdropNode','fragmentNode','outputNode','alphaToCoverage'])assert.equal(supportsShadingReuse({isMeshStandardMaterial:true,[option]:true}),false,option);
console.log('AO response reconstruction passed');
