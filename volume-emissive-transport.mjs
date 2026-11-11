import { blackbodyXYZ, thermalLinearRGB, linearLuminance } from './volume-physical-color.mjs';
import { CIE_1931_2DEG } from './cie-1931-observer.mjs';
import { displayAgXRGB } from './volume-agx.mjs';

const referenceY = blackbodyXYZ(1900)[1];
// Independent sensor-channel saturation; no exposure-dependent white is added.
export function displayEmissiveRGB(rgb, ev = 0, knee = .6, white = [[1,0,0],[0,1,0],[0,0,1]], toneMapping = 'agx') {
  const balanced = white.map(row => row.reduce((sum,v,i)=>sum+v*rgb[i],0));
  if (toneMapping === 'agx') return displayAgXRGB(balanced, ev);
  return balanced.map(v => {
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
// Shared scene-source sampling resolution; independent of incident-light transport.
export const SCENE_SOURCE_GRID = 32;

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
// Reaction light from the fresh burn rate: 1 - 1/e at one appearance burn
// reference (the reactant model's normalisation, not chemistry).
fn reactionLightFromBurn(freshBurn: f32, reference: f32) -> f32 {
  return 1.0-exp(-max(freshBurn,0.0)/max(reference,1e-6));
}
// Physics appearance (volume-physics-appearance.mjs; operator 2026-10-14): soot
// emits as a blackbody at the temperature the heat field implies, absorbs and
// scatters by the same coefficient, and fresh burning adds the reaction spectrum.
// No appearance carrier and no carrier-built coverage is read.
fn physicsEmissiveMaterial(r: FlowReconstructionSample, smokeVisible: f32) -> EmissiveMaterial {
  let m = max(r.material, vec4<f32>(0.0));
  let soot = m.x * max(0.0, u.viewport_steps_density.w);
  let extinction = soot * u.emissive_material.x;
  let albedo = clamp(u.emissive_material.y, 0.0, 1.0);
  let scattering = extinction * albedo * smokeVisible;
  let absorbing = extinction * (1.0 - albedo);
  let kelvin = physicsSootKelvin(m.y, u.emissive_physics.y);
  let thermal = absorbing * thermalRadiance(kelvin) * u.physical_fire.w;
  let burnLight = reactionLightFromBurn(r.freshBurn, u.reactant_combustion_d.x);
  let clean = burnLight * exp(-extinction * 2.0);
  let gas = vec3<f32>(${REACTION_RGB.join(',')}) * clean * u.physical_display.x;
  return EmissiveMaterial(thermal + gas, absorbing * smokeVisible, scattering);
}
fn emissiveMaterial(r: FlowReconstructionSample, coverage: f32, smokeVisible: f32) -> EmissiveMaterial {
  return physicsEmissiveMaterial(r, smokeVisible);
}
fn sceneEmissiveMaterialAt(p: vec3<f32>) -> EmissiveMaterial {
  let r = sampleWorldFlowReconstructionRaw(p);
  let coverage = liveBoundarySupportAt(p, max(u.topology_shell_carriers,vec4<f32>(0.0)));
  // Shared scene transport sees authored material, independent of whether the
  // raymarch presentation chooses to show smoke. Suppression is consumer-local.
  return emissiveMaterial(r,coverage,1.0);
}
fn fastEmissiveMaterialAt(p: vec3<f32>, smokeVisible: f32) -> EmissiveMaterial {
  if (u.open_world_boundary.z > 0.5 && u.emissive_physics.x > 0.5) {
    var r: FlowReconstructionSample;
    r.material = sampleWorldMaterial(p);
    r.freshBurn = sampleWorldReactantBurn(p);
    if (r.material.x <= 1e-6 && r.freshBurn <= 1e-6) {
      return EmissiveMaterial(vec3<f32>(0.0), 0.0, 0.0);
    }
    return physicsEmissiveMaterial(r, smokeVisible);
  }
  let r = sampleWorldFlowReconstructionRaw(p);
  let coverage = liveBoundarySupportAt(p, max(u.topology_shell_carriers,vec4<f32>(0.0)));
  return emissiveMaterial(r, coverage, smokeVisible);
}
fn emissiveCamera(rgb: vec3<f32>) -> vec3<f32> {
  let balanced = vec3<f32>(dot(u.emissive_white_r.xyz,rgb),dot(u.emissive_white_g.xyz,rgb),dot(u.emissive_white_b.xyz,rgb));
  if (u.reserved_render_controls.z > 0.5) { return agxDisplay(balanced, u.physical_display.y); }
  let exposed = max(vec3<f32>(0.0), balanced*exp2(u.physical_display.y));
  let knee = u.physical_display.z;
  let d = 1.0-knee;
  let shoulder = vec3<f32>(1.0)-d*d/max(exposed+vec3<f32>(1.0-2.0*knee),vec3<f32>(d));
  let linear = select(exposed, shoulder, exposed > vec3<f32>(knee));
  return select(1.055*pow(linear,vec3<f32>(1.0/2.4))-vec3<f32>(0.055),linear*12.92,linear <= vec3<f32>(0.0031308));
}
// No implicit incident-light producer. Distributed and point consumers replace
// this call when attached; emission and extinction remain independently usable.
fn incidentAt(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(0.0);
}
`;
