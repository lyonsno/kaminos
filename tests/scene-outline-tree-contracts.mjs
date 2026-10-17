// kaminos-test: node
// The scene outliner is a tree: simulation fields own their emitters, groups
// own their members, everything else sits at the root, and a collapsed parent
// hides its descendants without changing selection or order.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneOutline, visibleOutlineRows} from '../scene-outline-tree.mjs';

const EMITTERS = {'flame-emitter': 'flame-field', 'local-liquid-emitter': 'water-field'};
const scene = {
  fields: [{id: 'flame-field', label: 'Fire & smoke'}, {id: 'water-field', label: 'Water simulation'}],
  groups: [{id: 'g1', objectIds: ['arm', 'base']}],
  objects: [
    {id: 'flame-source', type: 'flame-emitter'},
    {id: 'arm', type: 'glb'},
    {id: 'base', type: 'glb'},
    {id: 'rim', type: 'light'},
    {id: 'drip', type: 'local-liquid-emitter'},
  ],
  emitterFields: EMITTERS,
};
const shape = rows => rows.map(row => `${'  '.repeat(row.depth)}${row.kind}:${row.id}${row.childCount ? `(${row.childCount})` : ''}`);

test('fields own their emitters, groups own their members, the rest sit at the root', () => {
  assert.deepEqual(shape(buildSceneOutline(scene)), [
    'field:flame-field(1)',
    '  object:flame-source',
    'field:water-field(1)',
    '  object:drip',
    'group:g1(2)',
    '  object:arm',
    '  object:base',
    'object:rim',
  ]);
});

test('an emitter whose field is absent stays visible at the root', () => {
  const rows = buildSceneOutline({...scene, fields: []});
  assert.deepEqual(rows.filter(row => row.id === 'flame-source' || row.id === 'drip').map(row => row.depth), [0, 0]);
});

test('an emitter in a group stays with its group', () => {
  const rows = buildSceneOutline({...scene, groups: [{id: 'g1', objectIds: ['arm', 'flame-source']}]});
  const source = rows.find(row => row.id === 'flame-source');
  assert.equal(source.parentKey, 'group:g1');
  assert.equal(rows.find(row => row.id === 'flame-field').childCount, 0);
});

test('every object appears exactly once, even if listed by two groups', () => {
  const rows = buildSceneOutline({...scene, groups: [{id: 'g1', objectIds: ['arm']}, {id: 'g2', objectIds: ['arm', 'base']}]});
  const objectIds = rows.filter(row => row.kind === 'object').map(row => row.id).sort();
  assert.deepEqual(objectIds, ['arm', 'base', 'drip', 'flame-source', 'rim']);
});

test('collapsing a parent hides its descendants and keeps the rest in order', () => {
  const rows = buildSceneOutline(scene);
  const visible = visibleOutlineRows(rows, new Set(['field:flame-field', 'group:g1']));
  assert.deepEqual(visible.map(row => row.id), ['flame-field', 'water-field', 'drip', 'g1', 'rim']);
  assert.equal(visible.find(row => row.id === 'g1').collapsed, true);
  assert.equal(visible.find(row => row.id === 'water-field').collapsed, false);
});
