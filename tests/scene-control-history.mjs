import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { installSceneControlHistory } from '../scene-control-history.mjs';

class Control extends EventTarget {
  fire(type, init = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { configurable: true, value });
    this.dispatchEvent(event);
    return event;
  }
}

function fixture(admit = () => {}, onError = () => {}) {
  let value = { recipe: { enabled: true, outerRadius: 0.8 }, radius: 0.24, flow: 0.8 };
  const control = new Control();
  control.type = 'range';
  const edits = createSceneEdits({ read: () => null, write() {}, admit });
  edits.register('@burner', {
    read: () => structuredClone(value),
    write: next => { value = structuredClone(next); },
    check: next => {
      if (!Number.isFinite(next?.radius) || !Number.isFinite(next?.flow) || !Number.isFinite(next?.recipe?.outerRadius)) {
        throw new Error('burner history values must be finite');
      }
      return structuredClone(next);
    },
  });
  const history = installSceneControlHistory({
    controls: [control], edits, id: '@burner', label: 'Adjust Burner',
    read: () => structuredClone(value), write: next => { value = structuredClone(next); },
    onError,
  });
  return { control, edits, history, get value() { return value; }, set value(next) { value = structuredClone(next); } };
}

test('one continuous control gesture records once and undo/redo restore the whole burner state', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('pointerdown', { button: 0 });
  f.value.radius = 0.31;
  f.control.fire('input');
  f.value.radius = 0.39;
  f.control.fire('input');
  f.value.flow = 1.2;
  f.control.fire('change');

  assert.equal(f.edits.state().undoCount, 1);
  assert.equal(f.edits.undo(), true);
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.redo(), true);
  assert.deepEqual(f.value, { ...before, radius: 0.39, flow: 1.2 });
});

test('unchanged controls add no entry and cancel restores the pre-gesture value', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('focusin');
  f.control.fire('change');
  assert.equal(f.edits.state().undoCount, 0);

  f.control.fire('pointerdown', { button: 0 });
  f.value.flow = 2;
  f.control.fire('input');
  f.control.fire('pointercancel');
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.state().undoCount, 0);
});

test('keyboard slider steps each commit cleanly and Escape restores an uncommitted gesture', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('focusin');
  f.control.fire('keydown', { key: 'ArrowRight' });
  f.value.radius = 0.25;
  f.control.fire('input');
  f.control.fire('keyup', { key: 'ArrowRight' });
  assert.equal(f.edits.state().undoCount, 1);
  assert.equal(f.edits.undo(), true);
  assert.deepEqual(f.value, before);

  f.control.fire('keydown', { key: 'ArrowRight' });
  f.value.radius = 0.4;
  f.control.fire('keydown', { key: 'Escape' });
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.state().undoCount, 0);
});

test('a change rejected by the shared edit gate is rolled back and reported', () => {
  let admitted = true, failure;
  const f = fixture(() => { if (!admitted) throw new Error('authoring action is busy'); }, error => { failure = error; });
  const before = structuredClone(f.value);
  f.control.fire('pointerdown', { button: 0 });
  f.value.radius = 0.5;
  admitted = false;
  f.control.fire('change');
  assert.deepEqual(f.value, before);
  assert.match(failure.message, /busy/);
  assert.equal(f.edits.state().undoCount, 0);
});
