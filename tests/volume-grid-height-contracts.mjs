import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import * as shape from '../volume-grid-shape.mjs';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';
import { createSceneVolumeSource } from '../scene-volume-source.mjs';
import { EMISSIVE_LIGHT_GRID } from '../volume-emissive-transport.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
const closure = source.slice(source.indexOf('export function createKaminosVolumePrototype('));
const SUPPORTED_WIDTHS = [32, 48, 64, 96, 128, 136, 140, 160];

// Grid height (Noah 2026-10-10; report §34): the vertical extent was a fixed
// twice the width and flames that fit the box's physics were cut off at the
// top. The height is a control in cells: 0 keeps twice the width (every saved
// basin returns unchanged); a request is clamped to [width, 4 x width] and
// snapped to the nearest admissible height. Cells keep their size; the box
// grows rows. Nothing is stretched.

test('admissible heights: a multiple of the workgroup that gives every derived lattice an integral height (GH-02)', () => {
  assert.deepEqual(Object.fromEntries(SUPPORTED_WIDTHS.map(w => [w, shape.gridHeightStep(w)])),
    { 32: 4, 48: 12, 64: 4, 96: 12, 128: 8, 136: 68, 140: 140, 160: 20 });
  // The derived lattice list is exactly the lattices the core derives from the box.
  assert.deepEqual([...shape.GRID_HEIGHT_DERIVED_LATTICE_WIDTHS].sort((a, b) => a - b), [...new Set([EMISSIVE_LIGHT_GRID, ...core.SUPPORTED_FIRE_IRRADIANCE_GRID_SIZES])].sort((a, b) => a - b));
  for (const w of SUPPORTED_WIDTHS) {
    for (let request = 1; request <= 5 * w; request += 1) {
      const resolved = shape.resolveGridHeight({ gridHeightCells: request }, w);
      const h = resolved.heightCells;
      assert.ok(h >= w && h <= 4 * w, `${w}: ${request} → ${h} inside [w, 4w]`);
      assert.equal(h % 4, 0, `${w}: ${h} is a workgroup multiple`);
      for (const d of shape.GRID_HEIGHT_DERIVED_LATTICE_WIDTHS) {
        assert.ok(Number.isInteger(d * h / w), `${w}×${h}: the ${d}-wide lattice is ${d * h / w} tall`);
        assert.equal(shape.gridHeightForShape(d, resolved), d * h / w);
      }
      assert.equal(shape.gridHeightForShape(w, resolved), h);
    }
  }
});

test('resolveGridHeight: auto is twice the width; a request is clamped and snapped, and the receipt says which', () => {
  assert.deepEqual(shape.resolveGridHeight({}, 64), { requestedCells: 0, widthCells: 64, heightCells: 128, ratio: 2, step: 4, mode: 'auto-twice-width' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightCells: 144 }, 48), { requestedCells: 144, widthCells: 48, heightCells: 144, ratio: 3, step: 12, mode: 'requested' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightCells: 150 }, 48), { requestedCells: 150, widthCells: 48, heightCells: 156, ratio: 156 / 48, step: 12, mode: 'requested-snapped' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightCells: 20 }, 48), { requestedCells: 20, widthCells: 48, heightCells: 48, ratio: 1, step: 12, mode: 'requested-clamped' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightCells: 640 }, 48), { requestedCells: 640, widthCells: 48, heightCells: 192, ratio: 4, step: 12, mode: 'requested-clamped' });
  assert.equal(shape.resolveGridHeight({ gridHeightCells: 'abc' }, 64).mode, 'auto-twice-width', 'nonfinite reads as auto');
  assert.throws(() => shape.resolveGridHeight({}, 0), /positive multiple of 4/);
  assert.throws(() => shape.resolveGridHeight({}, 50), /positive multiple of 4/);
  // The core re-exports the one law.
  assert.equal(core.resolveGridHeight, shape.resolveGridHeight);
});

test('GH-02: the shared scene-source lattice accepts every height the resolver admits, including the request that used to give 152', () => {
  const stub = () => new Proxy(function () {}, {
    get(target, prop) { if (prop === 'then') return undefined; return target[prop] ?? (target[prop] = stub()); },
    apply() { return stub(); },
    construct() { return stub(); },
  });
  globalThis.GPUTextureUsage ??= { STORAGE_BINDING: 8, TEXTURE_BINDING: 4, COPY_SRC: 1 };
  const device = stub();
  const build = (w, h) => createSceneVolumeSource({ device, module: {}, uniformBuffer: {}, fluidBuffers: [{}, {}], frontBuffers: [{}, {}],
    grid: EMISSIVE_LIGHT_GRID, gridY: EMISSIVE_LIGHT_GRID * h / w, fluidGrid: w, fluidGridY: h });
  const was152 = shape.resolveGridHeight({ gridHeightCells: 150 }, 48);
  assert.equal(was152.heightCells, 156);
  assert.doesNotThrow(() => build(48, 156));
  assert.doesNotThrow(() => build(48, 144));
  assert.doesNotThrow(() => build(64, 128));
  assert.throws(() => build(48, 152), /positive integer source dimensions required/, 'the first cut\'s 48×152 is what the consumer refuses');
});

test('GH-01: the camera samples the whole box: the raymarch box follows GRID_Y/GRID and a ray through an added row hits it', () => {
  assert.deepEqual(shape.raymarchDomainBox(64, 128), { center: [0, 1, 0], half: [1, 2, 1], min: [-1, -1, -1], max: [1, 3, 1] }, 'auto keeps the original bounds');
  assert.deepEqual(shape.raymarchDomainBox(64, 192), { center: [0, 2, 0], half: [1, 3, 1], min: [-1, -1, -1], max: [1, 5, 1] });
  const ray = [[-5, 4, 0.1], [1, 0, 0]];
  const tall = shape.raymarchBoxHitModel(...ray, shape.raymarchDomainBox(64, 192));
  const auto = shape.raymarchBoxHitModel(...ray, shape.raymarchDomainBox(64, 128));
  assert.ok(tall[0] < tall[1] && Math.abs(tall[0] - 4) < 1e-9 && Math.abs(tall[1] - 6) < 1e-9, `a horizontal ray at y = 4 crosses the 192-tall box (${tall})`);
  assert.ok(!(auto[0] < auto[1]), 'and misses the auto box');
  // The shader computes the same box from its constants; the fixed y in [-1, 3] is gone.
  assert.match(source, /let domainHalfY = f32\(GRID_Y\) \/ f32\(GRID\);\n\s+let hit = boxHit\(ro - vec3<f32>\(0\.0, domainHalfY - 1\.0, 0\.0\), rd, vec3<f32>\(1\.0, domainHalfY, 1\.0\)\);/);
  assert.ok(!source.includes('boxHit(ro - vec3<f32>(0.0, 1.0, 0.0), rd, vec3<f32>(1.0, 2.0, 1.0))'));
  // The published raymarch bounds come from the same helper.
  assert.match(closure, /const domainBox = raymarchDomainBox\(gridSize, gridHeight\);/);
  assert.match(closure, /raymarchWorldMax: domainBox\.max\.map\(\(value, axis\) => value \+ productTransform\.translate\[axis\]\),/);
  // The cockpit's flame-domain guide follows the effective top instead of y = 3.
  assert.ok(!index.includes('new THREE.Vector3(1, 3, 1).add(new THREE.Vector3(...flameDomainTranslation))'));
  assert.equal((index.match(/new THREE\.Vector3\(1, flameDomainTopY\(\), 1\)\.add\(new THREE\.Vector3\(\.\.\.flameDomainTranslation\)\)/g) || []).length, 2);
  assert.match(index, /function flameDomainTopY\(\) \{\n\s+const dims = window\.__kaminosVolumeGridDimensions;\n\s+return Array\.isArray\(dims\) && dims\.length === 3 && dims\[0\] > 0 \? -1 \+ 2 \* dims\[1\] \/ dims\[0\] : 3;/);
  assert.match(index, /window\.__kaminosVolumeGridDimensions = \[\.\.\.s\.simGridDimensions\];\n\s+refreshFlameDomainGuideBox\(\);/, 'the status writer refreshes the guide when the dimensions change');
});

test('GH-03: a height edit before GPU initialization changes the effective dimensions and the receipt together', () => {
  const stub = () => new Proxy(function () {}, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;
      return target[prop] ?? (target[prop] = stub());
    },
    set(target, prop, value) { target[prop] = value; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
  globalThis.document = stub();
  globalThis.window = globalThis.window || stub();
  globalThis.requestAnimationFrame = () => 0;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const make = controls => core.createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(), getControls: () => controls, onStatus: () => {} });
  const prototype = make({ resolution: 48 });
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 96, 48]);
  assert.equal(prototype.debugState().gridHeight.mode, 'auto-twice-width', 'the receipt exists from construction');
  prototype.setControls({ gridHeightCells: 144 });
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 144, 48], 'the edit takes effect without a device');
  assert.deepEqual({ ...prototype.debugState().gridHeight }, { requestedCells: 144, widthCells: 48, heightCells: 144, ratio: 3, step: 12, mode: 'requested', admitted: true, admissionReason: null, admissionChecked: false });
  assert.deepEqual(prototype.fireIrradianceLightField().raymarchWorldMax, [1, 5, 1], 'the published raymarch top follows');
  prototype.setControls({ gridHeightCells: 0 });
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 96, 48], 'and back');
  const constructedTall = make({ resolution: 48, gridHeightCells: 150 });
  assert.deepEqual(constructedTall.debugState().simGridDimensions, [48, 156, 48], 'a saved tall basin is tall from construction, at its admissible height');
});

test('GH-04: a shape the device cannot hold is refused before the field is replaced; the device request covers the tallest shape', () => {
  const MiB = 1024 * 1024;
  const limits = { maxStorageBufferBindingSize: 128 * MiB, maxBufferSize: 256 * MiB, maxTextureDimension3D: 2048 };
  assert.deepEqual(core.gridShapeAdmission({ widthCells: 96, heightCells: 192 }, limits),
    { admitted: true, reason: null, fluidBytes: 113246208, storageLimit: 128 * MiB, textureDimension: 288, textureLimit: 2048 });
  const tall = core.gridShapeAdmission({ widthCells: 96, heightCells: 384 }, limits);
  assert.equal(tall.admitted, false); assert.equal(tall.fluidBytes, 226492416);
  assert.match(tall.reason, /^grid-shape-exceeds-device-storage-binding:226492416>134217728$/);
  assert.equal(core.gridShapeAdmission({ widthCells: 160, heightCells: 640 }, { maxStorageBufferBindingSize: 4096 * MiB, maxBufferSize: 4096 * MiB, maxTextureDimension3D: 2048 }).fluidBytes, 1048576000);
  assert.match(core.gridShapeAdmission({ widthCells: 96, heightCells: 384 }, { maxTextureDimension3D: 256 }).reason, /^grid-shape-exceeds-device-3d-texture-dimension:384>256$/);
  assert.equal(core.gridShapeAdmission({ widthCells: 96, heightCells: 384 }, {}).admitted, true, 'unknown limits do not refuse');
  // Live edits: admission precedes the rebuild, and a refusal keeps the field.
  const edit = closure.slice(closure.indexOf('    setControls(next) {'), closure.indexOf('      state.gridOverlay = controlsSnapshot.gridOverlay || 0;'));
  assert.match(edit, /const admission = device && shapeChanged \? gridShapeAdmission\(requestedShape, device\.limits\) : \{ admitted: true, reason: null \};/);
  assert.match(edit, /if \(!admission\.admitted\) \{\n\s+\/\/ Refused: the field, its shape and its dimensions stay as they were\./);
  assert.ok(edit.indexOf('if (!admission.admitted) {') < edit.indexOf("rebuildFluidState(requestedGrid, heightChanged ? 'grid-height-change' : 'grid-rebuilt');"));
  // Initial allocation: a shape the new device cannot hold falls back to twice the width, receipted.
  const init = closure.slice(closure.indexOf('  async function ensureGpu() {'), closure.indexOf("    rebuildFluidState(controlsSnapshot.resolution);"));
  assert.match(init, /const initialAdmission = gridShapeAdmission\(gridShape, device\.limits\);/);
  assert.match(init, /gridShape = resolveGridHeight\(\{\}, gridShape\.widthCells\);/);
  // Device requests: the own and shared devices ask for the tallest admissible shape; a caller-owned device keeps the auto-height requirement.
  assert.match(source, /volumeStorageBufferRequestBytes\(Math\.max\(\.\.\.SUPPORTED_GRID_SIZES\), null, Math\.max\(\.\.\.SUPPORTED_GRID_SIZES\) \* GRID_HEIGHT_MAX_RATIO\)/);
  assert.match(closure, /\? volumeStorageBufferRequestBytes\(gridSize, boundarySplatCapacity\)\n\s+: volumeStorageBufferRequestBytes\(Math\.max\(\.\.\.SUPPORTED_GRID_SIZES\), null, Math\.max\(\.\.\.SUPPORTED_GRID_SIZES\) \* GRID_HEIGHT_MAX_RATIO\);/);
});

test('GH-05: the capture gate compares a height arm with the resolver at the effective width and requires a complete receipt', () => {
  const end = (dims, gridHeight) => ({ gridDimensions: dims, gridHeight });
  const check = (value, e) => effectiveMismatches({ set: [['volume-grid-height-cells', value]] }, e, null);
  const receipt = (request, w, extra = {}) => ({ ...shape.resolveGridHeight({ gridHeightCells: request }, w), admitted: true, admissionReason: null, admissionChecked: true, ...extra });
  assert.deepEqual(check('640', end([48, 192, 48], receipt(640, 48))), [], 'a correctly clamped request passes');
  assert.deepEqual(check('150', end([48, 156, 48], receipt(150, 48))), [], 'a snapped request passes at its snapped height');
  assert.deepEqual(check('144', end([48, 144, 48], receipt(144, 48))), []);
  assert.deepEqual(check('0', end([48, 96, 48], receipt(0, 48))), [], 'auto');
  assert.equal(check('144', end([48, 144, 48], { heightCells: 144 })).length, 1, 'a receipt without a mode fails');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { mode: 'requested-snapped' }))).length, 1, 'a wrong mode fails');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { widthCells: 64 }))).length, 1, 'a receipt for another width fails');
  assert.equal(check('144', end([48, 96, 48], receipt(144, 48))).length, 1, 'height not applied');
  assert.equal(check('144', end([48, 96, 48], receipt(144, 48, { admitted: false, admissionReason: 'grid-shape-exceeds-device-storage-binding:1>0' }))).length, 1, 'a refused shape fails the arm');
  assert.equal(check('144', end(null, receipt(144, 48))).length, 1, 'no dimensions');
  assert.equal(check('0', end([48, 144, 48], receipt(144, 48))).length, 1, 'auto requested but a height still applied');
  // Confirmation 1 (GH-05-C): success needs affirmative admission, a Boolean true.
  const { admitted, ...withoutAdmission } = receipt(144, 48);
  assert.equal(check('144', end([48, 144, 48], withoutAdmission)).length, 1, 'omitted admission fails');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { admitted: null }))).length, 1, 'null admission fails');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { admitted: 'false' }))).length, 1, 'a retyped admission fails');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { admitted: 'true' }))).length, 1, 'a string true is not a Boolean true');
  assert.equal(check('144', end([48, 144, 48], receipt(144, 48, { admitted: 1 }))).length, 1, 'nor is 1');
  assert.match(capture, /gridDimensions: s\.simGridDimensions \?\? null, gridHeight: s\.gridHeight \?\? null/);
});

test('cockpit: a numeric height row with help, snapshot, listener, route restore, receipt; schema 249', () => {
  assert.match(index, /<input type="number" id="volume-grid-height-cells" data-volume-settings-param="volume_grid_height_cells" min="0" max="640" step="4" value="0">/);
  assert.match(index, /slider-help">Grid height in cells\. 0 keeps twice the width/);
  assert.match(index, /snapped to the nearest height that keeps the light lattices aligned \(steps of 4 cells at 32 and 64, 12 at 48 and 96\)/);
  assert.match(index, /gridHeightCells: parseInt\(document\.getElementById\('volume-grid-height-cells'\)\.value, 10\) \|\| 0,/);
  assert.match(index, /getElementById\('volume-grid-height-cells-val'\)\.textContent = /);
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 1200);
  assert.ok(listenerList.includes("'volume-grid-height-cells',"), 'change listener');
  const restored = index.slice(index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = ['), index.indexOf('];', index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = [')));
  assert.ok(restored.includes("'volume-grid-height-cells'"), 'restored from saved routes');
  assert.match(index, /gh\.admitted === false \? ` · height \$\{gh\.heightCells\} REFUSED \(\$\{gh\.admissionReason\}\)/, 'a refused height is named');
  assert.match(index, /gh\.mode === 'auto-twice-width' \? '' : ` · height \$\{gh\.heightCells\} \(\$\{gh\.ratio\.toFixed\(2\)\}× width, \$\{gh\.mode\}\)`/);
  const control = schema.controls.find(c => c.key === 'volume-grid-height-cells');
  assert.deepEqual(control, { key: 'volume-grid-height-cells', param: 'volume_grid_height_cells', tagName: 'INPUT', type: 'number', additiveDefault: 0, additiveSinceControlCount: 249 });
  assert.equal(schema.controlCount, 249); assert.equal(schema.controls.length, 249);
});

test('the runtime derives every height from the seated shape: fluid grid, resample, irradiance lattice; the immersed centre range follows the top', () => {
  assert.match(closure, /let gridShape = null;\n\s+const gridHeightForSize = size => gridHeightForShape\(size, gridShape\);/);
  assert.match(closure, /gridShape = resolveGridHeight\(controlsSnapshot, normalizeGridSize\(controlsSnapshot\.resolution\)\);\n\s+let gridSize = normalizeGridSize\(controlsSnapshot\.resolution\);/);
  assert.ok(!closure.includes('irradianceGridSize * VOLUME_VERTICAL_DOMAIN_EXTENT_MULTIPLIER'));
  assert.ok(!source.includes('verticalRatio'), 'one representation of the shape');
  assert.match(source, /clampFinite\(controls\.immersedCentreY, -1, -1 \+ 2 \* gridHeight \/ grid, -0\.5\)/);
  const tall = core.resolveImmersedSourceConfig({ emitterSourceLaw: 'immersed-source', pressureSolver: 'converged-open-top', immersedCentreY: 4.5 }, { grid: 32, gridHeight: 96 });
  assert.equal(tall.requested.centre[1], 4.5, 'a 3× box reaches y = 5');
});

// Found by the live witness of revision 1: the receipt was rewritten by every
// later setControls (shape unchanged, nothing checked), so a shape the device
// had admitted read `admissionChecked: false` by the end of the arm. The
// receipt now changes only when the request changes or a check runs.
test('the admission receipt stays with the shape it describes until the request changes or a check runs', () => {
  const edit = closure.slice(closure.indexOf('    setControls(next) {'), closure.indexOf('      state.gridOverlay = controlsSnapshot.gridOverlay || 0;'));
  assert.match(edit, /const receiptStale = !state\.gridHeight \|\| state\.gridHeight\.widthCells !== requestedShape\.widthCells \|\| state\.gridHeight\.requestedCells !== requestedShape\.requestedCells \|\| state\.gridHeight\.heightCells !== requestedShape\.heightCells;/);
  assert.match(edit, /if \(receiptStale \|\| \(device && shapeChanged\)\) state\.gridHeight = \{ \.\.\.requestedShape, admitted: admission\.admitted, admissionReason: admission\.reason, admissionChecked: Boolean\(device && shapeChanged\) \};/);
  // Behaviour without a device: an unrelated control change keeps the receipt object.
  const stub = () => new Proxy(function () {}, {
    get(target, prop) { if (prop === Symbol.toPrimitive) return () => 0; if (prop === 'then') return undefined; return target[prop] ?? (target[prop] = stub()); },
    set(target, prop, value) { target[prop] = value; return true; },
    apply() { return stub(); }, construct() { return stub(); },
  });
  globalThis.document = stub(); globalThis.window = globalThis.window || stub();
  globalThis.requestAnimationFrame = () => 0; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const prototype = core.createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(), getControls: () => ({ resolution: 48 }), onStatus: () => {} });
  prototype.setControls({ gridHeightCells: 144 });
  const receipt = prototype.debugState().gridHeight;
  prototype.setControls({ gridOverlay: 0.5 });
  assert.equal(prototype.debugState().gridHeight, receipt, 'same receipt after an unrelated change');
  prototype.setControls({ gridHeightCells: 156 });
  assert.notEqual(prototype.debugState().gridHeight, receipt, 'a new request writes a new receipt');
  assert.equal(prototype.debugState().gridHeight.heightCells, 156);
});
