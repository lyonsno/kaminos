import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const script = new URL('../volume-layer-coefficient-comparison-gallery.py', import.meta.url);
assert.ok(existsSync(script), 'coefficient comparison gallery generator exists');

const source = await readFile(script, 'utf8');
assert.match(source, /kaminos\.volume\.layer-coefficient-comparison-gallery\.v0/, 'gallery pins its report schema');
assert.match(source, /exact-local-layer-emission-extinction-v0/, 'gallery pins exact coefficient authority');
assert.match(source, /learned-post-admission-coefficient-prediction-v0/, 'gallery pins learned coefficient authority');
assert.match(source, /external-native-cell-index-list-v0/, 'gallery pins admission authority');
assert.match(source, /camera-depth-96-bin-one-running-transmittance-v0/, 'gallery surfaces the active order approximation');
assert.match(source, /flow-vs-baseline-absolute-delta-8x/, 'gallery exposes an amplified causal delta without presenting it as beauty output');
assert.match(source, /hashMatch/, 'gallery rejects mismatched frozen-state sources');
assert.match(source, /coefficientSourceAuthority/, 'gallery validates exact, baseline, and flow authority labels');
assert.match(source, /left:.*selected.*right: raymarch shared-transmittance target/, 'gallery labels the actual split orientation');

const python = process.env.KAMINOS_MLX_PYTHON || '/private/tmp/kaminos-mlx-residual-venv/bin/python';
const selfTest = spawnSync(python, [script.pathname, '--self-test'], { encoding: 'utf8' });
assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
assert.match(selfTest.stdout, /coefficient comparison gallery self-test passed/);

console.log('volume layer coefficient comparison gallery contracts passed');
