import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFileStem } from '../scene-file-names.mjs';

test('author file names become safe stems without their extension', () => {
  assert.equal(sanitizeFileStem('My Kiln Scene!', '.kaminos.json'), 'My-Kiln-Scene');
  assert.equal(sanitizeFileStem('My-Kiln-Scene.kaminos.json', '.kaminos.json'), 'My-Kiln-Scene');
  assert.equal(sanitizeFileStem('chair.GLB', '.glb'), 'chair');
  assert.equal(sanitizeFileStem('../../escape', '.glb'), 'escape');
  assert.equal(sanitizeFileStem('  kiln   and   chair  ', '.glb'), 'kiln-and-chair');
  assert.equal(sanitizeFileStem('///', '.glb'), '');
  assert.equal(sanitizeFileStem('.hidden-', ''), 'hidden');
  assert.equal(sanitizeFileStem('x'.repeat(300)).length, 120);
});
