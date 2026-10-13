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
// top. The height is a multiplier on the width (Noah 2026-10-12: a multiplier,
// not raw cells): 2 (or no value) keeps twice the width, so every saved basin
// returns unchanged; a request is clamped to [1, 4] x width and snapped to the
// nearest admissible height. Cells keep their size; the box grows rows.
// Nothing is stretched.

test('admissible heights: a multiple of the workgroup that gives every derived lattice an integral height (GH-02)', () => {
  assert.deepEqual(Object.fromEntries(SUPPORTED_WIDTHS.map(w => [w, shape.gridHeightStep(w)])),
    { 32: 4, 48: 12, 64: 4, 96: 12, 128: 8, 136: 68, 140: 140, 160: 20 });
  // The derived lattice list is exactly the lattices the core derives from the box.
  assert.deepEqual([...shape.GRID_HEIGHT_DERIVED_LATTICE_WIDTHS].sort((a, b) => a - b), [...new Set([EMISSIVE_LIGHT_GRID, ...core.SUPPORTED_FIRE_IRRADIANCE_GRID_SIZES])].sort((a, b) => a - b));
  for (const w of SUPPORTED_WIDTHS) {
    for (let request = 1; request <= 5 * w; request += 1) {
      const resolved = shape.resolveGridHeight({ gridHeightRatio: request / w }, w);
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

test('resolveGridHeight: no value or 2 is twice the width; a multiplier is clamped and snapped, and the receipt says which', () => {
  assert.deepEqual(shape.resolveGridHeight({}, 64), { requestedRatio: null, requestedCells: 0, widthCells: 64, heightCells: 128, ratio: 2, step: 4, mode: 'auto-twice-width' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightRatio: 2 }, 64), { requestedRatio: null, requestedCells: 0, widthCells: 64, heightCells: 128, ratio: 2, step: 4, mode: 'auto-twice-width' }, '2 is the saved-basin height');
  assert.deepEqual(shape.resolveGridHeight({ gridHeightRatio: 3 }, 48), { requestedRatio: 3, requestedCells: 144, widthCells: 48, heightCells: 144, ratio: 3, step: 12, mode: 'requested' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightRatio: 3.125 }, 48), { requestedRatio: 3.125, requestedCells: 150, widthCells: 48, heightCells: 156, ratio: 156 / 48, step: 12, mode: 'requested-snapped' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightRatio: 0.5 }, 48), { requestedRatio: 0.5, requestedCells: 24, widthCells: 48, heightCells: 48, ratio: 1, step: 12, mode: 'requested-clamped' });
  assert.deepEqual(shape.resolveGridHeight({ gridHeightRatio: 9 }, 48), { requestedRatio: 9, requestedCells: 432, widthCells: 48, heightCells: 192, ratio: 4, step: 12, mode: 'requested-clamped' });
  assert.equal(shape.resolveGridHeight({ gridHeightRatio: 2.5 }, 32).heightCells, 80, 'the same multiplier at another width');
  assert.equal(shape.resolveGridHeight({ gridHeightRatio: 'abc' }, 64).mode, 'auto-twice-width', 'nonfinite reads as auto');
  assert.equal(shape.resolveGridHeight({ gridHeightRatio: 0 }, 64).mode, 'auto-twice-width', 'zero reads as auto');
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
  // The seed binds the reactant sidecar beside each fluid buffer (a stub texture pair here).
  const reactant = [stub(), stub()];
  const build = (w, h) => createSceneVolumeSource({ device, module: {}, uniformBuffer: {}, fluidBuffers: [{}, {}], frontBuffers: [{}, {}], getReactantTextures: () => reactant,
    grid: EMISSIVE_LIGHT_GRID, gridY: EMISSIVE_LIGHT_GRID * h / w, fluidGrid: w, fluidGridY: h });
  const was152 = shape.resolveGridHeight({ gridHeightRatio: 150 / 48 }, 48);
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
  assert.match(index, /function flameDomainTopY\(\) \{\n\s+const dims = window\.__kaminosVolumeGridPreview\?\.dimensions \?\? window\.__kaminosVolumeGridDimensions;\n\s+return Array\.isArray\(dims\) && dims\.length === 3 && dims\[0\] > 0 \? -1 \+ 2 \* dims\[1\] \/ dims\[0\] : 3;/);
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
  prototype.setControls({ gridHeightRatio: 3 });
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 144, 48], 'the edit takes effect without a device');
  assert.deepEqual({ ...prototype.debugState().gridHeight }, { requestedRatio: 3, requestedCells: 144, widthCells: 48, heightCells: 144, ratio: 3, step: 12, mode: 'requested', admitted: true, admissionReason: null, admissionChecked: false });
  assert.deepEqual(prototype.fireIrradianceLightField().raymarchWorldMax, [1, 5, 1], 'the published raymarch top follows');
  prototype.setControls({ gridHeightRatio: 2 });
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 96, 48], 'and back');
  const constructedTall = make({ resolution: 48, gridHeightRatio: 3.125 });
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
  const check = (value, e) => effectiveMismatches({ set: [['volume-grid-height-ratio', value]] }, e, null);
  const receipt = (request, w, extra = {}) => ({ ...shape.resolveGridHeight({ gridHeightRatio: request / w }, w), admitted: true, admissionReason: null, admissionChecked: true, ...extra });
  const checkCells = (cells, e) => check(String(cells / 48), e);
  assert.deepEqual(checkCells(432, end([48, 192, 48], receipt(432, 48))), [], 'a correctly clamped request passes');
  assert.deepEqual(checkCells(150, end([48, 156, 48], receipt(150, 48))), [], 'a snapped request passes at its snapped height');
  assert.deepEqual(checkCells(144, end([48, 144, 48], receipt(144, 48))), []);
  assert.deepEqual(check('2', end([48, 96, 48], receipt(96, 48))), [], 'auto');
  assert.equal(checkCells(144, end([48, 144, 48], { heightCells: 144 })).length, 1, 'a receipt without a mode fails');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { mode: 'requested-snapped' }))).length, 1, 'a wrong mode fails');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { widthCells: 64 }))).length, 1, 'a receipt for another width fails');
  assert.equal(checkCells(144, end([48, 96, 48], receipt(144, 48))).length, 1, 'height not applied');
  assert.equal(checkCells(144, end([48, 96, 48], receipt(144, 48, { admitted: false, admissionReason: 'grid-shape-exceeds-device-storage-binding:1>0' }))).length, 1, 'a refused shape fails the arm');
  assert.equal(checkCells(144, end(null, receipt(144, 48))).length, 1, 'no dimensions');
  assert.equal(check('2', end([48, 144, 48], receipt(144, 48))).length, 1, 'auto requested but a height still applied');
  // Confirmation 1 (GH-05-C): success needs affirmative admission, a Boolean true.
  const { admitted, ...withoutAdmission } = receipt(144, 48);
  assert.equal(checkCells(144, end([48, 144, 48], withoutAdmission)).length, 1, 'omitted admission fails');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { admitted: null }))).length, 1, 'null admission fails');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { admitted: 'false' }))).length, 1, 'a retyped admission fails');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { admitted: 'true' }))).length, 1, 'a string true is not a Boolean true');
  assert.equal(checkCells(144, end([48, 144, 48], receipt(144, 48, { admitted: 1 }))).length, 1, 'nor is 1');
  assert.match(capture, /gridDimensions: s\.simGridDimensions \?\? null, gridHeight: s\.gridHeight \?\? null/);
});

test('cockpit: a width-multiplier height row with help, snapshot, debounced listener, route restore, receipt; schema 249', () => {
  assert.match(index, /<input type="number" id="volume-grid-height-ratio" data-volume-settings-param="volume_grid_height_ratio" data-volume-commit="confirm" min="1" max="4" step="0\.125" value="2">/);
  assert.match(index, /slider-help">Grid height as a multiple of the width\. 2 is what every saved basin was authored at\./);
  assert.match(index, /snapped to the nearest height that keeps the light lattices aligned \(steps of 4 cells at 32 and 64, 12 at 48 and 96\)/);
  assert.match(index, /gridHeightRatio: parseFloat\(volumeRebuildControlValue\('volume-grid-height-ratio'\)\) \|\| 2,/);
  assert.match(index, /getElementById\('volume-grid-height-ratio-val'\)\.textContent = /);
  assert.ok(!index.includes('volume-grid-height-cells'), 'the cells control is gone');
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 1200);
  assert.ok(!listenerList.includes("'volume-grid-height-ratio',"), 'not on the immediate listener list');
  const restored = index.slice(index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = ['), index.indexOf('];', index.indexOf('const VOLUME_ROUTE_RESTORED_CONTROL_IDS = [')));
  assert.ok(restored.includes("'volume-grid-height-ratio'"), 'restored from saved routes');
  assert.match(index, /gh\.admitted === false \? ` · height \$\{gh\.heightCells\} REFUSED \(\$\{gh\.admissionReason\}\)/, 'a refused height is named');
  assert.match(index, /gh\.mode === 'auto-twice-width' \? '' : ` · height \$\{gh\.heightCells\} \(\$\{gh\.ratio\.toFixed\(2\)\}× width, \$\{gh\.mode\}\)`/);
  const control = schema.controls.find(c => c.key === 'volume-grid-height-ratio');
  assert.deepEqual(control, { key: 'volume-grid-height-ratio', param: 'volume_grid_height_ratio', tagName: 'INPUT', type: 'number', additiveDefault: 2, additiveSinceControlCount: 249 });
  assert.ok(!schema.controls.some(c => c.key === 'volume-grid-height-cells'));
  assert.equal(schema.controlCount, 253); assert.equal(schema.controls.length, 253); // 249 + the reaction law select and the two reactant controls
});

// Noah 2026-10-12, contract: editing the height previews it (the box bounds
// scale, the Kaminos authoring side scales its box) and the sim rebuilds only
// on confirm (Enter or leaving the field); "it's still going through before I
// hit enter" was the idle-timer debounce. While an edit is pending every sync
// reads the value the sim already uses (review GH-R3-02); a complete restore
// supersedes the pending edit (review GH-R4-01).
test('cockpit: the height previews while edited and applies on confirm (the page code, fake DOM)', () => {
  const start = index.indexOf('// Controls that rebuild the fluid state apply on confirm');
  const end = index.indexOf('\n}\n', index.indexOf('function supersedeVolumeRebuildHolds(')) + 3;
  assert.ok(start > 0 && end > start, 'the shared rebuild helpers exist');
  const helpers = index.slice(start, end);
  const wiringStart = index.indexOf('  for (const id of VOLUME_REBUILD_CONTROL_IDS) {');
  const wiringEnd = index.indexOf('\n  }\n', wiringStart) + 4;
  assert.ok(wiringStart > 0, 'the wiring exists');
  const wiring = index.slice(wiringStart, wiringEnd);
  assert.match(helpers, /const VOLUME_REBUILD_CONTROL_IDS = \['volume-grid-height-ratio'\];/);
  assert.ok(!helpers.includes('setTimeout'), 'no idle timer');
  assert.match(index, /<input type="number" id="volume-grid-height-ratio" data-volume-settings-param="volume_grid_height_ratio" data-volume-commit="confirm" min="1" max="4" step="0\.125" value="2">/);
  assert.match(index, /gridHeightRatio: parseFloat\(volumeRebuildControlValue\('volume-grid-height-ratio'\)\) \|\| 2,/);

  const elements = {};
  const element = (id, value) => (elements[id] = { id, value, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } });
  element('volume-grid-height-ratio', '2');
  const document = { getElementById: id => elements[id] };
  const previews = [];
  const window = { dispatchEvent: event => previews.push(event.detail) };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail ?? null; } }
  const volumePrototype = { previewGridShape: request => ({ request: { ...request }, heightCells: Math.round(Number(request.gridHeightRatio) * 48) }) };
  const applied = [];
  const run = new Function('document', 'window', 'CustomEvent', 'volumePrototypeRef', 'record', `
    const volumePrototype = volumePrototypeRef;
    ${helpers}
    const syncControls = () => record(volumeRebuildControlValue('volume-grid-height-ratio'));
    const updateVolumeRebuildControlLabel = () => {};
    const refreshFlameDomainGuideBox = () => {};
    ${wiring}
    return [syncControls, supersedeVolumeRebuildHolds];`);
  const [syncControls, supersede] = run(document, window, CustomEvent, volumePrototype, value => applied.push(value));
  const control = elements['volume-grid-height-ratio'];
  const fire = (type, extra = {}) => { for (const fn of control.listeners[type] || []) fn({ target: control, ...extra }); };
  const type = value => { control.value = value; fire('input'); };
  syncControls();
  type('3'); fire('change'); // typing, then a spinner-style change event
  syncControls(); // an unrelated immediate control
  assert.deepEqual(applied, ['2', '2'], 'nothing applies before confirm, not even a change event');
  assert.equal(previews.at(-1).heightCells, 144, 'the edit is previewed');
  type('4');
  fire('keydown', { key: 'Enter' });
  assert.deepEqual(applied, ['2', '2', '4'], 'Enter applies the pending value once');
  assert.equal(previews.at(-1), null, 'the preview ends on confirm');
  type('1.5'); fire('blur');
  assert.equal(applied.at(-1), '1.5', 'leaving the field confirms');
  const n = applied.length;
  fire('blur'); fire('keydown', { key: 'Enter' });
  assert.equal(applied.length, n, 'a confirm with nothing pending does nothing');
  type('3'); fire('keydown', { key: 'Escape' });
  assert.equal(control.value, '1.5', 'Escape restores the applied value');
  assert.equal(previews.at(-1), null);
  syncControls(); assert.equal(applied.at(-1), '1.5');
  type('2.5'); supersede(); control.value = '3.25'; syncControls();
  assert.equal(applied.at(-1), '3.25', 'a complete restore supersedes the pending edit');
  assert.equal(previews.at(-1), null);
  fire('keydown', { key: 'Enter' });
  assert.equal(applied.at(-1), '3.25', 'and leaves nothing to confirm');
  assert.match(index, /function writeFlameSettingsState\(state\) \{\n  supersedeVolumeRebuildHolds\(\);/);
  assert.match(index, /function applyVolumeScenePreset\(scene, options = \{\}\) \{\n  supersedeVolumeRebuildHolds\(\);/);
  // The guide box follows the preview while one is pending.
  assert.match(index, /const dims = window\.__kaminosVolumeGridPreview\?\.dimensions \?\? window\.__kaminosVolumeGridDimensions;/);
  // Review GH-R5-01: the authored-parameter writer (kaminosAuthoringParameters.set,
  // parameter history replay) writes an authoritative value, so it confirms too.
  const writer = index.slice(index.indexOf('    const write=state=>{\n      setVolumeControlValue(control.id,state.value);'), index.indexOf('    const check=state=>{', index.indexOf('    const write=state=>{\n      setVolumeControlValue(control.id,state.value);')));
  assert.ok(writer.length > 0, 'the parameter writer exists');
  assert.match(writer, /control\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\);\n      if\(control\.dataset\.volumeCommit==='confirm'\)control\.dispatchEvent\(new KeyboardEvent\('keydown',\{key:'Enter',bubbles:true\}\)\);/);
  // The capture confirms controls that need it.
  assert.match(capture, /if \(e\.dataset\?\.volumeCommit === 'confirm'\) e\.dispatchEvent\(new w\.KeyboardEvent\('keydown', \{ key: 'Enter', bubbles: true \}\)\);/);
});

// The Kaminos authoring side scales its box from the same law without a rebuild.
test('previewGridShape: the resolved shape and box bounds without touching the sim', () => {
  assert.match(closure, /    previewGridShape\(request = \{\}\) \{/);
  const api = closure.slice(closure.indexOf('    previewGridShape(request = {}) {'), closure.indexOf('    previewGridShape(request = {}) {') + 1400);
  assert.match(api, /const shape = resolveGridHeight\(\{ gridHeightRatio: request\.gridHeightRatio \?\? controlsSnapshot\.gridHeightRatio \}, width\);/);
  assert.match(api, /const box = raymarchDomainBox\(shape\.widthCells, shape\.heightCells\);/);
  assert.match(api, /dimensions: \[shape\.widthCells, shape\.heightCells, shape\.widthCells\], localMin: box\.min, localMax: box\.max, applied: shape\.widthCells === gridSize && shape\.heightCells === gridHeight/);
  const stub = () => new Proxy(function () {}, {
    get(target, prop) { if (prop === Symbol.toPrimitive) return () => 0; if (prop === 'then') return undefined; return target[prop] ?? (target[prop] = stub()); },
    set(target, prop, value) { target[prop] = value; return true; },
    apply() { return stub(); }, construct() { return stub(); },
  });
  globalThis.document = stub(); globalThis.window = globalThis.window || stub();
  globalThis.requestAnimationFrame = () => 0; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const prototype = core.createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(), getControls: () => ({ resolution: 48 }), onStatus: () => {} });
  const preview = prototype.previewGridShape({ gridHeightRatio: 3 });
  assert.deepEqual(preview.dimensions, [48, 144, 48]);
  assert.deepEqual(preview.localMax, [1, 5, 1]);
  assert.equal(preview.applied, false);
  assert.equal(preview.mode, 'requested');
  assert.deepEqual(prototype.debugState().simGridDimensions, [48, 96, 48], 'the sim is untouched');
  assert.equal(prototype.previewGridShape({}).applied, true, 'the applied shape previews as applied');
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
  prototype.setControls({ gridHeightRatio: 3 });
  const receipt = prototype.debugState().gridHeight;
  prototype.setControls({ gridOverlay: 0.5 });
  assert.equal(prototype.debugState().gridHeight, receipt, 'same receipt after an unrelated change');
  prototype.setControls({ gridHeightRatio: 3.25 });
  assert.notEqual(prototype.debugState().gridHeight, receipt, 'a new request writes a new receipt');
  assert.equal(prototype.debugState().gridHeight.heightCells, 156);
});
