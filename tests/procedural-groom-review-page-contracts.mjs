import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PAGE = new URL('../artifacts/procedural-groom-truth-v0/review.html', import.meta.url);

test('operator review page collects every required view and membership definition', async () => {
  let html;
  try {
    html = await readFile(PAGE, 'utf8');
  } catch (error) {
    assert.fail(`operator review page is missing: ${error.code ?? error.message}`);
  }

  for (const artifact of ['sparse-truth.png', 'neutral-dense.png', 'deformed-dense.png']) {
    assert.match(html, new RegExp(artifact.replace('.', '\\.')), `review page must include ${artifact}`);
  }
  for (const [label, color] of [
    ['Short coat — low puff', '#1fa0a1'],
    ['Short coat — high puff', '#ef6b1f'],
    ['Ruff', '#943dd1'],
    ['Whiskers', '#f2dea0'],
  ]) {
    assert.match(html, new RegExp(label, 'i'), `review page must define ${label}`);
    assert.match(html, new RegExp(color, 'i'), `review page must preserve ${label} membership color`);
  }
  assert.match(html, /mesh_root=scratch&amp;mesh_path=procedural-groom-truth-v0\.glb/);
  assert.doesNotMatch(html, /file:\/\//);
  assert.doesNotMatch(html, /private\/tmp|codex-/i);
});
