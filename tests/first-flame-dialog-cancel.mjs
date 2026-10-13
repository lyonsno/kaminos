// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSceneEdits } from '../scene-edit-session.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function addFirstFlameField(');
const end = source.indexOf('function installAuthoringParameterEditing()', start);

function fixture() {
  let field = { composition: null, settings: {}, sourcePresent: false, route: {} };
  let mountCount = 0, pending;
  const edits = createSceneEdits({ read: () => null, write: () => {} });
  edits.register('@first-flame-field', {
    read: () => field, check: value => value,
    write: async value => { field = value; if (value.sourcePresent) mountCount++; },
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
      'volume-emitter-source-law': { value: 'immersed-source' },
      'volume-pressure-solver': { value: 'converged-open-top' },
      'volume-advection-scheme': { value: 'maccormack' },
      'volume-time-step': { value: 'uniform' },
    },
  };
  const context = {
    structuredClone, AbortController,
    document: { createElement: type => type === 'dialog' ? dialog : {}, body: { append() {} } },
    fetch: async () => ({ ok: true, json: async () => ({ entries: [{ presetId: 'saved-immersed-basin' }] }) }),
    validateVolumeSettingsPresetIndex() {}, assertSceneConstructionAvailable() {},
    activeSceneComposition: null, authoringBusy: false,
    scenePlacementTools: { edits }, firstFlameFieldState: () => field,
    loadAuthoredFlameBasin: () => new Promise((resolve, reject) => { pending = { resolve: () => resolve(settings), reject }; }),
    COMPOSITION_SCHEMA: 'scene-composition', FLAME_EMITTER_ID: 'flame-emitter',
    setActiveSceneObject() {}, setInfo() {},
  };
  edits.subscribe(() => { context.activeSceneComposition = field.composition; });
  runInNewContext(source.slice(start, end) + '\nglobalThis.openDialog = openFirstFlameFieldDialog;', context);
  return { context, dialog, button, select, status, edits, settings,
    read: () => field, mounts: () => mountCount, pending: () => pending };
}

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
