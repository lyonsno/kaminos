// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {compareView, aggregate, stats, viewDirections} from '../lod-image-compare.mjs';

// A res x res pair of buffers; `pixels` maps index -> {depth, normal:[x,y,z], rgb:[r,g,b]}.
const frame = (res, pixels) => {
  const g = new Float32Array(res * res * 4), a = new Float32Array(res * res * 3);
  for (const [p, {depth, normal = [0, 0, 1], rgb = [0.5, 0.5, 0.5]}] of Object.entries(pixels)) {
    g[p * 4] = depth; for (let k = 0; k < 3; k++) { g[p * 4 + 1 + k] = normal[k] * 0.5 + 0.5; a[p * 3 + k] = rgb[k]; }
  }
  return {g, a};
};
const surface = (ps, extra = {}) => Object.fromEntries(ps.map(p => [p, {depth: 5, ...extra}]));

test('a level identical to its reference shows no error on any channel', () => {
  const f = frame(4, surface([0, 1, 5, 6]));
  const {view} = compareView({reference: f, level: f, res: 4, diagonal: 2});
  assert.equal(view.referenceCoverage, 4 / 16);
  assert.equal(view.silhouetteMismatch, 0); assert.equal(view.differentSurface, 0);
  assert.equal(view.depth.max, 0); assert.equal(view.normalDegrees.max, 0); assert.equal(view.albedo.max, 0);
  assert.equal(view.normalDegrees.count, 4);
});

test('silhouette mismatch is pixels covered by one only over pixels covered by either', () => {
  const {view} = compareView({reference: frame(4, surface([0, 1, 2, 3])), level: frame(4, surface([0, 1, 7])), res: 4, diagonal: 2});
  assert.equal(view.silhouetteMismatch, 3 / 5);
  assert.equal(view.depth.count, 2);
});

test('a pixel showing another surface counts as such and stays out of normal and albedo', () => {
  const ref = frame(2, {0: {depth: 5}, 1: {depth: 5, rgb: [1, 1, 1]}});
  const lvl = frame(2, {0: {depth: 5.01}, 1: {depth: 6, normal: [1, 0, 0], rgb: [0, 0, 0]}});
  const {view, maps} = compareView({reference: ref, level: lvl, res: 2, diagonal: 10, sameSurface: 0.01, maps: true});
  assert.equal(view.differentSurface, 1 / 2);
  assert.equal(view.depth.max, 0.1);
  assert.equal(view.normalDegrees.count, 1); assert.equal(view.normalDegrees.max, 0);
  assert.equal(view.albedo.max, 0);
  assert.ok(Number.isNaN(maps.normal[1])); assert.equal(maps.coverage[0], 1);
});

test('normals compare by direction over 0-180 degrees: reversed is 180, perpendicular 90', () => {
  const ref = frame(2, {0: {depth: 5}, 1: {depth: 5}});
  const lvl = frame(2, {0: {depth: 5, normal: [0, 0, -1]}, 1: {depth: 5, normal: [0, 1, 0]}});
  const {view} = compareView({reference: ref, level: lvl, res: 2, diagonal: 1});
  assert.ok(view.normalDegrees.max > 179.99, `${view.normalDegrees.max}`);
  assert.ok(Math.abs(view.normalDegrees.mean - 135) < 0.01);
});

test('review M1: two forward-facing normals 160 degrees apart report 160, not 20', () => {
  const t = 80 * Math.PI / 180, ref = frame(1, {0: {depth: 5, normal: [Math.sin(t), 0, Math.cos(t)]}}), lvl = frame(1, {0: {depth: 5, normal: [-Math.sin(t), 0, Math.cos(t)]}});
  const {view} = compareView({reference: ref, level: lvl, res: 1, diagonal: 1});
  assert.ok(Math.abs(view.normalDegrees.max - 160) < 0.01, `${view.normalDegrees.max}`);
});

test('a pixel with no usable normal (NaN or zero) is left out of the normal channel and counted per side', () => {
  const ref = frame(2, {0: {depth: 5}, 1: {depth: 5, normal: [NaN, NaN, NaN]}, 2: {depth: 5}});
  const lvl = frame(2, {0: {depth: 5, normal: [0, 1, 0]}, 1: {depth: 5}, 2: {depth: 5, normal: [0, 0, 0]}});
  const {view} = compareView({reference: ref, level: lvl, res: 2, diagonal: 1});
  assert.equal(view.normalDegrees.count, 1); assert.ok(Number.isFinite(view.normalDegrees.mean));
  assert.deepEqual(view.normalUndefined, {reference: 1, level: 1});
  assert.equal(view.albedo.count, 3, 'albedo still compares where the surface matches');
});

test('albedo error is mean absolute channel difference; mean colours are reported apart', () => {
  const {view} = compareView({reference: frame(1, {0: {depth: 1, rgb: [0.2, 0.4, 0.6]}}), level: frame(1, {0: {depth: 1, rgb: [0.5, 0.4, 0.3]}}), res: 1, diagonal: 1});
  assert.ok(Math.abs(view.albedo.max - 0.2) < 1e-6);
  assert.deepEqual(view.meanAlbedo.reference.map(v => +v.toFixed(3)), [0.2, 0.4, 0.6]);
  assert.deepEqual(view.meanAlbedo.level.map(v => +v.toFixed(3)), [0.5, 0.4, 0.3]);
});

test('mismatched buffers and a non-positive diagonal are refused', () => {
  const f = frame(2, {});
  assert.throws(() => compareView({reference: f, level: frame(3, {}), res: 2, diagonal: 1}), /resolution/);
  assert.throws(() => compareView({reference: f, level: f, res: 2, diagonal: 0}), /diagonal/);
});

test('p95 is the nearest-rank 95th percentile', () => {
  assert.equal(stats(Array.from({length: 20}, (_, i) => i + 1)).p95, 19);
  assert.equal(stats([7]).p95, 7);
  assert.deepEqual(stats([]), {max: 0, p95: 0, mean: 0, count: 0});
});

test('26 distinct unit view directions; aggregate keeps one entry per channel', () => {
  const dirs = viewDirections();
  assert.equal(dirs.length, 26);
  assert.equal(new Set(dirs.map(d => d.map(v => v.toFixed(3)).join())).size, 26);
  for (const d of dirs) assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
  const {view} = compareView({reference: frame(2, surface([0])), level: frame(2, surface([0, 1])), res: 2, diagonal: 1});
  const agg = aggregate([view, view]);
  assert.deepEqual(Object.keys(agg), ['silhouetteMismatch', 'differentSurface', 'depthP95', 'normalP95Degrees', 'normalMeanDegrees', 'albedoP95']);
  assert.equal(agg.silhouetteMismatch.mean, 0.5);
});
