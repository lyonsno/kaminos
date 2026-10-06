import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLinearDispatch } from '../src/runtime-primitives.js';

const source = readFileSync(new URL('../src/sam-pixel-decoder-phase-program.js', import.meta.url), 'utf8');
const stats = source.split('const GROUPNORM_STATS_WGSL = `')[1].split('`;')[0];
assert.match(stats, /@workgroup_size\(256\)/, 'stats must cooperatively scan each group with 256 lanes');
assert.match(stats, /@builtin\(workgroup_id\)/);
assert.match(stats, /@builtin\(local_invocation_index\)/);
assert.match(stats, /wid\.x \+ wid\.y \* dispatch_grid\.x \+ wid\.z \* dispatch_grid\.x \* dispatch_grid\.y/);
assert.match(stats, /var<workgroup> partial: array<f32, 256>/);
assert.equal((stats.match(/for \(var i = lane; i < count; i = i \+ 256u\)/g) || []).length, 2, 'both centered passes must be strided');
assert.equal((stats.match(/partial\[lane\] = partial\[lane\] \+ partial\[lane \+ stride\]/g) || []).length, 2);
assert.match(stats.replace(/\/\/[^\n]*/g, ''), /let mean = partial\[0\] \/ f32\(count\);\s+workgroupBarrier\(\);/, 'all lanes must read mean before scratch reuse');
assert.match(stats, /input_values\[batch_base \+ i \* dims.groups \+ group\] - mean/);
assert.match(stats, /if \(lane == 0u\)/);
assert.match(stats, /stats\[index \* 2u \+ 1u\] = partial\[0\] \/ f32\(count\)/);
assert.match(source, /dispatch: createLinearDispatch\(shape.batch \* shape.groups, \{\s+workgroupSize: 1,/);
assert.match(source, /inverseSqrt\(variance \+ 0\.00001\)/);

// This is an algorithm/indexing witness, not execution of WGSL or GPU parity.
const lanes = 256;
const f = Math.fround;
function reduce(partial) {
  for (let stride = lanes / 2; stride; stride >>= 1) {
    for (let lane = 0; lane < stride; lane++) partial[lane] = f(partial[lane] + partial[lane + stride]);
  }
  return partial[0];
}
for (const count of [1, 7, 255, 256, 257, 1025]) {
  const batch = 3, groups = 4, perBatch = count * groups;
  const values = Float32Array.from({ length: batch * perBatch }, (_, i) => 4096 + (i % 29) / 8);
  const visits = new Uint8Array(values.length);
  for (let index = 0; index < batch * groups; index++) {
    const base = Math.floor(index / groups) * perBatch, group = index % groups;
    const partial = new Float32Array(lanes);
    let serial = 0;
    for (let i = 0; i < count; i++) serial += values[base + i * groups + group];
    for (let lane = 0; lane < lanes; lane++) {
      let reads = 0;
      for (let i = lane; i < count; i += lanes) {
        const offset = base + i * groups + group;
        visits[offset]++;
        partial[lane] = f(partial[lane] + values[offset]);
        reads++;
      }
      assert.ok(reads <= Math.ceil(count / lanes));
    }
    const mean = f(reduce(partial) / count);
    partial.fill(0);
    let variance = 0;
    for (let i = 0; i < count; i++) variance += (values[base + i * groups + group] - serial / count) ** 2;
    for (let lane = 0; lane < lanes; lane++) {
      for (let i = lane; i < count; i += lanes) {
        const delta = f(values[base + i * groups + group] - mean);
        partial[lane] = f(partial[lane] + f(delta * delta));
      }
    }
    assert.ok(Math.abs(mean - serial / count) < 0.001, `count=${count} group=${index}: mean error ${mean - serial / count}`);
    assert.ok(Math.abs(f(reduce(partial) / count) - variance / count) < 0.00001, `count=${count} group=${index}: variance error ${f(partial[0] / count) - variance / count}`);
  }
  assert.ok(visits.every(n => n === 1), 'every interleaved input belongs to exactly one batch/group/lane');
}
for (const total of [1, 8, 24, 63]) {
  const grid = createLinearDispatch(total, { workgroupSize: 1, maxWorkgroupsPerDimension: 8 });
  const seen = [];
  for (let y = 0; y < (grid[1] || 1); y++) for (let x = 0; x < grid[0]; x++) {
    const index = x + y * grid[0];
    if (index < total) seen.push(index);
  }
  assert.deepEqual(seen, Array.from({ length: total }, (_, i) => i));
}
console.log('sam groupnorm parallel contracts passed (CPU algorithm and source/dispatch only)');
