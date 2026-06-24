import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'video-filmstrip.mjs');

assert.ok(existsSync(witnessPath), 'video-filmstrip.mjs must provide reusable generated-video filmstrip evidence');

const witness = readFileSync(witnessPath, 'utf8');

assert.match(witness, /--input/, 'filmstrip witness accepts an explicit input path');
assert.match(witness, /--out/, 'filmstrip witness accepts a caller-owned output path');
assert.match(witness, /--report/, 'filmstrip witness writes a caller-owned report path');
assert.match(witness, /--columns/, 'filmstrip witness can render an inspectable grid instead of an over-wide single row');
assert.match(witness, /--crop/, 'filmstrip witness can crop whitespace-heavy model preview renders');
assert.match(witness, /ffprobe/, 'filmstrip witness inspects media through ffprobe');
assert.match(witness, /ffmpeg/, 'filmstrip witness renders media through ffmpeg');
assert.match(witness, /requestedInput/, 'filmstrip report records requested input identity');
assert.match(witness, /effectiveInput/, 'filmstrip report records effective input identity');
assert.match(witness, /inputSha256/, 'filmstrip report records input content identity');
assert.match(witness, /selectedTimes/, 'filmstrip report records sampled timeline positions');
assert.match(witness, /tileColumns/, 'filmstrip report records effective tile columns');
assert.match(witness, /tileRows/, 'filmstrip report records effective tile rows');
assert.match(witness, /cropFilter/, 'filmstrip report records the effective crop filter');
assert.match(witness, /pngMagic/, 'filmstrip witness validates output PNG magic');
assert.match(witness, /phase/, 'filmstrip report records failure phase');
assert.match(witness, /ok:\s*false/, 'filmstrip witness writes an explicit failure report');
assert.match(witness, /ok:\s*true/, 'filmstrip witness writes an explicit success report');
