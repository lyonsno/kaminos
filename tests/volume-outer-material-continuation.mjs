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
// Integration stays bounded and split-step invariant for the blended medium.
const m=run(.5), sigma=m.absorption+m.scattering;
const full=integrateEmission(m.emission,sigma,.4), half=integrateEmission(m.emission,sigma,.2);
full.radiance.forEach((v,i)=>assert.ok(Math.abs(v-half.radiance[i]*(1+half.transmittance))<1e-12));
console.log('joined passive material coefficients, endpoints and integration passed');
