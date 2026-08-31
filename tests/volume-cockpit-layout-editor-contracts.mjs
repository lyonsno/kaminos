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

console.log('volume cockpit layout editor contracts passed');
