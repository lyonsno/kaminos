import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'orb-shell-composition-seed-sweep.mjs'), 'utf8');

assert.match(source, /OrbShellSeedSweepWitness/, 'seed sweep witness must name its report schema');
assert.match(source, /contactSheet/, 'seed sweep witness must write a contact sheet path');
assert.match(source, /orb_shell_variation_seed/, 'seed sweep witness must route each capture through explicit variation seed URL params');
assert.match(source, /apertureTangencyVerdictCounts/, 'seed sweep witness must aggregate tangency verdict counts per seed');
assert.match(source, /effectiveUrl/, 'seed sweep witness must preserve effective URL identity from child witnesses');
assert.match(source, /seedResults/, 'seed sweep witness must report per-seed results');
assert.match(source, /captureContactSheet/, 'seed sweep witness must compose an inspectable PNG contact sheet');
assert.match(source, /witnessCommand/, 'seed sweep witness must record the child witness command for replay');
