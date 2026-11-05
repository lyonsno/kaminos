// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OPTICAL_STEPPING_WGSL } from '../volume-optical-native.mjs';
import { evalWgslBatch, extractWgslFunction, withKaminosGpu } from '../tools/shader-herder.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const preamble = `
struct ImmersedUniform {
  immersed_source_a: vec4<f32>,
  immersed_source_b: vec4<f32>,
  immersed_source_c: vec4<f32>,
};
var<private> u: ImmersedUniform;
${extractWgslFunction(core, 'immersedDirection')}
${extractWgslFunction(core, 'immersedSourceWeight')}
`;

test('production immersed source has full centre weight, antialiased slab edge and zero outside support', async () => {
  const options = {
    preamble,
    argTypes: ['f32'],
    returnType: 'f32',
    body: `
      u.immersed_source_a = vec4<f32>(1.0, 0.0, 0.0, 0.0);
      u.immersed_source_b = vec4<f32>(0.0, 1.0, 0.0, 10.0);
      u.immersed_source_c = vec4<f32>(1.5, 0.0, 0.0, 0.0);
      return immersedSourceWeight(vec3<f32>(0.0, arg0, 0.0));
    `,
    inputs: [[0], [0.5], [1.25]],
  };
  await withKaminosGpu(async (ctx) => {
    assert.deepEqual(await evalWgslBatch(ctx, options), [1, 0.84375, 0]);
    // Negative control: collapse the slab thickness in the extracted production code.
    const broken = preamble.replace(
      'let halfThickness = 0.5 * u.immersed_source_c.x;',
      'let halfThickness = 0.0;');
    assert.notEqual(broken, preamble);
    assert.notDeepEqual(await evalWgslBatch(ctx, { ...options, preamble: broken }), [1, 0.84375, 0]);
  }, { wgslSources: [{ label: 'production-immersed-source',
    code: `${preamble}\n@compute @workgroup_size(1) fn main() { _ = immersedSourceWeight(vec3<f32>(0.0)); }`,
    entryPoint: 'main' }] });
});

test('production optical composition preserves emitted radiance and multiplies transmittance', async () => {
  await withKaminosGpu(async (ctx) => {
    const result = await evalWgslBatch(ctx, {
      preamble: OPTICAL_STEPPING_WGSL,
      argTypes: ['f32', 'f32'],
      returnType: 'vec4<f32>',
      body: 'return opticalCompose(vec4<f32>(1.0, 2.0, 3.0, arg0), vec4<f32>(4.0, 5.0, 6.0, arg1));',
      inputs: [[0.5, 0.25], [0, 0.25]],
    });
    assert.deepEqual(result, [[3, 4.5, 6, 0.125], [1, 2, 3, 0]]);
  }, { wgslSources: [{ label: 'production-optical-composition',
    code: `${OPTICAL_STEPPING_WGSL}\n@compute @workgroup_size(1) fn main() { _ = opticalCompose(vec4<f32>(0.0), vec4<f32>(0.0)); }`,
    entryPoint: 'main' }] });
});
