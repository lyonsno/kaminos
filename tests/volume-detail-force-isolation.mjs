import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Fail first on the missing production connection, not a missing test import.
assert.match(core, /uniforms\.set\(detailForceIsolationMask\(controlsSnapshot\.detailForceIsolation\), 348\)/,
  'the force-only selector must reach the live uniform upload');
const { detailForceIsolationMask, detailForceIsolationReceipt } = await import('../volume-detail-force-isolation.mjs');
assert.deepEqual(detailForceIsolationMask(), [1, 1, 1, 1]);
const terms = ['detail', 'micro', 'shred', 'fine'];
for (const [i, term] of terms.entries()) {
  assert.deepEqual(detailForceIsolationMask(`without-${term}`), terms.map((_, j) => +(i !== j)));
  assert.deepEqual(detailForceIsolationMask(`only-${term}`), terms.map((_, j) => +(i === j)));
  assert.deepEqual(detailForceIsolationReceipt({ detailForceIsolation: `only-${term}`, proceduralDetailForces: false }).effectiveMask, [0, 0, 0, 0]);
}
assert.throws(() => detailForceIsolationMask('not-a-mode'), /Unknown detail force isolation/);
assert.deepEqual(detailForceIsolationReceipt({ volumeScene: 'tall_plume' }).effectiveMask, [0, 1, 1, 1]);
assert.deepEqual(detailForceIsolationReceipt({ volumeScene: 'bonfire', bonfireDetailForces: 0 }).effectiveMask, [0, 0, 0, 0]);
assert.deepEqual(detailForceIsolationReceipt({ volumeScene: 'bonfire', bonfireDetailForces: 0.5 }).effectiveMask, [0.5, 0.5, 0.5, 0.5]);
assert.match(core, /detail_force_isolation: vec4<f32>/);
for (const [i, force] of ['detailForce', 'microForce', 'shredForce', 'fineBreakup'].entries()) {
  assert.match(core, new RegExp(`${force} = vec3<f32>\\([^;]+\\) \\* bonfireDetailForcesAblation \\* u\\.detail_force_isolation\\.${'xyzw'[i]};`));
}
assert.match(core, /detailForceIsolation: state\.detailForceIsolation/);
assert.match(index, /id="detail-force-isolation"/);
assert.match(index, /detailForceIsolation: document\.getElementById\('detail-force-isolation'\)\.value/);
assert.match(index, /getElementById\('detail-force-isolation'\)\.addEventListener\('change', syncControls\)/);
assert.doesNotMatch(index, /\['detailForceIsolation', 'volume_/,
  'session diagnostics must not silently become saved basin parameters');
console.log('detail force isolation: default preservation, component routing and effective masks pass');
