import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

const shaderSource = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shaderFunctions = source => new Map(
  [...source.matchAll(/^fn ([A-Za-z_][A-Za-z0-9_]*)\b[\s\S]*?^\}/gm)]
    .map(match => [match[1], match[0]]),
);
const functions = shaderFunctions(shaderSource);
const shaderFunction = name => {
  const source = functions.get(name);
  assert.ok(source, `shader function ${name} exists`);
  return source;
};
const lambda = shaderFunction('compute_density_lambda');
const delta = shaderFunction('solve_position_delta');
function assertDensityProjectionScope(source) {
  const callers = [];
  for (const [name, block] of shaderFunctions(source)) {
    const body = block.slice(block.indexOf('\n') + 1);
    if (/\bdensity_pair_kernel_(?:weight|gradient)\s*\(/.test(body)) callers.push(name);
  }
  assert.deepEqual(callers.sort(), ['compute_density_lambda', 'solve_position_delta'],
    'the specialized helpers are called only by density projection');
}

assert.match(shaderSource, /uniformVolumeDensityKernel = false/, 'direct API keeps specialization separately opt-in');
assert.match(shaderSource, /uniformVolumeDensityKernel !== 'boolean'/, 'direct API rejects truthy nonboolean requests');
assert.match(shaderSource, /const safeUniformVolumeDensityKernel = uniformVolumeDensityKernel === true && !safeAdaptiveDensity;/, 'adaptive particles bypass a uniform-volume specialization');
assert.match(shaderSource, /densityControl: vec4<f32>/, 'uniform density constants have an explicit GPU parameter block');
assert.match(shaderSource, /const buffer = new ArrayBuffer\(224\)/, 'CPU upload matches the extended WGSL parameter layout');
assert.match(shaderSource, /view\.setFloat32\(208, safeUniformParticleVolumeScale, true\)/, 'the active uniform volume scale reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(212, safeUniformParticleRadiusScale, true\)/, 'the shared support radius scale reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(216, safeUniformVolumeKernelNormalization, true\)/, 'the shared kernel normalization reaches the shader');
assert.match(shaderSource, /view\.setFloat32\(220, safeUniformVolumeDensityKernel \? 1 : 0, true\)/, 'the effective specialization switch reaches the shader');
assert.match(shaderSource, /fn density_pair_kernel_weight\(index: u32, neighborIndex: u32, distance: f32\)/, 'density has a specialized weight path');
assert.match(shaderSource, /fn density_pair_kernel_gradient\(index: u32, neighborIndex: u32, offset: vec3<f32>\)/, 'density has a specialized gradient path');
assert.match(lambda, /density_pair_kernel_weight\(index, neighborIndex, distance\)[\s\S]*density_pair_kernel_gradient\(index, neighborIndex, offset\)/, 'lambda uses the specialized helpers');
assert.match(delta, /density_pair_kernel_weight\(index, index,[\s\S]*density_pair_kernel_gradient\(index, neighborIndex, offset\)/, 'position correction and tensile reference use the specialized helpers');
assertDensityProjectionScope(shaderSource);
const viscosity = shaderFunction('compute_velocity_viscosity');
const mutatedViscosity = viscosity.replace('adaptive_pair_kernel_weight', 'density_pair_kernel_weight');
assert.notEqual(mutatedViscosity, viscosity, 'the viscosity consumer mutation witness matches live shader source');
assert.throws(
  () => assertDensityProjectionScope(shaderSource.replace(viscosity, mutatedViscosity)),
  /specialized helpers are called only by density projection/,
  'the scope contract rejects moving the specialization into the actual viscosity consumer',
);
assert.ok(browserSource.includes("params.get('finger_fluid_uniform_volume_density_kernel')"), 'the browser URL has an independent comparison switch');
assert.ok(browserSource.includes('uniformVolumeDensityKernel: fingerFluidBenchConfig.effectiveUniformVolumeDensityKernel'), 'the browser forwards the effective switch');
assert.ok(browserSource.includes('effectiveUniformVolumeDensityKernel: requestedUniformVolumeDensityKernel && !requestedAdaptiveDensity'), 'the browser reports adaptive bypass truthfully');

await assert.rejects(
  createWebGPUFingerFluidSolver({ uniformVolumeDensityKernel: 1 }),
  /uniform volume density kernel must be a boolean/,
  'the solver rejects a silently coerced API value',
);
console.log('Finger Fluid uniform-volume density kernel contracts passed');
