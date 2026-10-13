// Application hooks retain renderer, registration and camera authority. This
// session scopes their resources to one owner-authored experiment.
export function createOwnerSceneSession(hooks) {
  for (const key of ['loadAsset', 'attach', 'remove', 'readView', 'setView', 'redraw', 'onFrame']) {
    if (typeof hooks?.[key] !== 'function') throw Error(`Scene host requires ${key}`);
  }
  const controller = new AbortController();
  const objects = new Map(), attaching = new Set(), pending = new Set(), frames = new Set(), cleanupErrors = [];
  let disposed = false, disposal;
  const active = () => {if (disposed) throw Error('Scene session is disposed');};
  const context = Object.freeze({signal: controller.signal, isCurrent: () => !disposed});

  async function remove(handle) {
    if (!handle.owned) return;
    try {await hooks.remove(handle);}
    catch (error) {cleanupErrors.push(error); throw error;}
  }

  async function adopt(handle) {
    if (!handle || typeof handle.id !== 'string' || !handle.id || !handle.root?.isObject3D
      || typeof handle.owned !== 'boolean') {
      throw Error('Scene host must return {id, root, owned} registration receipt');
    }
    if (objects.has(handle.root)) throw Error('Scene root is already in this session');
    // Preserve actual roots/clips, but freeze the custody fields against caller edits.
    handle = Object.freeze({...handle});
    if (disposed) {await remove(handle); throw Error('Scene session is disposed');}
    objects.set(handle.root, handle);
    return handle;
  }

  function acquire(operation) {
    const task = Promise.resolve().then(() => {active(); return operation(context);}).then(adopt);
    pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  }

  function onFrame(callback) {
    active();
    if (typeof callback !== 'function') throw TypeError('Frame callback must be callable');
    const entry = {enabled: true, unsubscribe: null};
    function cancel() {
      if (!entry.enabled) return;
      entry.enabled = false; frames.delete(entry);
      entry.unsubscribe?.();
    }
    entry.cancel = cancel; frames.add(entry);
    try {
      const unsubscribe = hooks.onFrame(frame => {if (!disposed && entry.enabled) callback(frame);});
      if (typeof unsubscribe !== 'function') throw Error('Scene host onFrame must return unsubscribe');
      entry.unsubscribe = unsubscribe;
      if (!entry.enabled || disposed) unsubscribe();
    } catch (error) {cancel(); throw error;}
    return cancel;
  }

  return Object.freeze({
    loadAsset: input => acquire(ctx => hooks.loadAsset(input, ctx)),
    attach(root, options = {}) {
      if (attaching.has(root)) return Promise.reject(Error('Scene root is already being attached'));
      attaching.add(root);
      const task = acquire(ctx => {
        if (objects.has(root)) throw Error('Scene root is already in this session');
        if (typeof options.owned !== 'boolean') throw Error('Attachment must explicitly choose owned or borrowed');
        return hooks.attach(root, options, ctx);
      });
      task.then(() => attaching.delete(root), () => attaching.delete(root));
      return task;
    },
    readView() {active(); return structuredClone(hooks.readView());},
    setView(view) {active(); return structuredClone(hooks.setView(structuredClone(view)));},
    redraw() {active(); return hooks.redraw();},
    onFrame,
    dispose() {
      if (!disposed) {
        disposed = true;
        controller.abort();
        for (const entry of [...frames]) {
          try {entry.cancel();} catch (error) {cleanupErrors.push(error);}
        }
        disposal = (async () => {
          // Loads receive cancellation immediately. A host which completes anyway
          // is awaited so its newly registered object can be released honestly.
          await Promise.allSettled([...pending]);
          for (const handle of objects.values()) {
            try {await remove(handle);} catch { /* Collected for the single close result. */ }
          }
          objects.clear();
          if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Scene session cleanup failed');
        })();
      }
      return disposal;
    },
  });
}
