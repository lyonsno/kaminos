import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMISSIVE_TRANSPORT_WGSL as wgsl, integrateEmission } from '../volume-emissive-transport.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
function body(name) {
  const start = wgsl.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `missing production material helper ${name}`);
  const open = wgsl.indexOf('{', start); let depth = 1, end = open + 1;
  while (depth && end < wgsl.length) { if (wgsl[end] === '{') depth++; if (wgsl[end] === '}') depth--; end++; }
  return wgsl.slice(open + 1, end - 1);
}
// Evaluate the actual coefficient blend (vector mix is supplied elementwise).
const mix = (a,b,w) => Array.isArray(a) ? a.map((x,i)=>mix(x,b[i],w)) : a*(1-w)+b*w;
const blend = new Function('fine','outer','weight','mix','clamp','EmissiveMaterial',
  body('blendEmissiveMaterial').replace(/\blet\b/g,'const'));
const make = (emission,absorption,scattering)=>({emission,absorption,scattering});
const a=make([2,1,.3],3,2), b=make([.8,.4,.1],1,.5);
const run=w=>blend(a,b,w,mix,(x,l,h)=>Math.min(h,Math.max(l,x)),make);
assert.deepEqual(run(0),a); assert.deepEqual(run(1),b);
assert.deepEqual(run(-1),a); assert.deepEqual(run(2),b);
assert.deepEqual(run(.5),make([1.4,.7,.2],2,1.25));
const passive=body('passiveEmissiveMaterial');
assert.match(passive,/r\.material\s*=\s*vec4<f32>\(material\.xy,\s*0\.0,\s*0\.0\)/,
  'outer proxy already includes detail; fuel/front must not fabricate fresh combustion');
assert.match(passive,/emissiveMaterial\(r,\s*select\(0\.0,\s*fireVisible,\s*transported\),\s*smokeVisible\)/);
assert.match(passive,/u\.physical_fire\.x > 1\.5 && u\.emissive_material\.w > 0\.5/,'legacy rendering must not acquire thermal emission');
const far=core.slice(core.indexOf('if (OUTER_SMOKE && !outerInsideNear(p))'),core.indexOf('let flowKernelReconstructionActive',core.indexOf('if (OUTER_SMOKE && !outerInsideNear(p))')));
assert.match(far,/passiveEmissiveMaterial/);
assert.match(far,/medium\.emission\s*\+\s*medium\.scattering/,'outer emission must reach the ray integral');
assert.match(core,/medium\s*=\s*blendEmissiveMaterial\(medium,\s*passiveEmissiveMaterial/);
// Execute the weight helper selected by the actual transported camera path.
// The passive endpoint has no fresh reaction source: the inlet floor must not
// replace fine flame material merely because fuel enters there. Side/top
// outflow still uses the existing complete-coefficient transition.
const materialPath=core.slice(core.indexOf('var medium = emissiveMaterial(reconstructed'),
  core.indexOf('let sigma = medium.absorption',core.indexOf('var medium = emissiveMaterial(reconstructed')));
const selected=materialPath.match(/let w\s*=\s*(\w+)\(p,min\(1\.0,max\(\.25,2\.0\*outerWidth\)\)\)/);
assert.ok(selected,'transported camera weight helper is missing');
const smoothstep=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
const cameraWeight=name=>{
  const match=core.match(new RegExp(`fn ${name}\\(p:vec3<f32>,width:f32\\)->f32 \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match,`selected camera weight ${name} is missing`);
  const fn=new Function('p','width','GRID_Y','GRID','min','abs','smoothstep','f32',
    match[1].replace(/\blet\b/g,'const').replace(/p\.([xyz])/g,(_,a)=>`p[${'xyz'.indexOf(a)}]`));
  return (p,width,ratio=1)=>fn(p,width,32*ratio,32,Math.min,Math.abs,smoothstep,Number);
};
const handoff=cameraWeight(selected[1]),legacyWeight=cameraWeight('outerSmokeBlend');
assert.equal(handoff([0,-1,0],.5),0,'inlet floor must retain the existing fine emission source');
assert.equal(handoff([0,-.875,0],.5),0,'inlet transition band must not fade fine material');
assert.ok(handoff([.091763,-.999163,.502080],.5)<.001,'observed inlet source must survive the selected material handoff');
assert.equal(legacyWeight([0,-1,0],.5),1,'legacy smoke blending remains unchanged');
for(const ratio of [1,2]){
  assert.equal(handoff([0,0,0],.5,ratio),0);
  for(const p of [[1,0,0],[0,0,-1],[0,2*ratio-1,0],[.875,0,0],[0,2*ratio-1-.125,0]]){
    assert.equal(handoff(p,.5,ratio),legacyWeight(p,.5,ratio),'side/top handoff must retain its existing coefficient weight');
  }
  assert.equal(handoff([.875,-1,0],.5,ratio),legacyWeight([.875,0,0],.5,ratio),
    'a side overlap remains active even beside the inlet floor');
}
const inlet=blend(a,b,handoff([0,-1,0],.5),mix,(x,l,h)=>Math.min(h,Math.max(l,x)),make);
assert.deepEqual(inlet,a,'complete fine coefficients, including emission and extinction, survive at the inlet');
// Integration stays bounded and split-step invariant for the blended medium.
const m=run(.5), sigma=m.absorption+m.scattering;
const full=integrateEmission(m.emission,sigma,.4), half=integrateEmission(m.emission,sigma,.2);
full.radiance.forEach((v,i)=>assert.ok(Math.abs(v-half.radiance[i]*(1+half.transmittance))<1e-12));
console.log('joined passive material coefficients, endpoints and integration passed');
