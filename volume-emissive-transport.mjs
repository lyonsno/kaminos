import { blackbodyXYZ, thermalLinearRGB, linearLuminance } from './volume-physical-color.mjs';
import { CIE_1931_2DEG } from './cie-1931-observer.mjs';

const referenceY = blackbodyXYZ(1900)[1];
// Independent sensor-channel saturation; no exposure-dependent white is added.
export function displayEmissiveRGB(rgb, ev = 0, knee = .6) {
  return rgb.map(v => {
    let x = Math.max(0, v * 2 ** ev);
    if (x > knee) x = 1 - (1-knee)**2 / (x+1-2*knee);
    return x <= .0031308 ? x*12.92 : 1.055*x**(1/2.4)-.055;
  });
}
export function thermalRadianceRGB(kelvin) {
  return thermalLinearRGB(kelvin).map(v => v * blackbodyXYZ(kelvin)[1] / referenceY);
}
export function integrateEmission(j, sigma, ds) {
  const transmittance = Math.exp(-sigma * ds);
  const weight = sigma === 0 ? ds : -Math.expm1(-sigma * ds) / sigma;
  return { radiance: j.map(v => v * weight), transmittance };
}
// Fixed camera white, never a frame statistic. Bradford chromatic adaptation
// from the selected Planckian illuminant to the linear-sRGB D65 white.
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const rgbToXYZ = [[.4124564,.3575761,.1804375],[.2126729,.7151522,.0721750],[.0193339,.1191920,.9503041]];
const xyzToRGB = [[3.2404542,-1.5371385,-.4985314],[-.969266,1.8760108,.041556],[.0556434,-.2040259,1.0572252]];
const bradford = [[.8951,.2664,-.1614],[-.7502,1.7135,.0367],[.0389,-.0685,1.0296]];
const inverseBradford = [[.9869929,-.1470543,.1599627],[.4323053,.5183603,.0492912],[-.0085287,.0400428,.9684867]];
export function cameraWhiteBalance(kelvin) {
  // Use the renderer's own RGB conversion to avoid inconsistent rounded matrices.
  const whiteRGB = thermalLinearRGB(kelvin);
  const source = multiply(bradford, multiply(rgbToXYZ, whiteRGB.map(v => [v]))).map(row => row[0]);
  const target = multiply(bradford, [[.95047],[1],[1.08883]]).map(row => row[0]);
  const scale = source.map((v, i) => source.map((_, j) => i === j ? target[i] / v : 0));
  return multiply(xyzToRGB, multiply(inverseBradford, multiply(scale, multiply(bradford, rgbToXYZ))));
}
// Approximate hydrocarbon reaction spectrum, not measured fuel chemistry.
// CH* / C2* band reference: doi:10.3390/s22155665 (Figure 1).
// Band positions are sourced; widths and relative powers are explicit renderer
// approximations. Including C2 avoids mistaking CH-only violet for a blue flame.
const reactionXYZ = [0,0,0];
for (const [nm, x, y, z] of CIE_1931_2DEG) {
  const power = Math.exp(-.5*((nm-431)/9)**2) + .25*Math.exp(-.5*((nm-474)/9)**2) + .60*Math.exp(-.5*((nm-516)/9)**2);
  [x,y,z].forEach((v, i) => reactionXYZ[i] += power*v);
}
const reactionRGB = xyzToRGB.map(row => Math.max(0, row.reduce((sum, v, i) => sum + v*reactionXYZ[i], 0)));
export const REACTION_RGB = reactionRGB.map(v => v / linearLuminance(reactionRGB));
export const EMISSIVE_LIGHT_GRID = 32;

export function createEmissiveLightField(device, module, uniformBuffer, fluidBuffers, frontBuffers) {
  const cells = EMISSIVE_LIGHT_GRID ** 3;
  const allocate = (label, count) => device.createBuffer({ label, size: count*16, usage: GPUBufferUsage.STORAGE });
  const coefficients = allocate('emissive material coefficients', cells);
  const directions = allocate('six-direction incident radiance', cells*6);
  const incident = allocate('single-scattering mean incident radiance', cells);
  const pipeline = name => device.createComputePipeline({ label: name, layout: 'auto', compute: { module, entryPoint: name } });
  const seed = pipeline('seedEmissiveLight'), sweep = pipeline('sweepEmissiveLight'), resolve = pipeline('resolveEmissiveLight');
  const group = (pipe, index, buffers) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(index),
    entries: buffers.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
  });
  const seedInputs = fluidBuffers.map((buffer, i) => group(seed,0,[[0,uniformBuffer],[1,buffer],[7,frontBuffers[i]]]));
  const seedOutput = group(seed,3,[[1,coefficients]]);
  const sweepInput = group(sweep,0,[[0,uniformBuffer],[13,coefficients]]);
  const sweepOutput = group(sweep,3,[[2,directions]]);
  const resolveInput = group(resolve,0,[[14,directions]]);
  const resolveOutput = group(resolve,3,[[3,incident]]);
  return {
    incident,
    encode(encoder, sourceIndex, timestampWrites) {
      const pass = encoder.beginComputePass({ label: 'same-state emissive single-scattering field', ...(timestampWrites ? { timestampWrites } : {}) });
      pass.setPipeline(seed); pass.setBindGroup(0,seedInputs[sourceIndex]); pass.setBindGroup(3,seedOutput);
      pass.dispatchWorkgroups(EMISSIVE_LIGHT_GRID/4,EMISSIVE_LIGHT_GRID/4,EMISSIVE_LIGHT_GRID/4);
      pass.setPipeline(sweep); pass.setBindGroup(0,sweepInput); pass.setBindGroup(3,sweepOutput);
      pass.dispatchWorkgroups(Math.ceil(6*EMISSIVE_LIGHT_GRID**2/64));
      pass.setPipeline(resolve); pass.setBindGroup(0,resolveInput); pass.setBindGroup(3,resolveOutput);
      pass.dispatchWorkgroups(Math.ceil(cells/64));
      pass.end();
    },
    destroy() { coefficients.destroy(); directions.destroy(); incident.destroy(); },
  };
}

export const EMISSIVE_TRANSPORT_WGSL = /* wgsl */`
struct EmissiveMaterial { emission: vec3<f32>, absorption: f32, scattering: f32, }
fn thermalRadiance(kelvin: f32) -> vec3<f32> {
  let p = (clamp(kelvin, 800.0, 6000.0)-800.0)/10.0;
  let lo = min(u32(floor(p)), 519u);
  let a = u.thermal_color_lut[lo];
  let b = u.thermal_color_lut[lo+1u];
  return mix(a.rgb*a.w, b.rgb*b.w, p-f32(lo));
}
fn emissionIntegral(sigma: f32, ds: f32) -> f32 {
  let tau = sigma*ds;
  // Avoid cancellation in 1-exp(-tau) while preserving the vacuum limit.
  if (tau < 0.001) { return ds*(1.0-tau*0.5+tau*tau/6.0); }
  return (1.0-exp(-tau))/sigma;
}
fn emissiveMaterial(r: FlowReconstructionSample, coverage: f32, smokeVisible: f32) -> EmissiveMaterial {
  let m = max(r.material, vec4<f32>(0.0));
  let f = max(r.fireLayer, vec4<f32>(0.0));
  let d = max(r.microLayer, vec4<f32>(0.0));
  // The simulation transports heat in material.y. Flame, ember, flame-detail
  // and lick carriers describe appearance/support, not additional heat units.
  // Summing them reheated cold detail and flattened temperature distinctions.
  // Kelvin remains a renderer calibration of this dimensionless heat field.
  let energy = m.y;
  let activity = 1.0-exp(-energy*1.6);
  // Mode 2's temperature is the hot ceiling, and spread is cooling below it.
  // Brightness therefore cannot hide a much hotter, unlabelled half-spread.
  let hotKelvin = u.physical_fire.y - (1.0-activity)*u.physical_fire.z;
  let kelvin = mix(800.0, max(800.0, hotKelvin), smoothstep(0.003, 0.10, energy));
  let sootYield = max(0.0, u.boundary_fire_color.y);
  // Mode 2 has one named smoke coefficient scale; the old Smoke slider was
  // a multiplier for a separately painted radiance/alpha path, not this material.
  let smokeAmount = (m.x+d.x*0.50+m.w*0.08) * max(0.0, u.viewport_steps_density.w);
  // Boundary coverage locates the material; it is not itself a supply of soot.
  // Use the transported soot proxy without a positive density floor. The
  // clean reaction spectrum can still emit where this thermal population is zero.
  let hotSoot = max(0.0, coverage) * sootYield * u.physical_fire.w * smokeAmount;
  let smokeExtinction = smokeAmount * u.emissive_material.x * smokeVisible;
  let scattering = smokeExtinction * u.emissive_material.y;
  let absorption = hotSoot + smokeExtinction-scattering;
  // Reaction light is tied to fresh fuel at the thin reaction interface. Soot
  // suppresses it locally; there is no normalized blue term over the warm body.
  let front = smoothstep(0.001,0.12,r.frontTopology+f.w*0.5+d.z*0.08);
  let freshFuel = smoothstep(0.008,0.20,m.z);
  let clean = max(0.0,coverage)*front*freshFuel*exp(-sootYield*smokeAmount*4.0-hotSoot*2.0);
  let gas = vec3<f32>(${REACTION_RGB.join(',')}) * clean * u.physical_display.x;
  let emission = hotSoot*thermalRadiance(kelvin) + gas;
  return EmissiveMaterial(emission, absorption, scattering);
}
fn emissiveCamera(rgb: vec3<f32>) -> vec3<f32> {
  let balanced = vec3<f32>(dot(u.emissive_white_r.xyz,rgb),dot(u.emissive_white_g.xyz,rgb),dot(u.emissive_white_b.xyz,rgb));
  let exposed = max(vec3<f32>(0.0), balanced*exp2(u.physical_display.y));
  let knee = u.physical_display.z;
  let d = 1.0-knee;
  let shoulder = vec3<f32>(1.0)-d*d/max(exposed+vec3<f32>(1.0-2.0*knee),vec3<f32>(d));
  let linear = select(exposed, shoulder, exposed > vec3<f32>(knee));
  return select(1.055*pow(linear,vec3<f32>(1.0/2.4))-vec3<f32>(0.055),linear*12.92,linear <= vec3<f32>(0.0031308));
}
const LIGHT_GRID: u32 = ${EMISSIVE_LIGHT_GRID}u;
const LIGHT_CELLS: u32 = LIGHT_GRID*LIGHT_GRID*LIGHT_GRID;
@group(0) @binding(13) var<storage,read> emissiveCoefficients: array<vec4<f32>>;
@group(0) @binding(14) var<storage,read> emissiveDirections: array<vec4<f32>>;
@group(0) @binding(15) var<storage,read> emissiveIncident: array<vec4<f32>>;
@group(3) @binding(1) var<storage,read_write> emissiveCoefficientsDst: array<vec4<f32>>;
@group(3) @binding(2) var<storage,read_write> emissiveDirectionsDst: array<vec4<f32>>;
@group(3) @binding(3) var<storage,read_write> emissiveIncidentDst: array<vec4<f32>>;
fn lightIndex(c: vec3<u32>) -> u32 { return c.x+LIGHT_GRID*(c.y+LIGHT_GRID*c.z); }
fn incidentAt(p: vec3<f32>) -> vec3<f32> {
  let q = clamp((p*0.5+vec3<f32>(0.5))*f32(LIGHT_GRID)-vec3<f32>(0.5),vec3<f32>(0.0),vec3<f32>(f32(LIGHT_GRID)-1.001));
  let c = vec3<u32>(floor(q)); let w = fract(q);
  var sum = vec3<f32>(0.0);
  for (var z=0u; z<2u; z++) { for (var y=0u; y<2u; y++) { for (var x=0u; x<2u; x++) {
    let weight = select(1.0-w.x,w.x,x==1u)*select(1.0-w.y,w.y,y==1u)*select(1.0-w.z,w.z,z==1u);
    sum += emissiveIncident[lightIndex(c+vec3<u32>(x,y,z))].rgb*weight;
  } } }
  return sum;
}
// This lattice is a coarse single-scattering lighting approximation. Its
// support is a cell-volume sample, not a substitute for the camera's ridge.
@compute @workgroup_size(4,4,4)
fn seedEmissiveLight(@builtin(global_invocation_id) c: vec3<u32>) {
  if (any(c>=vec3<u32>(LIGHT_GRID))) { return; }
  var coefficients = vec4<f32>(0.0);
  for(var k=0u;k<8u;k++) {
    let offset = (vec3<f32>(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u))+vec3<f32>(0.5))*0.5;
    let p = (vec3<f32>(c)+offset)*(2.0/f32(LIGHT_GRID))-vec3<f32>(1.0);
    let r = sampleWorldFlowReconstructionRaw(p);
    let support = liveBoundarySupportAt(p, max(u.topology_shell_carriers,vec4<f32>(0.0)));
    let coverage = support;
    let medium = emissiveMaterial(r,coverage,1.0-u.boundary_fire_display.z);
    coefficients += vec4<f32>(medium.emission,medium.absorption+medium.scattering)*0.125;
  }
  emissiveCoefficientsDst[lightIndex(c)] = coefficients;
}
// Six discrete directions, each column solved front-to-back. No amplifying
// neighbor diffusion and no secondary ray per camera sample.
@compute @workgroup_size(64)
fn sweepEmissiveLight(@builtin(global_invocation_id) id: vec3<u32>) {
  let plane = LIGHT_GRID*LIGHT_GRID;
  if(id.x>=6u*plane) { return; }
  let direction = id.x/plane; let column = id.x%plane;
  var light = vec3<f32>(u.emissive_material.z);
  let ds = 2.0/f32(LIGHT_GRID);
  for(var step=0u;step<LIGHT_GRID;step++) {
    let along = select(step,LIGHT_GRID-1u-step,(direction&1u)==1u);
    var c = vec3<u32>(along,column%LIGHT_GRID,column/LIGHT_GRID);
    if(direction/2u==1u) { c=c.yxz; }
    if(direction/2u==2u) { c=c.yzx; }
    let index = lightIndex(c); let material = emissiveCoefficients[index];
    let halfT = exp(-material.w*ds*0.5);
    let centerLight = light*halfT+material.rgb*emissionIntegral(material.w,ds*0.5);
    emissiveDirectionsDst[direction*LIGHT_CELLS+index] = vec4<f32>(centerLight,0.0);
    light = centerLight*halfT+material.rgb*emissionIntegral(material.w,ds*0.5);
  }
}
@compute @workgroup_size(64)
fn resolveEmissiveLight(@builtin(global_invocation_id) id: vec3<u32>) {
  if(id.x>=LIGHT_CELLS) { return; }
  var light = vec3<f32>(0.0);
  for(var direction=0u;direction<6u;direction++) { light += emissiveDirections[direction*LIGHT_CELLS+id.x].rgb/6.0; }
  emissiveIncidentDst[id.x] = vec4<f32>(light,1.0);
}
`;
