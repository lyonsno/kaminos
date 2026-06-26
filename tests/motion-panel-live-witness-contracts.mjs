import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.motion-panel-live-witness\.v0/, 'live witness writes a stable report schema');
assert.match(witness, /kaminos\.motion-panel-live-filmstrip\.v0/, 'live witness writes a stable filmstrip schema');
assert.match(witness, /window\.generateMotion\(\)/, 'live witness exercises the real motion panel Generate Motion path');
assert.match(witness, /--prompt/, 'live witness exposes prompt as an invocation input');
assert.match(witness, /--frames/, 'live witness exposes frame count as an invocation input');
assert.match(witness, /--interval-ms/, 'live witness exposes capture interval as an invocation input');
assert.match(witness, /--tile-width/, 'live witness exposes filmstrip tile width as an invocation input');
assert.match(witness, /--columns/, 'live witness exposes filmstrip grid columns as an invocation input');
assert.match(witness, /Page\.captureScreenshot/, 'live witness captures the operator-facing browser viewport');
assert.match(witness, /writeReport\(\{\s*ok: false/s, 'live witness writes a durable failure report');
assert.doesNotMatch(witness, /Math\.min\([^)]*frameCount/, 'live witness must not silently cap requested frame count');
