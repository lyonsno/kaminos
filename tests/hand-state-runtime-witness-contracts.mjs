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
assert.match(witness, /consoleEvents/, 'witness records browser errors');

console.log('hand-state runtime witness contracts passed');
