// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { resolveFlameLightingRoute } from '../scene-authoring.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function addFirstFlameField(');
const end = source.indexOf('function installAuthoringParameterEditing()', start);

function fixture({ holdActivation = false, coldBoot = false } = {}) {
  let field = { composition: null, settings: {}, sourcePresent: false, route: {} };
  let mountCount = 0, pending, releaseActivation, boot, bootCalls = 0, basinLoads = 0;
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@first-flame-field', {
    read: () => field, check: value => value,
    write: async value => {
      field = value;
      if (value.sourcePresent) {
        mountCount++;
        if (holdActivation) await new Promise(resolve => { releaseActivation = resolve; });
      }
    },
  });
  const select = { value: '', append() {} }, button = {}, status = { textContent: '' };
  const handlers = new Map();
  const dialog = {
    removed: false,
    querySelector: selector => selector === 'select' ? select : selector === '[type="button"]' ? button : status,
    addEventListener: (type, callback) => handlers.set(type, callback),
    showModal() {}, remove() { this.removed = true; },
    close() { handlers.get('close')?.(); },
  };
  const settings = {
    source: { presetId: 'saved-immersed-basin', label: 'Whole saved basin' },
    domControls: {
      'volume-physical-mode': { value: '2' },
      'volume-emitter-source-law': { value: 'immersed-source' },
      'volume-pressure-solver': { value: 'converged-open-top' },
      'volume-advection-scheme': { value: 'maccormack' },
      'volume-time-step': { value: 'uniform' },
    },
  };
  const context = {
    // The fluid route is already up unless coldBoot; a scene without it boots it first (fire-boot.mjs).
    volumePrototype: coldBoot ? null : {},
    initKaminosVolumeRoute: () => { bootCalls++; return new Promise((resolve, reject) => {
      boot = { resolve: () => { context.volumePrototype = {}; resolve(); }, reject }; }); },
    structuredClone, AbortController, resolveFlameLightingRoute,
    document: { createElement: type => type === 'dialog' ? dialog : {}, body: { append() {} } },
    fetch: async () => ({ ok: true, json: async () => ({ entries: [{ presetId: 'saved-immersed-basin' }] }) }),
    validateVolumeSettingsPresetIndex() {},
    activeSceneComposition: null, authoringBusy: false, sceneSaveBlockedByFailedRestore: false,
    scenePlacementTools: { edits }, firstFlameFieldState: () => field,
    loadAuthoredFlameBasin: () => (basinLoads++, new Promise((resolve, reject) => { pending = { resolve: () => resolve(settings), reject }; })),
    COMPOSITION_SCHEMA: 'scene-composition', FLAME_EMITTER_ID: 'flame-emitter',
    setActiveSceneObject() {}, setInfo() {},
  };
  edits.subscribe(() => { context.activeSceneComposition = field.composition; });
  const guardStart = source.indexOf('function assertSceneConstructionAvailable()');
  const guardEnd = source.indexOf('function checkedObjectData(', guardStart);
  runInNewContext(source.slice(guardStart, guardEnd) + source.slice(start, end) + '\nglobalThis.openDialog = openFirstFlameFieldDialog;', context);
  return { context, dialog, button, select, status, edits, settings,
    read: () => field, mounts: () => mountCount, pending: () => pending,
    boot: () => boot, bootCalls: () => bootCalls, basinLoads: () => basinLoads,
    releaseActivation: () => releaseActivation() };
}

test('selection change and a second Add cannot steal cancellation from pending activation', async () => {
  const f = fixture({ holdActivation: true });
  await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
  const first = f.button.onclick({ target: f.button }); f.pending().resolve();
  await new Promise(setImmediate);
  assert.equal(f.edits.state().active.id, '@first-flame-field');
  assert.equal(f.mounts(), 1);
  f.select.value = 'another-saved-immersed-basin'; f.select.onchange();
  // Direct invocation also tests re-entry if a caller bypasses disabled controls.
  await f.button.onclick({ target: f.button });
  f.dialog.close(); f.releaseActivation(); await first;
  assert.equal(f.read().sourcePresent, false, 'dismissal must cancel the original pending activation');
  assert.equal(f.read().composition, null);
  assert.equal(f.edits.state().active, null);
  assert.equal(f.edits.state().undoCount, 0, 'abandoned creation must not commit');
  assert.equal(f.mounts(), 1, 'a second handler must not begin another activation');
  await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
  const retry = f.button.onclick({ target: f.button }); f.pending().resolve();
  await new Promise(setImmediate);
  assert.equal(f.select.disabled, true);
  assert.equal(f.button.disabled, true);
  f.releaseActivation(); await retry;
  assert.equal(f.read().sourcePresent, true);
  assert.equal(f.edits.state().undoCount, 1);
});

for (const lateResult of ['resolve', 'reject']) {
  test(`dismissed Add Flame ignores late basin ${lateResult}, then deliberate retry succeeds`, async () => {
    const f = fixture();
    await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
    const first = f.button.onclick({ target: f.button });
    assert.equal(f.context.authoringBusy, true);
    f.dialog.close(); assert.equal(f.dialog.removed, true);
    if (lateResult === 'resolve') f.pending().resolve();
    else f.pending().reject(Error('basin response failed after dismissal'));
    await first;
    assert.equal(f.read().sourcePresent, false, 'dismissed loading must not create a source');
    assert.equal(f.read().composition, null);
    assert.equal(f.mounts(), 0, 'dismissed loading must not begin activation');
    assert.equal(f.edits.state().undoCount, 0);
    assert.equal(f.edits.state().active, null);
    assert.equal(f.context.authoringBusy, false);
    assert.equal(f.status.textContent, '', 'detached dialog must not receive a late error');
    await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
    const retry = f.button.onclick({ target: f.button }); f.pending().resolve(); await retry;
    assert.equal(f.read().sourcePresent, true);
    assert.equal(f.mounts(), 1);
    assert.equal(f.edits.state().undoCount, 1);
  });
}

for (const lateBoot of ['resolve', 'reject']) {
  test(`a scene without fire: dismissing Add Flame while the fluid boots (late ${lateBoot}) adds nothing, then a retry adds it`, async () => {
    const f = fixture({ coldBoot: true });
    await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
    const first = f.button.onclick({ target: f.button });
    await new Promise(setImmediate);
    assert.equal(f.bootCalls(), 1, 'the add boots the fluid route');
    assert.equal(f.context.authoringBusy, true, 'authoring is held while the fluid boots');
    f.dialog.close();
    if (lateBoot === 'resolve') f.boot().resolve(); else f.boot().reject(Error('no adapter'));
    await first;
    assert.equal(f.basinLoads(), 0, 'a dismissed add does not go on to load the basin');
    assert.equal(f.read().sourcePresent, false);
    assert.equal(f.mounts(), 0);
    assert.equal(f.edits.state().active, null);
    assert.equal(f.edits.state().undoCount, 0);
    assert.equal(f.context.authoringBusy, false);
    await f.context.openDialog(); f.select.value = 'saved-immersed-basin';
    const retry = f.button.onclick({ target: f.button });
    await new Promise(setImmediate);
    if (lateBoot === 'reject') { assert.equal(f.bootCalls(), 2, 'a failed boot is tried again'); f.boot().resolve(); }
    else assert.equal(f.bootCalls(), 1, 'a booted route is reused');
    await new Promise(setImmediate); f.pending().resolve(); await retry;
    assert.equal(f.read().sourcePresent, true);
    assert.equal(f.edits.state().undoCount, 1);
  });
}
