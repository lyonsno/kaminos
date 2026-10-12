import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');

// Grid height (Noah 2026-10-10): the vertical extent was a fixed ×2 of the
// width; flames that fit the box's physics were cut off at the top. The
// height is a control in cells: 0 means the old ×2 (every saved basin
// returns unchanged), otherwise the request is clamped to [width, 4×width]
// and snapped to a multiple of 4 (the workgroup). Cells keep their size; the
// box grows rows. Nothing is stretched.
test('resolveGridHeight: auto is twice the width; a request is clamped to [1, 4] × width and snapped to a multiple of 4', () => {
  assert.deepEqual(core.resolveGridHeight({}, 64), { requestedCells: 0, heightCells: 128, ratio: 2, mode: 'auto-twice-width' });
  assert.deepEqual(core.resolveGridHeight({ gridHeightCells: 0 }, 48), { requestedCells: 0, heightCells: 96, ratio: 2, mode: 'auto-twice-width' });
  assert.deepEqual(core.resolveGridHeight({ gridHeightCells: 144 }, 48), { requestedCells: 144, heightCells: 144, ratio: 3, mode: 'requested' });
  assert.deepEqual(core.resolveGridHeight({ gridHeightCells: 150 }, 48), { requestedCells: 150, heightCells: 152, ratio: 152 / 48, mode: 'requested-snapped' });
  assert.deepEqual(core.resolveGridHeight({ gridHeightCells: 20 }, 48), { requestedCells: 20, heightCells: 48, ratio: 1, mode: 'requested-clamped' });
  assert.deepEqual(core.resolveGridHeight({ gridHeightCells: 999 }, 32), { requestedCells: 999, heightCells: 128, ratio: 4, mode: 'requested-clamped' });
  assert.equal(core.resolveGridHeight({ gridHeightCells: 'abc' }, 64).heightCells, 128, 'nonfinite reads as auto');
  // The same ratio applied to another width (the resample helper and the irradiance lattice use it).
  assert.equal(core.gridHeightForRatio(32, 3), 96);
  assert.equal(core.gridHeightForRatio(16, 152 / 48), 52, 'snapped to a multiple of 4 at the other width');
});

test('the runtime derives every height from the resolved ratio: fluid grid, resample helper, irradiance lattice, and rebuilds on a height change', () => {
  const closure = source.slice(source.indexOf('export function createKaminosVolumePrototype('));
  assert.match(closure, /let verticalRatio = VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER;/);
  assert.match(closure, /verticalRatio = resolveGridHeight\(controlsSnapshot, normalizeGridSize\(controlsSnapshot\.resolution\)\)\.ratio;\n\s+let gridSize = normalizeGridSize\(controlsSnapshot\.resolution\);/, 'seated from the controls before the grid is sized');
  assert.match(closure, /const gridHeightForSize = size => gridHeightForRatio\(size, verticalRatio\);/);
  assert.ok(!closure.includes('irradianceGridSize * VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER'), 'the irradiance lattice no longer hard-codes ×2');
  assert.match(closure, /const irradianceGridHeight = gridHeightForSize\(irradianceGridSize\);/);
  // The update path rebuilds when the resolved height changes, as it does for the width.
  assert.match(closure, /const requestedHeight = resolveGridHeight\(controlsSnapshot, requestedGrid\);\n\s+const heightChanged = requestedHeight\.heightCells !== gridHeight;/);
  assert.match(closure, /if \(device && \(requestedGrid !== previousGrid \|\| heightChanged\)\) \{\n\s+verticalRatio = requestedHeight\.ratio;\n\s+rebuildFluidState\(requestedGrid, heightChanged \? 'grid-height-change' : 'grid-rebuilt'\);/);
  assert.match(closure, /state\.gridHeight = \{ \.\.\.requestedHeight, widthCells: requestedGrid \};/, 'receipt');
  // The immersed source's centre-y range follows the box top instead of the old constant 3.
  assert.match(source, /clampFinite\(controls\.immersedCentreY, -1, -1 \+ 2 \* gridHeight \/ grid, -0\.5\)/);
  const tall = core.resolveImmersedSourceConfig({ emitterSourceLaw: 'immersed-source', pressureSolver: 'converged-open-top', immersedCentreY: 4.5 }, { grid: 32, gridHeight: 96 });
  assert.equal(tall.requested.centre[1], 4.5, 'a 3× box reaches y = 5');
});

test('cockpit: a numeric height row with help, snapshot, listener, route restore, receipt; schema 249', () => {
  assert.match(index, /<input type="number" id="volume-grid-height-cells" data-volume-settings-param="volume_grid_height_cells" min="0" max="640" step="4" value="0">/);
  assert.match(index, /slider-help">Grid height in cells\. 0 keeps twice the width/);
  assert.match(index, /gridHeightCells: parseInt\(document\.getElementById\('volume-grid-height-cells'\)\.value, 10\) \|\| 0,/);
  assert.match(index, /getElementById\('volume-grid-height-cells-val'\)\.textContent = /);
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 1200);
  assert.ok(listenerList.includes("'volume-grid-height-cells',"), 'change listener');
  const restored = index.slice(index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = ['), index.indexOf('];', index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = [')));
  assert.ok(restored.includes("'volume-grid-height-cells'"), 'restored from saved routes');
  assert.match(index, /s\.gridHeight\?\.mode === 'auto-twice-width' \? '' : ` · height \$\{s\.gridHeight\.mode\}`/, 'the Grid receipt names a requested height');
  const control = schema.controls.find(c => c.key === 'volume-grid-height-cells');
  assert.deepEqual(control, { key: 'volume-grid-height-cells', param: 'volume_grid_height_cells', tagName: 'INPUT', type: 'number', additiveDefault: 0, additiveSinceControlCount: 249 });
  assert.equal(schema.controlCount, 249); assert.equal(schema.controls.length, 249);
});

test('capture: a height arm is checked against the effective grid dimensions', () => {
  assert.match(capture, /gridDimensions: s\.simGridDimensions \?\? null, gridHeight: s\.gridHeight \?\? null/);
  const ok = (v, dims, mode = 'requested') => effectiveMismatches({ set: [['volume-grid-height-cells', v]] }, { gridDimensions: dims, gridHeight: { heightCells: dims?.[1], mode } }, null);
  assert.deepEqual(ok('144', [48, 144, 48]), []);
  assert.equal(ok('144', [48, 96, 48]).length, 1, 'height not applied');
  assert.equal(ok('144', null).length, 1, 'no receipt');
  assert.deepEqual(ok('150', [48, 152, 48], 'requested-snapped'), [], 'a snapped request matches its snapped height');
  assert.deepEqual(ok('0', [48, 96, 48], 'auto-twice-width'), [], 'auto is twice the width');
  assert.equal(ok('0', [48, 144, 48], 'requested').length, 1, 'auto requested but a height still applied');
});
