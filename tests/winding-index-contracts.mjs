import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildWindingIndex } from '../winding-index-core.mjs';
import { pointInsideMesh } from '../frame-link-core.mjs';
import { parseGlbGeometry, sampleSurface } from '../cast-registration-core.mjs';

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('fast winding agrees with exact winding on the real SF3D cast', async () => {
  const bytes = await readFile(new URL(
    '../artifacts/cast-correspondence-v0/frozen/cast-sf3d-skin-baseline.glb', import.meta.url,
  ));
  const cast = parseGlbGeometry(bytes);
  const index = buildWindingIndex(cast);
  // Probe grid: bbox-spanning random points, seeded.
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cast.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], cast.positions[i + k]);
      max[k] = Math.max(max[k], cast.positions[i + k]);
    }
  }
  const rand = lcg(11);
  let disagreements = 0;
  let insideCount = 0;
  const probes = 250;
  for (let p = 0; p < probes; p += 1) {
    const point = [0, 1, 2].map(k => min[k] - 0.05 + (max[k] - min[k] + 0.1) * rand());
    const exact = pointInsideMesh(point[0], point[1], point[2], cast);
    const fast = index.inside(point[0], point[1], point[2]);
    if (exact) insideCount += 1;
    if (exact !== fast) disagreements += 1;
  }
  assert.ok(insideCount > 10, `probe set must include interior points, got ${insideCount}`);
  assert.ok(disagreements <= Math.ceil(probes * 0.02),
    `fast winding must agree with exact within 2%, got ${disagreements}/${probes}`);
});

test('fast winding is materially faster than exact on a large mesh', async () => {
  const bytes = await readFile(new URL(
    '../artifacts/cast-correspondence-v0/frozen/cast-trellis-skin-baseline.glb', import.meta.url,
  ));
  const cast = parseGlbGeometry(bytes);
  const index = buildWindingIndex(cast);
  const samples = sampleSurface(cast, 50);
  const t0 = Date.now();
  for (let i = 0; i < 50; i += 1) index.inside(samples[i * 3], samples[i * 3 + 1] + 0.01, samples[i * 3 + 2]);
  const fastMs = Date.now() - t0;
  const t1 = Date.now();
  for (let i = 0; i < 5; i += 1) pointInsideMesh(samples[i * 3], samples[i * 3 + 1] + 0.01, samples[i * 3 + 2], cast);
  const exactMs = (Date.now() - t1) * 10; // scale 5 exact queries to 50
  assert.ok(fastMs < exactMs / 5,
    `fast (${fastMs}ms/50q) must beat exact (~${exactMs}ms/50q) by >5x`);
});
