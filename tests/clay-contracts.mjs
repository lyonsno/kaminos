import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="clay"/, 'sidebar exposes a Clay tab');
assert.match(index, /id="tab-clay"/, 'Clay tab content is present');
assert.match(index, /kaminos_clay_sim=1/, 'URL route gate names the clay sim prototype');
assert.match(index, /clay-core\.js/, 'index imports the clay prototype module');
assert.match(index, /initKaminosClayRoute/, 'index initializes the clay route explicitly');
assert.match(index, /__kaminosClayPrototype/, 'clay route exposes a witness/debug prototype handle');
assert.match(index, /clay_fixture_hand/, 'clay route exposes a deterministic hand-collider fixture');

const corePath = join(root, 'clay-core.js');
assert.ok(existsSync(corePath), 'clay-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';
assert.match(core, /export function createKaminosClayPrototype/, 'clay module exports createKaminosClayPrototype');
assert.match(core, /navigator\.gpu/, 'clay module requires WebGPU instead of CPU runtime fallback');
assert.match(core, /runtimeCpuFallback:\s*false/, 'clay debug state refuses CPU runtime fallback');
assert.match(core, /webgpu-clay-surface-lattice-scaffold-v0/, 'clay solver identity is stable');
assert.match(core, /kaolin-kpm-001-forward-distance-feature-codes/, 'clay scaffold records shared primitive source contract');
assert.match(core, /pointTriangleDistanceWgsl|point_triangle_distance_main/, 'clay scaffold points at the shared primitive WGSL contract');
assert.match(core, /clayColliderCount/, 'clay debug state records collider count');
assert.match(core, /clayDeformationCount/, 'clay debug state records deformation count');
assert.match(core, /clayContactCount/, 'clay debug state records contact count');
assert.doesNotMatch(core, /fireLike|flame|smoke/i, 'clay core must not reuse fire/smoke visual language');

const witnessPath = join(root, 'clay-witness.mjs');
assert.ok(existsSync(witnessPath), 'clay-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_clay_sim=1/, 'clay witness targets the clay route');
assert.match(witness, /__kaminosClayPrototype/, 'clay witness reads clay debug state');
assert.match(witness, /effectiveBackend/, 'clay witness records effective backend');
assert.match(witness, /WebGPU/, 'clay witness requires WebGPU evidence');
assert.match(witness, /runtimeCpuFallback/, 'clay witness records CPU fallback absence');
assert.match(witness, /clayDeformationCount/, 'clay witness requires deformation count');
assert.match(witness, /clayContactCount/, 'clay witness requires contact count');
assert.match(witness, /clayColorPixels/, 'clay witness performs a clay-color pixel sanity check');
assert.match(witness, /not fire/i, 'clay witness fails if output is only fire/smoke-like');
