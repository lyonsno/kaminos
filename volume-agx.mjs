import { linearToSrgb } from './volume-physical-color.mjs';

// AgX default look, matching Three.js / Filament's Rec.2020 approximation.
// Three.js copyright its contributors, MIT; see LICENSES/Three-AgX-MIT.txt.
// Matrices are columns, as in GLSL, WGSL and the Three.js TSL implementation.
const to2020 = [[.6274,.0691,.0164],[.3293,.9195,.0880],[.0433,.0113,.8956]];
const toSRGB = [[1.6605,-.1246,-.0182],[-.5876,1.1329,-.1006],[-.0728,-.0083,1.1187]];
const inset = [[.856627153315983,.137318972929847,.11189821299995],[.0951212405381588,.761241990602591,.0767994186031903],[.0482516061458583,.101439036467562,.811302368396859]];
const outset = [[1.1271005818144368,-.1413297634984383,-.14132976349843826],[-.11060664309660323,1.157823702216272,-.11060664309660294],[-.016493938717834573,-.016493938717834257,1.2519364065950405]];
const mul = (columns, rgb) => rgb.map((_, i) => columns.reduce((sum, column, j) => sum + column[i] * rgb[j], 0));
const clamp = x => Math.max(0, Math.min(1, x));
const contrast = x => {
  const x2 = x*x, x4 = x2*x2;
  return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + .4298*x2 + .1191*x - .00232;
};
export function agxLinearRGB(rgb, ev = 0) {
  let v = mul(inset, mul(to2020, rgb.map(x => x * 2**ev)));
  v = v.map(x => contrast(clamp((Math.log2(Math.max(x, 1e-10)) + 12.47393) / 16.499999)));
  v = mul(outset, v).map(x => Math.max(0, x)**2.2);
  return mul(toSRGB, v).map(clamp);
}
export const displayAgXRGB = (rgb, ev = 0) => agxLinearRGB(rgb, ev).map(linearToSrgb);
const matrix = columns => `mat3x3<f32>(${columns.map(c => `vec3<f32>(${c.map(x => String(x).includes('.') ? String(x) : `${x}.0`).join(',')})`).join(',')})`;
export const AGX_WGSL = /* wgsl */`
fn agxLinear(rgb: vec3<f32>, ev: f32) -> vec3<f32> {
  var v = ${matrix(inset)} * (${matrix(to2020)} * (rgb * exp2(ev)));
  v = clamp((log2(max(v, vec3<f32>(1e-10))) + vec3<f32>(12.47393)) / 16.499999, vec3<f32>(0.0), vec3<f32>(1.0));
  let x2 = v*v;
  let x4 = x2*x2;
  v = 15.5*x4*x2 - 40.14*x4*v + 31.96*x4 - 6.868*x2*v + 0.4298*x2 + 0.1191*v - vec3<f32>(0.00232);
  v = ${matrix(outset)} * v;
  v = pow(max(v, vec3<f32>(0.0)), vec3<f32>(2.2));
  return clamp(${matrix(toSRGB)} * v, vec3<f32>(0.0), vec3<f32>(1.0));
}
fn agxDisplay(rgb: vec3<f32>, ev: f32) -> vec3<f32> {
  let linear = agxLinear(rgb, ev);
  return select(1.055*pow(linear, vec3<f32>(1.0/2.4))-vec3<f32>(0.055), linear*12.92, linear <= vec3<f32>(0.0031308));
}
`;
