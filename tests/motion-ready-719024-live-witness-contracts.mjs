import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../motion-ready-719024-live-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.motion-ready-719024-live-witness\.v0/, 'witness writes a stable report schema');
assert.match(witness, /writeReport\(\{\s*ok: false/s, 'witness writes a durable report when it fails before primary output');
assert.match(witness, /--expected-cast-id/, 'witness exposes expected cast identity for false-closure probes');
assert.match(witness, /--expected-cast-hash/, 'witness exposes expected cast hash for false-closure probes');
assert.match(witness, /--expected-hill-source/, 'witness exposes expected Hill source identity for false-closure probes');
assert.match(witness, /requestedIdentity/, 'witness records requested identity');
assert.match(witness, /effectiveIdentity/, 'witness records effective identity');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the operator-facing viewport');
assert.match(witness, /lead-in/, 'witness samples the lead-in phase');
assert.match(witness, /travel/, 'witness samples the travel phase');
assert.match(witness, /settle/, 'witness samples the settle phase');
assert.match(witness, /consoleFailures/, 'witness rejects browser console failures');
assert.match(witness, /filmstrip\.png/, 'witness emits a named filmstrip artifact');
assert.doesNotMatch(witness, /Math\.min\([^)]*frameCount/, 'witness must not silently cap requested frames');

console.log('motion-ready-719024 live witness contracts passed');
