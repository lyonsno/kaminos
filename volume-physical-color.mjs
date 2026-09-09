import { CIE_1931_2DEG } from './cie-1931-observer.mjs';

// Planck spectral radiance integrated against the complete CIE 1931 observer.
// Relative XYZ: the common 2hc² factor cancels on luminance normalization.
// This is thermal chromaticity, NOT a calibrated combustion temperature/energy model.
export function blackbodyXYZ(kelvin) {
  if (!Number.isFinite(kelvin) || kelvin <= 0) throw new Error('invalid blackbody temperature');
  const xyz = [0, 0, 0];
  const c2 = 6.62607015e-34 * 299792458 / 1.380649e-23;
  for (const [nm, x, y, z] of CIE_1931_2DEG) {
    const m = nm * 1e-9;
    const power = 1 / (m ** 5 * Math.expm1(c2 / (m * kelvin)));
    xyz[0] += power * x; xyz[1] += power * y; xyz[2] += power * z;
  }
  return xyz;
}
export const linearLuminance = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
export const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
export function thermalLinearRGB(kelvin) {
  const xyz = blackbodyXYZ(kelvin);
  const [x, y, z] = xyz.map(v => v / xyz[1]);
  const rgb = [3.2406*x - 1.5372*y - 0.4986*z, -0.9689*x + 1.8758*y + 0.0415*z, 0.0557*x - 0.2040*y + 1.0570*z];
  const luminance = linearLuminance(rgb);
  return rgb.map(v => v / luminance);
}
export const THERMAL_LUT_MIN = 800;
export const THERMAL_LUT_MAX = 6000;
export const THERMAL_LUT_STEP = 10;
export const THERMAL_LUT_COUNT = (THERMAL_LUT_MAX - THERMAL_LUT_MIN) / THERMAL_LUT_STEP + 1;
// Uniform ABI follows the existing 368 floats, two control vectors, then LUT.
export const PHYSICAL_COLOR_UNIFORM_FLOATS = 376 + 4 * THERMAL_LUT_COUNT;
export const THERMAL_LUT = new Float32Array(Array.from({ length: THERMAL_LUT_COUNT }, (_, i) => [...thermalLinearRGB(THERMAL_LUT_MIN + i * THERMAL_LUT_STEP), 0]).flat());
export function sampleThermalLUT(kelvin) {
  const position = (Math.max(THERMAL_LUT_MIN, Math.min(THERMAL_LUT_MAX, kelvin)) - THERMAL_LUT_MIN) / THERMAL_LUT_STEP;
  const lo = Math.min(THERMAL_LUT_COUNT - 2, Math.floor(position));
  return [0, 1, 2].map(i => THERMAL_LUT[lo*4+i] * (1-position+lo) + THERMAL_LUT[(lo+1)*4+i] * (position-lo));
}

// Linear below the knee; smooth luminance shoulder above it. Compress chroma
// toward equal-energy RGB at fixed luminance only as needed to fit the SDR cube.
export function displayPhysicalRGB(rgb, exposureEV = 0, knee = 0.6) {
  const exposed = rgb.map(v => v * 2 ** exposureEV);
  const y = linearLuminance(exposed);
  if (y <= 0) return [0, 0, 0];
  const mapped = y <= knee ? y : knee + (1-knee) * (1-Math.exp(-(y-knee)/(1-knee)));
  const scaled = exposed.map(v => v * mapped / y);
  let saturation = 1;
  for (const v of scaled) {
    if (v > mapped) saturation = Math.min(saturation, (1-mapped)/(v-mapped));
    if (v < mapped) saturation = Math.min(saturation, mapped/(mapped-v));
  }
  return scaled.map(v => linearToSrgb(Math.max(0, Math.min(1, mapped + saturation*(v-mapped)))));
}

export const PHYSICAL_COLOR_WGSL = /* wgsl */`
fn thermalColor(kelvin: f32) -> vec3<f32> {
  let p = (clamp(kelvin, 800.0, 6000.0) - 800.0) / 10.0;
  let lo = min(u32(floor(p)), ${THERMAL_LUT_COUNT - 2}u);
  return mix(u.thermal_color_lut[lo].rgb, u.thermal_color_lut[lo+1u].rgb, p-f32(lo));
}
fn physicalDisplay(rgb: vec3<f32>, ev: f32, knee: f32) -> vec3<f32> {
  let exposed = rgb * exp2(ev);
  let y = dot(exposed, vec3<f32>(0.2126, 0.7152, 0.0722));
  if (y <= 0.0) { return vec3<f32>(0.0); }
  var mapped = y;
  if (y > knee) { mapped = knee + (1.0-knee)*(1.0-exp(-(y-knee)/(1.0-knee))); }
  let scaled = exposed * (mapped/y);
  var saturation = 1.0;
  for (var i = 0u; i < 3u; i++) {
    if (scaled[i] > mapped) { saturation = min(saturation, (1.0-mapped)/(scaled[i]-mapped)); }
    if (scaled[i] < mapped) { saturation = min(saturation, mapped/(mapped-scaled[i])); }
  }
  let linear = clamp(vec3<f32>(mapped) + saturation*(scaled-vec3<f32>(mapped)), vec3<f32>(0.0), vec3<f32>(1.0));
  return select(1.055*pow(linear, vec3<f32>(1.0/2.4))-vec3<f32>(0.055), linear*12.92, linear <= vec3<f32>(0.0031308));
}
`;
