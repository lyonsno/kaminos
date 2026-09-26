import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreSceneObjectGroups } from '../scene-membership-history.mjs';

test('restoring a removed object recovers its order inside a surviving group', () => {
  const groups = [
    { id: 'furniture', label: 'Furniture', objectIds: ['chair'] },
  ];
  const saved = [
    { id: 'furniture', label: 'Furniture', groupIndex: 0, objectIds: ['kiln', 'chair'] },
  ];

  assert.deepEqual(
    restoreSceneObjectGroups(groups, saved, 'kiln', ['kiln', 'chair']),
    [{ id: 'furniture', label: 'Furniture', objectIds: ['kiln', 'chair'] }],
  );
});

test('restoration preserves members added to a still-existing group after removal', () => {
  const groups = [
    { id: 'furniture', label: 'Furniture', objectIds: ['chair', 'vase'] },
  ];
  const saved = [
    { id: 'furniture', label: 'Furniture', groupIndex: 0, objectIds: ['kiln', 'chair'] },
  ];

  assert.deepEqual(
    restoreSceneObjectGroups(groups, saved, 'kiln', ['kiln', 'chair', 'vase']),
    [{ id: 'furniture', label: 'Furniture', objectIds: ['kiln', 'chair', 'vase'] }],
  );
});

test('restoring a pruned sole-member group returns it to its former group-list position', () => {
  const groups = [
    { id: 'lights', label: 'Lights', objectIds: ['lamp'] },
    { id: 'props', label: 'Props', objectIds: ['chair'] },
  ];
  const saved = [
    { id: 'kiln-group', label: 'Kiln', groupIndex: 1, objectIds: ['kiln'] },
  ];

  assert.deepEqual(
    restoreSceneObjectGroups(groups, saved, 'kiln', ['kiln', 'lamp', 'chair']).map(group => group.id),
    ['lights', 'kiln-group', 'props'],
  );
});
