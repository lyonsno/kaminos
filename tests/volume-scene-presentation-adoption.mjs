// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function fixture({ active = false, initialized = false } = {}) {
  const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  const start = source.indexOf('    setSceneCompositionPresentation(value) {');
  assert.ok(start >= 0, 'the ordinary volume must support adopting scene alpha without replacing the scene');
  const end = source.indexOf('    async setActive(', start);
  const method = source.slice(start, end).trim().replace(/^setSceneCompositionPresentation/, 'function').replace(/,$/, '');
  const state = { active }, calls = [], canvas = { style: {} };
  let transparentCanvas = false;
  const device = initialized ? {} : null, format = 'bgra8unorm', gridSize = 32;
  const GPUTextureUsage = { RENDER_ATTACHMENT: 16, COPY_SRC: 1 };
  const context = initialized ? { configure(value) { calls.push(['configure', value]); } } : null;
  function rebuildFluidState(size, reason) { calls.push(['rebuild', size, reason]); }
  return { set: eval('(' + method + ')'), state, calls, canvas };
}
test('first field selects premultiplied presentation before lazy GPU initialization', () => {
  const f = fixture();
  assert.equal(f.set(true).transparentCanvas, true);
  assert.equal(f.canvas.style.background, 'transparent');
  assert.equal(f.calls.length, 0);
});
test('an initialized inactive field changes real canvas and pipeline alpha together', () => {
  const f = fixture({ initialized: true });
  f.set(true);
  assert.equal(f.calls[0][1].alphaMode, 'premultiplied');
  assert.equal(f.calls[1][0], 'rebuild');
  f.set(true);
  assert.equal(f.calls.length, 2);
  f.set(false);
  assert.equal(f.calls[2][1].alphaMode, 'opaque');
  assert.equal(f.state.sceneCompositionPresentation.transparentCanvas, false);
});
test('live presentation changes and non-Boolean requests refuse before mutation', () => {
  const f = fixture({ active: true, initialized: true });
  assert.throws(() => f.set(true), /Pause/);
  assert.throws(() => f.set('true'), /Boolean/);
  assert.deepEqual(f.calls, []);
});
