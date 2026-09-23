import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { integrateEmission, thermalRadianceRGB, cameraWhiteBalance, displayEmissiveRGB, EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';
import { linearLuminance } from '../volume-physical-color.mjs';

// Transport, not a verdict on whether the flame looks right.
assert.deepEqual(integrateEmission([2, 1, 0.5], 0, 0.25), { radiance: [0.5, 0.25, 0.125], transmittance: 1 });
for (const sigma of [1e-10, 0.1, 4, 80]) {
  const whole = integrateEmission([2, 1, 0.5], sigma, 1);
  const half = integrateEmission([2, 1, 0.5], sigma, 0.5);
  whole.radiance.forEach((v, i) => assert.ok(Math.abs(v - half.radiance[i] * (1 + half.transmittance)) < 1e-12));
  assert.ok(Math.abs(whole.transmittance - half.transmittance ** 2) < 1e-12);
}
assert.ok(Math.abs(linearLuminance(thermalRadianceRGB(1900)) - 1) < 1e-6);
assert.ok(linearLuminance(thermalRadianceRGB(2400)) > 10);
assert.ok(linearLuminance(thermalRadianceRGB(800)) < 1e-7);
const matrix = cameraWhiteBalance(4000);
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const materialLawControl = schema.controls.find(c => c.key === 'volume-physical-material-law');
assert.ok(materialLawControl, 'saved settings must identify the selected material law');
assert.equal(materialLawControl.additiveDefault, '0', 'old presets retain original mixed-carrier material');
assert.deepEqual(materialLawControl.allowedValues, ['0','1']);
// Material regression only: a heat/front carrier without transported soot
// must not manufacture incandescent particles. This is not image acceptance.
// These two scalar function bodies share JS/WGSL expression syntax. Execute
// both selected laws directly from production source, not a copied formula.
const scalarBody = name => EMISSIVE_TRANSPORT_WGSL.split(`fn ${name}(`)[1].split('\n}')[0].split('-> f32 {')[1];
const sootAt = new Function('coverage','sootYield','strength','smokeAmount','transported','max',scalarBody('emissiveSootPopulation'));
const hotSootAt = (...args) => sootAt(...args, true, Math.max);
assert.equal(hotSootAt(1, 1, 1, 0), 0, 'no transported soot means no hot-soot extinction/emission');
assert.equal(hotSootAt(0, 1, 1, 1), 0);
assert.equal(hotSootAt(1, 0, 1, 1), 0);
assert.equal(hotSootAt(1, 1, 0, 1), 0);
const energyAt = new Function('m','f','d','transported',scalarBody('emissiveHeatSource'));
assert.equal(energyAt({y:0}, {x:1,y:1,z:1}, {z:1}, true), 0, 'decorative flame/ember/lick carriers are not transported heat');
assert.equal(energyAt({y:1}, {x:0,y:0,z:0}, {z:0}, true), 1);
// Preserve exact old coefficient expressions for saved law 0, including its
// known nonphysical floor. Selecting the correction is explicit and persisted.
for (const smoke of [0,0.1,0.5,1,2]) {
  assert.equal(sootAt(0.7,0.8,1.5,smoke,false,Math.max),0.7*0.8*1.5*(0.35+smoke*0.65));
}
assert.equal(energyAt({y:1},{x:0.2,y:0.3,z:0.4},{z:0.5},false),1*0.65+0.2+0.3*0.35+0.4*0.40+0.5*0.55);
assert.match(EMISSIVE_TRANSPORT_WGSL,/let transported = u\.emissive_material\.w > 0\.5/);
assert.match(EMISSIVE_TRANSPORT_WGSL,/let energy = emissiveHeatSource\(m, f, d, transported\)/);
assert.match(EMISSIVE_TRANSPORT_WGSL,/let hotSoot = emissiveSootPopulation\(coverage, sootYield, u\.physical_fire\.w, smokeAmount, transported\)/);
assert.match(EMISSIVE_TRANSPORT_WGSL,/vec3<f32>\(f32\(k&1u\),f32\(\(k>>1u\)&1u\),f32\(\(k>>2u\)&1u\)\)\+vec3<f32>\(0\.25\)\)\*0\.5/,
  'diagnostic integration phase uses one-eighth/five-eighths within-cell samples');
// Production-linked shader contract, not just the CPU reference: channel-wise
// shoulder and selection must remain on the actual camera path. Existing native
// captures establish compilation/output; this narrow guard protects the formula.
const camera = EMISSIVE_TRANSPORT_WGSL.split('fn emissiveCamera(')[1].split('const LIGHT_GRID')[0];
assert.ok(camera.includes('let shoulder = vec3<f32>(1.0)-d*d/max(exposed+vec3<f32>(1.0-2.0*knee),vec3<f32>(d));'));
assert.ok(camera.includes('let linear = select(exposed, shoulder, exposed > vec3<f32>(knee));'));
assert.ok(camera.includes('linear*12.92,linear <= vec3<f32>(0.0031308)'));
assert.doesNotMatch(camera, /physicalDisplay\(|neutral|mappedPeak/);
assert.equal(displayEmissiveRGB([20,.5,.02])[2],displayEmissiveRGB([2,.5,.02])[2]);
assert.deepEqual(displayEmissiveRGB([0,0,0]),[0,0,0]);
for (const x of [.1,.6,1,10]) {
  const neutral = displayEmissiveRGB([x,x,x]);
  assert.equal(neutral[0],neutral[1]); assert.equal(neutral[1],neutral[2]);
  assert.ok(neutral[0] >= 0 && neutral[0] <= 1);
}
const white = thermalRadianceRGB(4000);
const balanced = matrix.map(row => row.reduce((sum, v, i) => sum + v * white[i], 0));
assert.ok(Math.max(...balanced) / Math.min(...balanced) < 1.001);
console.log('emissive coefficient integration, fixed-reference power, and camera white balance pass');
