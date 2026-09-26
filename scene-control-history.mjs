const clone = value => structuredClone(value);
const valueKeys = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

/** Join native control changes to the shared scene edit ledger at their commit boundary. */
export function installSceneControlHistory({ controls, edits, id, label = 'Edit control', read, write, onError = () => {} }) {
  let pending = false;
  let before;
  let owner = null;
  const listeners = [];
  const add = (control, type, listener, options) => {
    control.addEventListener(type, listener, options);
    listeners.push(() => control.removeEventListener(type, listener, options));
  };

  function rollback() {
    if (!pending) return false;
    const previous = before;
    pending = false; before = undefined; owner = null;
    try {
      if (JSON.stringify(previous) !== JSON.stringify(read())) write(clone(previous));
    }
    catch (error) { onError(error); return false; }
    return true;
  }

  function commit() {
    if (!pending) return false;
    const previous = before;
    pending = false; before = undefined; owner = null;
    try { return edits.recordApplied(id, previous, label); }
    catch (error) {
      try { write(clone(previous)); }
      catch (restoreError) { onError(restoreError); }
      onError(error);
      return false;
    }
  }

  function capture(event) {
    if (pending && owner !== event.currentTarget) commit();
    if (pending) return true;
    try {
      edits.assertCanRecordApplied(id);
      before = clone(read());
      owner = event.currentTarget;
      pending = true;
      return true;
    } catch (error) {
      event.preventDefault?.();
      onError(error);
      return false;
    }
  }

  for (const control of controls) {
    add(control, 'pointerdown', event => {
      if (event.button === undefined || event.button === 0) capture(event);
    }, true);
    add(control, 'focusin', capture, true);
    add(control, 'keydown', event => {
      if (event.key === 'Escape') { if (owner === event.currentTarget) rollback(); return; }
      if (valueKeys.has(event.key)) capture(event);
    }, true);
    add(control, 'change', event => { if (!pending || owner === event.currentTarget) commit(); });
    add(control, 'blur', event => { if (owner === event.currentTarget) commit(); });
    add(control, 'pointercancel', event => { if (owner === event.currentTarget) rollback(); });
    add(control, 'keyup', event => {
      if (owner === event.currentTarget && valueKeys.has(event.key) && control.type === 'range') commit();
    });
  }

  return {
    commit,
    cancel: rollback,
    state: () => ({ pending, id: pending ? id : null }),
    dispose() { rollback(); for (const remove of listeners.splice(0)) remove(); },
  };
}
