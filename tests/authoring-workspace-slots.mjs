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

test('document commands remain in the shared header while object tools return to Workbench', () => {
  const viewport=new Node('viewport'),inspector=new Node('inspector'),header=new Node('header');
  const toolbar=new Node('toolbar'),save=new Node('save'),load=new Node('load');
  toolbar.append(save);toolbar.append(load);viewport.append(toolbar);
  let saves=0;save.addEventListener('click',()=>saves++);
  const slots=createControlSlots(document,[
    {node:save,destination:header,workbenchDestination:header},
    {node:load,destination:header,workbenchDestination:header},
    {node:toolbar,destination:inspector}]);
  for(let round=0;round<2;round++){
    slots.showAuthoring();slots.showWorkbench();
    assert.equal(toolbar.parent,viewport);
    assert.equal(save.parent,header,'Save is accessible without the hidden object toolbar');
    assert.equal(load.parent,header,'Load is accessible without the hidden object toolbar');
    assert.deepEqual(ids(header),['save','load']);
    save.dispatchEvent(new Event('click'));
  }
  assert.equal(saves,2,'one bound Save command survives both workspace transitions');
});

import fs from 'node:fs';

test('viewport toolbar owns Mode, Ground Snap, Transform menu, and Mesh Shading while Inspector owns progressive-disclosure state', () => {
  const workspaceJs = fs.readFileSync(new URL('../authoring-workspace.mjs', import.meta.url), 'utf8');
  const workspaceCss = fs.readFileSync(new URL('../authoring-workspace.css', import.meta.url), 'utf8');
  const repetitionJs = fs.readFileSync(new URL('../scene-repetition-inspector.mjs', import.meta.url), 'utf8');
  const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(workspaceJs, /authoring-object-tools/, 'Object tools drawer is removed from the bottom of the Selection inspector');
  assert.match(workspaceJs, /id="authoring-edit-mode"/, 'Viewport toolbar includes far-left Object/Edit Mode toggle');
  assert.match(workspaceJs, /id="authoring-snap-slot"/, 'Viewport toolbar includes ground snap slot next to gizmo tools');
  assert.match(workspaceJs, /id="authoring-transform-menu"/, 'Viewport toolbar includes Transform operations popover');
  assert.match(workspaceJs, /id="authoring-mesh-shading-slot"/, 'Viewport settings popover includes mesh diagnosis shading slot');
  assert.match(workspaceCss, /#authoring-inspector \[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/, 'Inspector enforces [hidden] over .btn display rules');
  assert.match(repetitionJs, /repetition-center-fields'\)\.hidden\s*=/, 'Repetition inspector hides center fields when inactive');
  assert.match(indexHtml, /input\.closest\('label'\)\.hidden\s*=\s*!burnInput\.checked/, 'Combustion inspector hides Emission gain when Burnable wood is unchecked');
  assert.match(indexHtml, /detail\.closest\('label'\)\.hidden\s*=\s*!setting\.enabled/, 'Render inspector hides Proxy detail when GI proxy is unchecked');
});
