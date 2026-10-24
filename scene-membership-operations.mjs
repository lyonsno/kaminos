import {restoreSceneObjectGroups} from './scene-membership-history.mjs';

export const membershipEditTargetId = id => `@scene-membership:${encodeURIComponent(id)}`;

// Application membership and its chronological history share this instance.
// Domain adapters own root behavior; this service owns when it is invoked.
// Presentation callbacks are optional. No DOM, window, or page state is read.
export function createSceneMembershipOperations({
  scene, records, roots, domains = {},
  select = (ids, activeId) => scene.select(ids, activeId),
  createGroup = () => {},
  finishInteraction = () => {}, captureContext = () => ({}),
  changed = () => {}, status = () => {},
}) {
  let edits = null, unsubscribe = null;
  const targets = new Set(), compoundTargets = new Map();
  const adapters = new Map(Object.entries(domains));
  const domain = entry => adapters.get(entry.type) ?? {};
  const hasHistory = id => Boolean(edits?.hasHistoryEntry(membershipEditTargetId(id))
    || edits?.hasHistoryEntry(compoundTargets.get(id)));
  const dispose = entry => {
    const release = domain(entry).dispose;
    if (release) release(entry);
    else roots.dispose(entry.object);
  };

  function admit(entry, {index = null, activate = false, group = null, prepare = true} = {}) {
    scene.put(entry, {index});
    if (prepare) roots.prepare?.(entry);
    if (group) createGroup([entry.id], group.label, group);
    if (activate) select([entry.id], entry.id);
    changed({operation:'admit', entry});
    return entry;
  }

  function releaseUnreferenced() {
    scene.releaseUnreferenced(hasHistory, (_root, entry) => dispose(entry));
  }

  function snapshot(id) {
    const index = scene.objects.findIndex(entry => entry.id === id);
    if (index < 0) return null;
    const record = records.serialize(scene.objects[index]);
    if (!records.reloadable(record)) return null;
    return {
      record, index,
      groups: scene.groups.flatMap((group, groupIndex) => group.objectIds.includes(id)
        ? [{...group, groupIndex, objectIds:[...group.objectIds]}] : []),
      selection: {objectId:scene.activeObjectId, groupId:scene.activeGroupId},
      ...captureContext(),
    };
  }

  function check(value, id) {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || !value.record || value.record.id !== id
      || !records.reloadable(value.record)
      || !Number.isInteger(value.index) || value.index < 0 || !Array.isArray(value.groups)
      || value.groups.some(group => !group || typeof group.id !== 'string'
        || !Number.isInteger(group.groupIndex) || group.groupIndex < 0
        || !Array.isArray(group.objectIds) || !group.objectIds.includes(id))
      || !value.selection
      || !(value.selection.objectId === null || typeof value.selection.objectId === 'string')
      || !(value.selection.groupId === null || typeof value.selection.groupId === 'string')) {
      throw Error(`Scene object "${id}" cannot be restored from its retained source`);
    }
    return structuredClone(value);
  }

  function restoreGroups(entry, groups) {
    scene.setGroups(restoreSceneObjectGroups(
      scene.groups, groups, entry.id, scene.objects.map(record => record.id),
    ));
  }

  async function reconstruct(record, context = {record}) {
    if (scene.find(record.id)) throw Error(`Scene object "${record.id}" is already present`);
    const retained = scene.retained(record.id);
    let object;
    if (retained) {
      object = retained.object;
      admit(retained, {prepare:false});
      roots.attach(retained);
      domain(retained).attach?.(retained, context);
    } else {
      object = await records.load(record, {activate:false});
    }
    const entry = scene.find(record.id);
    if (!entry || entry.object !== object) throw Error(`Scene object "${record.id}" did not restore its retained identity`);
    roots.restore(entry, record);
    domain(entry).restored?.(entry, context);
    return entry;
  }

  async function restore(value) {
    const {record, index, groups, selection} = value;
    const entry = await reconstruct(record, value);
    scene.move(entry.id, index);
    restoreGroups(entry, groups);
    if (selection.groupId && scene.groups.some(group => group.id === selection.groupId)) {
      select(['@group:' + selection.groupId], '@group:' + selection.groupId);
    } else if (selection.objectId && scene.find(selection.objectId)) {
      select([selection.objectId], selection.objectId);
    } else {
      select([], null);
    }
    changed({operation:'restore', entry});
    return true;
  }

  function ensureTarget(id) {
    if (!edits) throw Error('Scene edit history is not installed');
    const editId = membershipEditTargetId(id);
    if (!targets.has(editId)) {
      edits.register(editId, {
        allowMissing:true,
        read:() => snapshot(id), check:value => check(value, id),
        write:value => value == null
          ? remove(id, {recordHistory:false, preserveForMembershipHistory:true})
          : restore(value),
      });
      targets.add(editId);
    }
    return editId;
  }

  function recordInsertion(id) {
    const after = snapshot(id);
    if (!after) return false;
    const editId = ensureTarget(id);
    return edits.recordAppliedWhenAvailable(editId, null, after,
      `Add ${after.record.label || after.record.fileName || id}`);
  }

  function remove(id, {recordHistory = true, preserveForMembershipHistory = false, disposeTree} = {}) {
    const existing = scene.find(id);
    // Some domains own a compound authored operation, including their history.
    if (existing && domain(existing).remove) return domain(existing).remove(id);
    if (recordHistory && edits?.state().replaying) {
      status('Wait for the current scene history action to finish');
      return false;
    }
    finishInteraction();
    const index = scene.objects.findIndex(entry => entry.id === id);
    if (index < 0) return;
    const before = recordHistory ? snapshot(id) : null;
    const editId = before ? ensureTarget(id) : null;
    if (editId) {
      try { edits.assertCanRecordApplied(editId); }
      catch (error) { status(error.message); return false; }
    }
    if (recordHistory && !editId) edits?.discard(entry => entry.id === id);
    const previousGroup = scene.activeGroupId, wasActive = scene.activeObjectId === id;
    const entry = scene.forget(id);
    scene.pruneGroups();
    scene.pruneSelection();
    domain(entry).detached?.(entry);
    roots.detach(entry);
    domain(entry).removed?.(entry);
    const retain = domain(entry).retainRoot === true && (Boolean(editId) || preserveForMembershipHistory
      || (!recordHistory && hasHistory(id) && edits.state().replaying));
    if (retain) scene.retain(entry, disposeTree);
    else if (disposeTree && !domain(entry).dispose) disposeTree(entry.object);
    else dispose(entry);
    const fallback = wasActive ? (scene.objects[index] || scene.objects[index - 1]) : scene.find(scene.activeObjectId);
    if (scene.selection.ids.length) {
      select(scene.selection.ids, scene.selection.activeId);
    } else if (!wasActive && previousGroup && scene.groups.some(group => group.id === previousGroup)) {
      select(['@group:' + previousGroup], '@group:' + previousGroup);
    } else if (wasActive || !fallback) {
      select(fallback ? [fallback.id] : [], fallback?.id ?? null);
    }
    status(`Removed: ${entry.label || entry.fileName || entry.id}`);
    if (editId) edits.recordApplied(editId, before, null, `Remove ${entry.label || entry.fileName || id}`);
    changed({operation:'remove', entry});
    return true;
  }

  function removeOwned(handle, disposeTree) {
    if (scene.find(handle.id)?.object !== handle.root) return false;
    return remove(handle.id, {recordHistory:false, preserveForMembershipHistory:hasHistory(handle.id), disposeTree});
  }

  return Object.freeze({
    admit, reconstruct, snapshot, check, restore, restoreGroups, ensureTarget, recordInsertion,
    remove, removeOwned, releaseUnreferenced, hasHistory,
    retainForHistory(id, target) { compoundTargets.set(id, target); },
    attachHistory(history) {
      if (edits && edits !== history) throw Error('Scene membership history is already installed');
      if (!edits) { edits = history; unsubscribe = edits.subscribe(releaseUnreferenced); }
    },
    clearHistoryTargets() {
      for (const id of targets) edits.unregister(id);
      targets.clear();
      compoundTargets.clear();
    },
    dispose() { unsubscribe?.(); },
  });
}
