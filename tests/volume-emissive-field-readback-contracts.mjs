import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');

const allocation = transport.split('export function createEmissiveLightField')[1]?.split('\n}\n')[0] ?? '';
const fieldReadback = core.split('async function sampleEmissiveLightField()')[1]?.split('\n  async function ')[0] ?? '';

assert.match(allocation, /const allocate =[^\n]*GPUBufferUsage\.STORAGE \| GPUBufferUsage\.COPY_SRC/);
assert.match(allocation, /const coefficients = allocate\(/);
assert.match(allocation, /const directions = allocate\(/);
assert.match(allocation, /const incident = allocate\(/);
assert.match(allocation, /return \{\s*coefficients,\s*directions,\s*incident,/);
assert.match(fieldReadback, /emissiveLightField\.encode\(encoder,\s*currentFluid\)/, 'readback must solve the held current field before copying');
assert.match(fieldReadback, /\['coefficients', emissiveLightField\.coefficients, bytes\]/);
assert.match(fieldReadback, /\['directions', emissiveLightField\.directions, bytes \* EMISSIVE_LIGHT_DIRECTION_COUNT\]/);
assert.match(fieldReadback, /\['incident', emissiveLightField\.incident, bytes\]/);
assert.match(fieldReadback, /fields\.forEach\(\(\[, source\], index\) => encoder\.copyBufferToBuffer\(source/);
assert.doesNotMatch(fieldReadback, /updateUniforms\(/, 'diagnostic must retain the render frame uniforms');
assert.match(fieldReadback, /grid:\s*EMISSIVE_LIGHT_GRID/);
assert.match(fieldReadback, /directions:\s*EMISSIVE_LIGHT_DIRECTION_COUNT/);
assert.match(fieldReadback, /Float32Array/);
assert.doesNotMatch(fieldReadback, /slice\(0,\s*(?:[0-9]+|EMISSIVE_LIGHT_GRID)/, 'readback must not silently truncate the diagnostic fields');
assert.match(core, /sampleEmissiveLightField,/);
assert.match(witness, /core\.sampleEmissiveLightField\(\)/);
assert.match(witness, /field\s*:\s*field\s*\?/);
assert.match(witness, /writeFileSync\(join\(out, `\$\{arm\.id\}\.\$\{name\}\.f32`/);
assert.match(witness, /expectedFieldBytes/);

console.log('emissive field readback: complete same-state source, directional, and resolved fields are retained');
