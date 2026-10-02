import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlSlots } from '../authoring-workspace.mjs';

class Node extends EventTarget {
  children = []; parent = null;
  constructor(id) { super(); this.id = id; }
  append(node) { this.insert(node, this.children.length); }
  insert(node, index) {
    if (node.parent) {
      const old = node.parent.children.indexOf(node);
      if (node.parent === this && old < index) index--;
      node.parent.children.splice(old, 1);
    }
    node.parent = this; this.children.splice(index, 0, node);
  }
  before(node) { this.parent.insert(node, this.parent.children.indexOf(this)); }
  after(node) { this.parent.insert(node, this.parent.children.indexOf(this) + 1); }
}
const document = { createComment: () => new Node('marker') };
const ids = parent => parent.children.filter(node => node.id !== 'marker').map(node => node.id);

test('workspace roundtrip preserves bound input identity, live value and original order', () => {
  const legacy = new Node('legacy'), inspector = new Node('inspector');
  const before = new Node('before'), control = new Node('intensity'), after = new Node('after');
  legacy.append(before); legacy.append(control); legacy.append(after);
  let changes = 0; control.addEventListener('input', () => changes++); control.value = 120;
  const slots = createControlSlots(document, [{ node: control, destination: inspector }]);
  slots.showAuthoring(); control.value = 170; control.dispatchEvent(new Event('input'));
  slots.showWorkbench(); assert.deepEqual(ids(legacy), ['before', 'intensity', 'after']);
  assert.equal(legacy.children.find(node => node.id === 'intensity'), control);
  assert.equal(control.value, 170); assert.equal(changes, 1);
  slots.showAuthoring(); slots.showAuthoring(); assert.deepEqual(ids(inspector), ['intensity']);
  control.dispatchEvent(new Event('input')); assert.equal(changes, 2);
});

test('nested document commands return to their original toolbar when both move', () => {
  const viewport = new Node('viewport'), inspector = new Node('inspector'), header = new Node('header');
  const toolbar = new Node('toolbar'), save = new Node('save'), gizmo = new Node('gizmo');
  toolbar.append(save); toolbar.append(gizmo); viewport.append(toolbar);
  const slots = createControlSlots(document, [{ node: save, destination: header }, { node: toolbar, destination: inspector }]);
  slots.showAuthoring(); assert.equal(save.parent, header); assert.equal(toolbar.parent, inspector);
  slots.showWorkbench(); assert.equal(save.parent, toolbar); assert.equal(toolbar.parent, viewport);
  assert.deepEqual(ids(toolbar), ['save', 'gizmo']);
});
