import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the viewport Add menu exposes the live water-emitter scene action and Blender shortcut', () => {
  assert.match(html, /id="scene-add-menu"/);
  assert.match(html, /id="scene-add-menu-trigger"[^>]*aria-expanded="false"/);
  assert.match(html, /data-scene-add="water-emitter"/);
  assert.match(html, /event\.shiftKey\s*&&\s*event\.key\.toLowerCase\(\)\s*===\s*'a'/);
  assert.match(html, /addLocalLiquidEmitter\(\)/);
});
