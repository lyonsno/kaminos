import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import * as patches from '../scripts/webphysics-patches.mjs';

const original = fs.readFileSync(new URL('../vendor/webphysics/src/physics/gpu/avbdState.ts', import.meta.url), 'utf8');
const source = patches.applyWebphysicsComputeBatchPatch?.(original) ?? original;
const result = await build({ stdin: { contents: source, resolveDir: new URL('../vendor/webphysics/src/physics/gpu/', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false });
const { AvbdStateStage } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const parameters = () => new Proxy({}, { get(target, key) { return target[key] ??= { value: 0 }; } });
for (const mode of ['colored', 'serial']) {
  const solve = { name: 'solve', computeNode: { parameters: parameters() } };
  const commit = { name: 'commit', computeNode: { parameters: parameters() } };
  const owner = { primalBodySolveKernel: solve, commitBodySolveKernel: commit };
  const calls = [], dispatches = [];
  const renderer = { compute(nodes, size) {
    const list = Array.isArray(nodes) ? nodes : [nodes]; calls.push(list.map(x => x.name));
    for (const node of list) {
      const p = node.computeNode.parameters;
      dispatches.push({ kernel: node.name, color: p.currentColor.value, base: p.bodyIndexBase.value, count: p.dispatchBodyCount.value, size: [...size] });
    }
  } };
  AvbdStateStage.prototype.primalSolveBodies.call(owner, renderer, 5, 2, 3, .95, 1 / 60, 1, .95, undefined, 0, 0, undefined, mode);
  assert.equal(calls.length, mode === 'colored' ? 6 : 20, 'colored solve and commit share each submission; serial scheduling stays unchanged');
  assert.equal(dispatches.length, mode === 'colored' ? 12 : 20, 'batching keeps every physical dispatch');
  for (let i = 0; i < dispatches.length; i += 2) {
    const a = dispatches[i], b = dispatches[i + 1];
    assert.equal(a.kernel, 'solve'); assert.equal(b.kernel, 'commit');
    assert.equal(a.color, b.color); assert.equal(a.base, b.base); assert.equal(a.count, b.count);
    assert.deepEqual(a.size, b.size);
    assert.equal(a.color, mode === 'colored' ? (i / 2) % 3 : 0);
    assert.equal(a.base, mode === 'colored' ? 0 : (i / 2) % 5);
  }
}
assert.throws(() => patches.applyWebphysicsComputeBatchPatch(source), /revision drift/);
console.log('Batched color sweeps preserve solve-before-commit dispatches and current color/body parameters');
