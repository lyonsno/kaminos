import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const layoutSource = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const retiredMigrationSource = readFileSync(join(root, 'volume-retired-control-migration.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const layoutModule = await import('../volume-cockpit-layout.mjs');
const executableLayoutSource = layoutSource
  .replace(
    "import { migrateRetiredVolumeCockpitLayoutDocument } from './volume-retired-control-migration.mjs';",
    retiredMigrationSource,
  )
  .replace(
  'class VolumeCockpitLayoutEditor {',
  'export class VolumeCockpitLayoutEditor {',
);
assert.notEqual(executableLayoutSource, layoutSource, 'the exact layout editor implementation is exposed only inside this executable contract');
const executableLayoutModule = await import(`data:text/javascript;base64,${Buffer.from(executableLayoutSource).toString('base64')}`);

{
  const Editor = executableLayoutModule.VolumeCockpitLayoutEditor;
  const toolbarIds = [
    'volume-cockpit-layout-toolbar',
    'volume-cockpit-layout-select',
    'volume-cockpit-layout-name',
    'volume-cockpit-layout-new',
    'volume-cockpit-layout-edit',
    'volume-cockpit-layout-add-group',
    'volume-cockpit-layout-reset',
    'volume-cockpit-layout-status',
  ];
  const toolbarNodes = new Map(toolbarIds.map(id => [id, {
    id,
    addEventListener() {},
    dataset: {},
  }]));
  const documentRef = {
    getElementById(id) { return toolbarNodes.get(id) || null; },
  };
  const receiverSensitiveFetch = async function receiverSensitiveFetch() {
    if (this !== undefined) throw new TypeError('receiver-sensitive-fetch-illegal-invocation');
    return {
      ok: true,
      status: 200,
      async json() { return { identity: 'receiver-sensitive-fetch-receipt.v1' }; },
    };
  };
  const receiverEditor = new Editor({
    documentRef,
    schema: {},
    authorableControls: [],
    sourceDefault: {},
    fetchImpl: receiverSensitiveFetch,
  });
  const receiverReceipt = await receiverEditor.requestJson('/api/receiver-sensitive-fetch');
  assert.equal(
    receiverReceipt.identity,
    'receiver-sensitive-fetch-receipt.v1',
    'an injected host fetch callable must not be rebound to the layout editor instance',
  );
}

for (const exportName of [
  'VOLUME_COCKPIT_LAYOUT_IDENTITY',
  'validateVolumeCockpitLayoutDocument',
  'reconcileVolumeCockpitLayoutDocument',
  'reorderVolumeCockpitLayoutIds',
  'classifyVolumeCockpitLayoutStoreFailure',
]) {
  assert.ok(layoutModule[exportName], `layout editor contract is missing ${exportName}`);
}

const canonicalIds = [...schema.controls, ...schema.rendererControls].map(control => control.key);
const authorableIds = canonicalIds.filter(id => id !== 'volume-topology-shell-mode');
const baseLayout = {
  identity: layoutModule.VOLUME_COCKPIT_LAYOUT_IDENTITY,
  layoutId: 'operator-layout',
  label: 'Operator Layout',
  groups: [
    {
      id: 'primary-controls',
      label: 'Primary Controls',
      surface: 'primary',
      collapsed: false,
      controlIds: authorableIds,
    },
  ],
};

const accepted = layoutModule.validateVolumeCockpitLayoutDocument({
  document: baseLayout,
  authorableControlIds: authorableIds,
});
assert.equal(accepted.identity, layoutModule.VOLUME_COCKPIT_LAYOUT_IDENTITY);
assert.equal(accepted.controlCount, authorableIds.length);
assert.deepEqual(accepted.missingControlIds, []);

const duplicate = structuredClone(baseLayout);
duplicate.groups.push({
  id: 'duplicate-controls',
  label: 'Duplicate Controls',
  surface: 'authored-mix',
  collapsed: false,
  controlIds: [authorableIds[0]],
});
assert.throws(
  () => layoutModule.validateVolumeCockpitLayoutDocument({ document: duplicate, authorableControlIds: authorableIds }),
  /duplicate-control/,
  'one control cannot occupy two layout groups',
);

const unknown = structuredClone(baseLayout);
unknown.groups[0].controlIds.push('volume-authoritative-looking-unknown');
assert.throws(
  () => layoutModule.validateVolumeCockpitLayoutDocument({ document: unknown, authorableControlIds: authorableIds }),
  /unknown-control/,
  'a stale or invented control id cannot silently retain layout authority',
);

const older = structuredClone(baseLayout);
const newlyAddedControlId = older.groups[0].controlIds.pop();
const reconciled = layoutModule.reconcileVolumeCockpitLayoutDocument({
  document: older,
  authorableControlIds: authorableIds,
});
assert.deepEqual(reconciled.newControlIds, [newlyAddedControlId]);
assert.equal(reconciled.document.groups.at(-1).label, 'New controls');
assert.deepEqual(reconciled.document.groups.at(-1).controlIds, [newlyAddedControlId]);
assert.equal(reconciled.document.groups.at(-1).surface, 'primary');

const olderWithHiddenCatchBasin = structuredClone(older);
olderWithHiddenCatchBasin.groups.push({
  id: 'new-controls',
  label: 'Later',
  surface: 'authored-mix',
  collapsed: true,
  controlIds: [newlyAddedControlId],
});
const secondNewControlId = olderWithHiddenCatchBasin.groups[0].controlIds.pop();
const reconciledAgain = layoutModule.reconcileVolumeCockpitLayoutDocument({
  document: olderWithHiddenCatchBasin,
  authorableControlIds: authorableIds,
});
const visibleCatchBasin = reconciledAgain.document.groups.find(group => group.id === 'new-controls');
assert.equal(visibleCatchBasin.label, 'New controls', 'schema additions restore the reserved catch-basin label');
assert.equal(visibleCatchBasin.surface, 'primary', 'schema additions restore the catch basin to the visible primary surface');
assert.equal(visibleCatchBasin.collapsed, false, 'schema additions expand the catch basin');
assert.deepEqual(
  visibleCatchBasin.controlIds,
  [newlyAddedControlId, secondNewControlId],
  'later schema additions remain visible beside earlier ungrouped controls',
);

assert.equal(
  layoutModule.classifyVolumeCockpitLayoutStoreFailure({ status: 503 }),
  'availability',
  'a server outage disables only layout persistence',
);
assert.equal(
  layoutModule.classifyVolumeCockpitLayoutStoreFailure({ networkFailure: true }),
  'availability',
  'a network outage disables only layout persistence',
);
assert.equal(
  layoutModule.classifyVolumeCockpitLayoutStoreFailure({ status: 404 }),
  'structural',
  'a missing active artifact remains an integrity failure rather than an outage fallback',
);
assert.equal(
  layoutModule.classifyVolumeCockpitLayoutStoreFailure({ status: 404, operation: 'index' }),
  'availability',
  'a missing layout-index endpoint cannot take down the base cockpit',
);
assert.equal(
  layoutModule.classifyVolumeCockpitLayoutStoreFailure({ status: 403, operation: 'read' }),
  'availability',
  'a layout-store permission failure cannot take down the base cockpit',
);

assert.match(index, /id="volume-cockpit-layout-toolbar"[^>]+data-volume-basin-drive-ignore/, 'layout editing is an explicit non-canonical cockpit surface');
assert.match(index, /observeVolumeBasinDriveCockpitEvent\(event\)[\s\S]*closest\?\.\('\[data-volume-basin-drive-ignore\]'\)/, 'layout gestures cannot enter the Basin Atlas control-event stream');
assert.match(layoutSource, /querySelectorAll\(VOLUME_CONTROL_SELECTOR\)[\s\S]*data-volume-cockpit-layout-ui/, 'layout-owned inputs are excluded from canonical preset discovery');
assert.match(index, /id="volume-cockpit-layout-edit"/, 'the cockpit exposes an explicit edit-mode command');
assert.match(index, /id="volume-cockpit-layout-add-group"/, 'edit mode can create operator-authored groups');
assert.match(index, /id="volume-cockpit-layout-reset"/, 'the source-default layout can be restored');
assert.match(layoutSource, /pointerdown[\s\S]*pointermove[\s\S]*pointerup/, 'layout movement uses pointer gestures');
assert.match(layoutSource, /volume-layout-control-grip/, 'control movement is restricted to explicit edit-mode grips');
assert.doesNotMatch(layoutSource, /\.draggable\s*=|setAttribute\(['"]draggable/, 'native drag-and-drop does not own the cockpit gesture');
assert.match(layoutSource, /\/api\/volume-cockpit-layouts/, 'named layout autosave uses the shared caller-selected store');
assert.match(
  layoutSource,
  /volume-cockpit-layout-select'\]\.addEventListener\('change',[\s\S]*loadLayout\(event\.target\.value,\s*\{\s*activate:\s*true\s*\}/,
  'selecting an existing named layout must persist it as the active layout without requiring a later edit',
);
assert.match(
  layoutSource,
  /const cleanup\s*=\s*\(\)\s*=>\s*\{[\s\S]*removeEventListener\('pointercancel', cancel\)[\s\S]*volume-layout-dragging[\s\S]*const cancel\s*=\s*\(\)\s*=>\s*cleanup\(\)[\s\S]*addEventListener\('pointercancel', cancel\)/,
  'a canceled pointer gesture has an explicit cleanup-only path',
);
assert.match(
  layoutSource,
  /closest\('\.volume-layout-groups'\)[\s\S]*volumeLayoutSurface/,
  'group dragging can target an empty surface or the end of a surface, not only another group shell',
);
assert.match(
  layoutSource,
  /label\.readOnly\s*=\s*!editing[\s\S]*label\.tabIndex\s*=\s*editing\s*\?\s*0\s*:\s*-1/,
  'group names are semantically locked outside explicit edit mode',
);
assert.match(
  layoutSource,
  /rename:\s*\(groupId, label\)\s*=>\s*\{[\s\S]*if\s*\(!this\.editing\)\s*return/,
  'a synthetic change event cannot bypass edit-mode authority',
);
assert.match(
  layoutSource,
  /catch\s*\(error\)\s*\{[\s\S]*VolumeCockpitLayoutAvailabilityError[\s\S]*disablePersistence/,
  'layout-store unavailability resolves through an explicit degraded editor state',
);
assert.match(
  layoutSource,
  /persistenceAvailable:\s*false[\s\S]*storedLayoutLoaded:\s*false[\s\S]*fallbackApplied:\s*true/,
  'the degraded receipt names the unpersisted source-default fallback without pretending a stored layout loaded',
);

assert.deepEqual(
  layoutModule.reorderVolumeCockpitLayoutIds({ orderedIds: ['a', 'b', 'c'], itemId: 'a', beforeId: null }),
  ['b', 'c', 'a'],
  'dropping after the final item moves to the true end',
);
assert.deepEqual(
  layoutModule.reorderVolumeCockpitLayoutIds({ orderedIds: ['a', 'b', 'c'], itemId: 'a', beforeId: 'b' }),
  ['a', 'b', 'c'],
  'dropping immediately before the original successor is a stable no-op',
);
assert.deepEqual(
  layoutModule.reorderVolumeCockpitLayoutIds({ orderedIds: ['a', 'b', 'c'], itemId: 'b', beforeId: 'b' }),
  ['a', 'b', 'c'],
  'dropping an item over itself cannot unexpectedly send it to the end',
);

function layoutDocument(layoutId, label, orderedControlIds) {
  return {
    identity: layoutModule.VOLUME_COCKPIT_LAYOUT_IDENTITY,
    layoutId,
    label,
    groups: [{
      id: 'controls',
      label: 'Controls',
      surface: 'primary',
      collapsed: false,
      controlIds: [...orderedControlIds],
    }],
  };
}

function createLayoutStore({ layouts = [], activeLayoutId = null } = {}) {
  return {
    layouts: new Map(layouts.map(layout => [layout.layoutId, structuredClone(layout)])),
    activeLayoutId,
    layoutWrites: [],
    activations: [],
  };
}

function layoutIndex(store) {
  return {
    identity: 'kaminos.volume.cockpit-layout-index.v1',
    storePath: '/contract/layout-store',
    activeLayoutId: store.activeLayoutId,
    entries: [...store.layouts.values()].map(layout => ({
      layoutId: layout.layoutId,
      label: layout.label,
    })),
  };
}

function createExecutableEditor({ store, sourceDefault }) {
  const Editor = executableLayoutModule.VolumeCockpitLayoutEditor;
  const editor = Object.create(Editor.prototype);
  Object.assign(editor, {
    schema: { retiredControls: [] },
    authorableControlIds: ['control-a', 'control-b'],
    sourceDefault: structuredClone(sourceDefault),
    layout: null,
    editing: false,
    saveGeneration: 0,
    loadGeneration: 0,
    saveQueue: Promise.resolve(),
    index: null,
    persistenceAvailable: true,
    apply() {},
    syncIndex() {},
    setEditing(editing) { this.editing = Boolean(editing); },
    status() {},
    async requestJson(url, options = {}) {
      if (url === '/api/volume-cockpit-layouts' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        const layout = structuredClone(body.layout);
        store.layouts.set(layout.layoutId, layout);
        store.layoutWrites.push(structuredClone(layout));
        if (body.activate) store.activeLayoutId = layout.layoutId;
        return {
          identity: 'kaminos.volume.cockpit-layout-write-receipt.v1',
          layoutId: layout.layoutId,
          activeLayoutId: store.activeLayoutId,
        };
      }
      if (url === '/api/volume-cockpit-layout-activation' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        if (!store.layouts.has(body.layoutId)) throw new Error(`volume-cockpit-layout-not-found:${body.layoutId}`);
        store.activeLayoutId = body.layoutId;
        store.activations.push(body.layoutId);
        return {
          identity: 'kaminos.volume.cockpit-layout-activation-receipt.v1',
          layoutId: body.layoutId,
          activeLayoutId: store.activeLayoutId,
        };
      }
      if (url === '/api/volume-cockpit-layouts') return layoutIndex(store);
      if (url.startsWith('/api/volume-cockpit-layout?id=')) {
        const layoutId = decodeURIComponent(url.split('=', 2)[1]);
        const layout = store.layouts.get(layoutId);
        if (!layout) throw new Error(`volume-cockpit-layout-not-found:${layoutId}`);
        return { layout: structuredClone(layout) };
      }
      throw new Error(`unexpected-layout-contract-request:${url}`);
    },
  });
  return editor;
}

const sourceDefaultLayout = layoutDocument('source-default', 'Source default', ['control-a', 'control-b']);
const emptyStore = createLayoutStore();
const emptyStoreEditor = createExecutableEditor({ store: emptyStore, sourceDefault: sourceDefaultLayout });
const emptyStorePhases = [];
const emptyStoreReceipt = await emptyStoreEditor.initialize({ onPhase: phase => emptyStorePhases.push(phase) });
assert.equal(emptyStoreReceipt.storedLayoutLoaded, false, 'an empty valid index resolves after persisting the source default');
assert.equal(emptyStore.activeLayoutId, 'source-default', 'empty-store initialization activates the persisted source default');
assert.deepEqual(
  emptyStorePhases,
  ['editor-apply', 'store-index', 'store-source-default-save', 'editor-effective'],
  'healthy empty-store initialization preserves the exact pre-API and persistence phase sequence',
);

const layoutA = layoutDocument('layout-a', 'Layout A', ['control-a', 'control-b']);
const layoutB = layoutDocument('layout-b', 'Layout B', ['control-b', 'control-a']);
const selectionStore = createLayoutStore({ layouts: [layoutA, layoutB], activeLayoutId: 'layout-a' });
const firstEditor = createExecutableEditor({ store: selectionStore, sourceDefault: sourceDefaultLayout });
const firstReceipt = await firstEditor.initialize();
assert.equal(firstReceipt.storedLayoutLoaded, true, 'a valid active stored layout resolves as loaded');
assert.equal(firstEditor.layout.layoutId, 'layout-a');
assert.equal(selectionStore.layoutWrites.length, 0, 'loading the active stored layout cannot rewrite its source artifact');

await firstEditor.loadLayout('layout-b', { activate: true });
assert.equal(selectionStore.activeLayoutId, 'layout-b', 'selecting inactive B durably changes the store active pointer');
assert.deepEqual(selectionStore.activations, ['layout-b'], 'selection uses the pointer-only activation contract');
assert.equal(selectionStore.layoutWrites.length, 0, 'selecting inactive B cannot rewrite B as a side effect of activation');
const freshEditor = createExecutableEditor({ store: selectionStore, sourceDefault: sourceDefaultLayout });
const freshReceipt = await freshEditor.initialize();
assert.equal(freshReceipt.storedLayoutLoaded, true);
assert.equal(freshEditor.layout.layoutId, 'layout-b', 'fresh initialization loads the newly activated layout B');
assert.deepEqual(freshEditor.layout.groups[0].controlIds, ['control-b', 'control-a']);

const historicalProjectedLayout = layoutDocument('historical-layout', 'Historical layout', ['control-a']);
const historicalStore = createLayoutStore({ layouts: [historicalProjectedLayout], activeLayoutId: 'historical-layout' });
const historicalEditor = createExecutableEditor({ store: historicalStore, sourceDefault: sourceDefaultLayout });
const historicalReceipt = await historicalEditor.initialize();
assert.equal(historicalReceipt.storedLayoutLoaded, true, 'ordinary startup loads the projected historical layout');
assert.deepEqual(
  historicalEditor.layout.groups.flatMap(group => group.controlIds),
  ['control-a', 'control-b'],
  'startup reconciliation exposes a newly authorable control in memory',
);
assert.equal(
  historicalStore.layoutWrites.length,
  0,
  'startup reconciliation cannot persist over the historical source artifact',
);
assert.equal(historicalStore.activeLayoutId, 'historical-layout', 'startup preserves the raw historical active pointer');
historicalEditor.layout.label = 'Historical layout explicitly edited';
await historicalEditor.save();
assert.equal(historicalStore.layoutWrites.length, 1, 'an explicit edit is the first historical-layout content write');

const retiredHistoricalLayout = layoutDocument(
  'retired-historical-layout',
  'Retired historical layout',
  ['retired-control', 'control-a', 'control-b'],
);
const retiredHistoricalStore = createLayoutStore({
  layouts: [retiredHistoricalLayout],
  activeLayoutId: retiredHistoricalLayout.layoutId,
});
const retiredHistoricalEditor = createExecutableEditor({
  store: retiredHistoricalStore,
  sourceDefault: sourceDefaultLayout,
});
retiredHistoricalEditor.schema.retiredControls = [{
  axis: 'domControls',
  key: 'retired-control',
  param: 'volume_retired_control',
  tagName: 'INPUT',
  type: 'checkbox',
}];
const retiredHistoricalReceipt = await retiredHistoricalEditor.initialize();
assert.equal(retiredHistoricalReceipt.storedLayoutLoaded, true);
assert.deepEqual(retiredHistoricalReceipt.retiredControlIds, ['retired-control']);
assert.deepEqual(
  retiredHistoricalEditor.layout.groups.flatMap(group => group.controlIds),
  ['control-a', 'control-b'],
  'cockpit initialization removes only the schema-declared retired control and retains every active control',
);
assert.equal(
  retiredHistoricalStore.layoutWrites.length,
  0,
  'startup receipts the projected historical layout without overwriting its immutable source artifact',
);

firstEditor.layout.label = 'Layout B edited';
await firstEditor.save();
assert.equal(selectionStore.layoutWrites.length, 1, 'an explicit edit still persists the selected layout content');
assert.equal(selectionStore.layouts.get('layout-b').label, 'Layout B edited');

assert.match(
  index,
  /async function initKaminosVolumeRoute\(\)[\s\S]*await volumeCockpitLayoutReady;[\s\S]*volume-render-scale-full[\s\S]*volume-toggle'\)\.addEventListener\('click'/,
  'the ordinary Volume listeners and activation toggle remain downstream of the resolving layout promise',
);

console.log('volume cockpit layout editor contracts passed');
