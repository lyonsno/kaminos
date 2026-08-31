import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const layoutSource = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const layoutModule = await import('../volume-cockpit-layout.mjs');

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

console.log('volume cockpit layout editor contracts passed');
