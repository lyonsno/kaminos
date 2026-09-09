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

// Peak shoulder / highlight desaturation adapted from Khronos PBR Neutral:
// Copyright 2024 The Khronos Group, Inc. Apache-2.0 (shoulder adaptation).
// License: LICENSES/Khronos-ToneMapping-Apache-2.0.txt. Modifications: configurable
// knee, no reflective offset, signed-input projection, JS/WGSL and sRGB encoding.
// https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/pbrNeutral.glsl
// No reflective-material black offset: our input is emitted/transported light.
// First project signed RGB toward neutral only enough to enter the nonnegative
// cone. Then compress the PEAK, allowing luminance to roll off instead of forcing
// an orange to become pastel at a prescribed display luminance. Neutralization
// grows with radiance discarded by the shoulder, not mere SDR gamut contact.
export function displayPhysicalRGB(rgb, exposureEV = 0, knee = 0.6) {
  const exposed = rgb.map(v => v * 2 ** exposureEV);
  const y = linearLuminance(exposed);
  if (y <= 0) return [0, 0, 0];
  const minimum = Math.min(...exposed);
  const saturation = minimum < 0 ? y / (y - minimum) : 1;
  let linear = exposed.map(v => Math.max(0, y + saturation * (v - y)));
  const peak = Math.max(...linear);
  if (peak > knee) {
    const d = 1 - knee;
    const mappedPeak = 1 - d * d / (peak + 1 - 2 * knee);
    const neutral = 1 - 1 / (1 + 0.15 * (peak - mappedPeak));
    linear = linear.map(v => mappedPeak * ((v / peak) * (1 - neutral) + neutral));
  }
  return linear.map(v => linearToSrgb(Math.max(0, Math.min(1, v))));
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
  let minimum = min(exposed.r, min(exposed.g, exposed.b));
  var saturation = 1.0;
  if (minimum < 0.0) { saturation = y / (y - minimum); }
  var linear = max(vec3<f32>(0.0), vec3<f32>(y) + saturation * (exposed - vec3<f32>(y)));
  let peak = max(linear.r, max(linear.g, linear.b));
  if (peak > knee) {
    let d = 1.0 - knee;
    let mappedPeak = 1.0 - d * d / (peak + 1.0 - 2.0 * knee);
    let neutral = 1.0 - 1.0 / (1.0 + 0.15 * (peak - mappedPeak));
    linear = mappedPeak * ((linear / peak) * (1.0 - neutral) + vec3<f32>(neutral));
  }
  linear = clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
  return select(1.055*pow(linear, vec3<f32>(1.0/2.4))-vec3<f32>(0.055), linear*12.92, linear <= vec3<f32>(0.0031308));
}
`;
