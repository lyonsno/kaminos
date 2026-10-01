import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const browser = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functions = text => new Map([...text.matchAll(/^fn (\w+)\b[\s\S]*?^\}/gm)]
  .map(match => [match[1], match[0]]));
const shader = functions(source);
assert.ok(shader.has('interface_pair_kernel_weight'), 'interface extraction needs its independently selected pair kernel');
assert.match(source, /uniformVolumeInterfaceKernel = false/, 'ordinary callers retain their existing route');
assert.match(source, /safeUniformVolumeInterfaceKernel = uniformVolumeInterfaceKernel === true && !safeAdaptiveDensity;/,
  'variable particle volumes must bypass specialization independently of density selection');
assert.match(source, /\.replace\(KAMINOS_FINGER_FLUID_UNIFORM_INTERFACE_KERNEL_TOKEN, String\(safeUniformVolumeInterfaceKernel\)\)/,
  'the effective interface selection reaches the actual compiled shader');

function assertInterfaceScope(text) {
  const callers = [...functions(text)].filter(([, fn]) =>
    /\binterface_pair_kernel_weight\s*\(/.test(fn.slice(fn.indexOf('\n') + 1))).map(([name]) => name);
  assert.deepEqual(callers.sort(), ['compact_interface_records', 'estimate_interface_curvature'],
    'interface specialization must not change motion-bearing consumers');
}
assertInterfaceScope(source);
const viscosity = shader.get('compute_velocity_viscosity');
assert.throws(() => assertInterfaceScope(source.replace(viscosity,
  viscosity.replace('adaptive_pair_kernel_weight', 'interface_pair_kernel_weight'))),
/must not change motion-bearing consumers/);

// Evaluate the actual scalar WGSL helper body as JavaScript. This checks its
// selection and algebra, not shader compilation or GPU f32/pow conformance.
const body = shader.get('interface_pair_kernel_weight').split('\n').slice(1, -1).join('\n');
const evaluate = new Function('params', 'uniformInterfaceKernel', 'adaptive_pair_kernel_weight',
  'max', 'index', 'neighborIndex', 'distance', body);
const f32 = Math.fround;
let cases = 0;
for (const volume of [1, 1.5, 2, 8]) {
  const radius = f32(Math.cbrt(f32(volume)));
  const normalization = f32(1 / f32(f32(radius * radius) * radius));
  const params = { fluid: { x: f32(0.185) }, densityControl: { x: f32(volume), y: radius, z: normalization, w: 0 } };
  const support = params.fluid.x * radius;
  for (const ratio of [0, 0.01, 0.2, 0.75, 0.99999, 1, 1.00001, 2]) {
    const distance = support * ratio;
    const actual = evaluate(params, true, () => { throw new Error('unexpected adaptive volume read'); }, Math.max, 3, 7, distance);
    const expected = ratio >= 1 ? 0 : volume * normalization * (1 - (distance / support) ** 2) ** 3;
    assert.ok(Math.abs(actual - expected) <= 1e-12, `volume ${volume}, distance ratio ${ratio}`);
    assert.equal(evaluate(params, false, (i, j, d) => {
      assert.deepEqual([i, j, d], [3, 7, distance]);
      return 0.123;
    }, Math.max, 3, 7, distance), 0.123, 'disabled/adaptive route retains the original pair helper');
    cases += 1;
  }
}

const queryBlock = browser.match(/const requestedUniformVolumeInterfaceKernelValue[\s\S]*?const requestedUniformVolumeInterfaceKernel =[^;]+;/)?.[0];
assert.ok(queryBlock, 'the comparison URL needs an independently validated switch');
const query = new Function('params', `${queryBlock}\nreturn requestedUniformVolumeInterfaceKernel;`);
for (const value of [null, '0', '1']) {
  const params = new URLSearchParams();
  if (value !== null) params.set('finger_fluid_uniform_volume_interface_kernel', value);
  assert.equal(query(params), value === '1');
}
for (const value of ['true', '2', '']) {
  assert.throws(() => query(new URLSearchParams({ finger_fluid_uniform_volume_interface_kernel: value })), /must be 0 or 1/);
}
assert.ok(browser.includes('effectiveUniformVolumeInterfaceKernel: requestedUniformVolumeInterfaceKernel && !requestedAdaptiveDensity'));
assert.ok(browser.includes('uniformVolumeInterfaceKernel: fingerFluidBenchConfig.effectiveUniformVolumeInterfaceKernel'));
assert.ok(browser.includes('gpuState.effectiveUniformVolumeInterfaceKernel = gpuState.uniformVolumeInterfaceKernel'));
assert.ok(source.includes('requestedUniformVolumeInterfaceKernel: uniformVolumeInterfaceKernel'));
assert.ok(source.includes('uniformVolumeInterfaceKernel: safeUniformVolumeInterfaceKernel'));
assert.ok(source.includes('uniformVolumeInterfaceKernelBypassReason: uniformVolumeInterfaceKernel && safeAdaptiveDensity'));
await assert.rejects(createWebGPUFingerFluidSolver({ uniformVolumeInterfaceKernel: 1 }), /uniform volume interface kernel must be a boolean/);
console.log(`Uniform interface kernel contracts passed (${cases} scalar cases; GPU conformance remains separate)`);
