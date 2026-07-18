import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witness = readFileSync(join(root, 'hand-state-runtime-witness.mjs'), 'utf8');

assert.match(witness, /requestedUrl/, 'witness records requested route');
assert.match(witness, /effectiveUrl/, 'witness records effective route');
assert.match(witness, /fixtureMode/, 'witness records fixture authority');
assert.match(witness, /primary_output_written/, 'witness reports output production');
assert.match(witness, /meshVisible/, 'witness requires a visible mesh');
assert.match(witness, /vertexCount/, 'witness records surface vertices');
assert.match(witness, /__kaminosHandStateInitFingerJuice/, 'witness initializes the production finger-fluid backend');
assert.match(witness, /webgpu_compute/, 'witness rejects a substituted finger-fluid solver');
assert.match(witness, /webgpu_direct_render/, 'witness rejects a substituted finger-fluid renderer');
assert.match(witness, /fixture-emitter-capacity-probe/, 'witness exercises zero-to-five live emitter buffer growth');
assert.match(witness, /emitterCount !== 5/, 'witness rejects partial emitter buffer growth');
assert.match(witness, /consoleEvents/, 'witness records browser errors');

console.log('hand-state runtime witness contracts passed');
