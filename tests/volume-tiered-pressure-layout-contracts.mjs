import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

const layoutEntries = source.match(/tieredPressureFluidBindGroupLayout\s*=\s*device\.createBindGroupLayout\([\s\S]*?entries:\s*\[([\s\S]*?)\n\s*\],\s*\}\);/)?.[1];
assert.ok(layoutEntries, 'tiered pressure must have a compact fluid bind-group layout');
const layoutBindings = [...layoutEntries.matchAll(/binding:\s*(\d+),\s*visibility:\s*GPUShaderStage\.COMPUTE,\s*buffer:\s*\{ type: '([^']+)' \}/g)];
assert.deepEqual(layoutBindings.map(([, binding]) => Number(binding)), [0, 1, 2, 7, 8],
  'compact fluid layout must expose only uniform, fluid source/destination, and front source/destination');
assert.equal(layoutBindings.filter(([, , type]) => type !== 'uniform').length, 4,
  'compact fluid layout contributes only four storage buffers to tiered pressure compute');
const tieredJacobiLayout = source.match(/pressureJacobiTieredPipelineLayout\s*=\s*device\.createPipelineLayout\(\{([\s\S]*?)\n\s*\}\);/)?.[1];
const tieredProjectLayout = source.match(/pressureProjectTieredPipelineLayout\s*=\s*device\.createPipelineLayout\(\{([\s\S]*?)\n\s*\}\);/)?.[1];
assert.ok(tieredJacobiLayout?.includes('tieredPressureFluidBindGroupLayout') && tieredJacobiLayout.includes('pressureJacobiBindGroupLayout'),
  'tiered pressure jacobi must use the compact layout');
assert.ok(tieredProjectLayout?.includes('tieredPressureFluidBindGroupLayout') && tieredProjectLayout.includes('pressureJacobiBindGroupLayout'),
  'tiered pressure projection must use the compact layout');
assert.ok(/tieredPressureBindGroups\[fluidIndex\]\s*=\s*device\.createBindGroup\(/.test(source),
  'each fluid ping-pong source must have a tiered-pressure bind group');
assert.ok(/pass\.setBindGroup\(0,\s*tieredPressureBindGroups\[currentFluid\]\)/.test(source),
  'tiered pressure passes must consume the compact group for the current fluid source');
assert.ok(!tieredJacobiLayout.includes('bindGroupLayouts: [bindGroupLayout,'),
  'tiered pressure must not count every unrelated storage binding against the stage limit');

console.log('tiered pressure compact layout contracts: ok');
