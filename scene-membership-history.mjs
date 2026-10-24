import {pruneGroupTopology} from './scene-group-topology.mjs';
// Reconstructible membership is history-owned. Live-only roots are references:
// history neither serializes their evolving state nor acquires their lifetime.
export function captureSceneMembership(records, isReloadable) {
  const objects = [], liveIds = [];
  for (const record of records) {
    if (isReloadable(record)) objects.push(record);
    else liveIds.push(record.id);
  }
  return {objects, liveIds};
}

// Merge restored authored topology with the live registrations that exist now.
// In particular, an experiment opened since capture survives, and one closed
// since capture is never reconstructed from a historical reference.
export function resolveSceneMembershipTopology(value, current) {
  const authoredIds = value.objects.map(row => row.id), authored = new Set(authoredIds);
  const live = new Set(current.liveIds), ids = [];
  let index = 0;
  for (const id of current.order) {
    if (live.has(id)) ids.push(id);
    else if (index < authoredIds.length) ids.push(authoredIds[index++]);
  }
  ids.push(...authoredIds.slice(index));
  const groups = pruneGroupTopology(value.groups,authored);
  for (const group of pruneGroupTopology(current.groups,live)) {
    const objectIds = group.objectIds;
    const restored = groups.find(row => row.id === group.id);
    if (restored) restored.objectIds.push(...objectIds);
    else groups.push({...structuredClone(group), objectIds});
  }
  const valid = new Set([...ids, ...groups.map(group => '@group:' + group.id), 'flame-field', 'water-field']);
  const selected = value.selection.ids.filter(id => valid.has(id));
  return {ids, groups, selection:{ids:selected, activeId:selected.includes(value.selection.activeId) ? value.selection.activeId : selected.at(-1) ?? null}};
}

export function restoreSceneObjectGroups(currentGroups, savedGroups, objectId, presentObjectIds) {
  const groups = structuredClone(currentGroups);
  const present = new Set(presentObjectIds);
  for (const saved of [...savedGroups].sort((a, b) => a.groupIndex - b.groupIndex)) {
    const { groupIndex, ...savedGroup } = saved;
    const currentIndex = groups.findIndex(candidate => candidate.id === saved.id);
    const current = currentIndex < 0 ? null : groups[currentIndex];
    const currentIds = new Set(current?.objectIds || []);
    const orderedIds = saved.objectIds.filter(id => present.has(id) && (id === objectId || currentIds.has(id)));
    for (const id of current?.objectIds || []) {
      if (present.has(id) && !saved.objectIds.includes(id)) orderedIds.push(id);
    }
    const group = { ...(current || savedGroup), objectIds: [...new Set(orderedIds)] };
    if (currentIndex >= 0) groups.splice(currentIndex, 1);
    groups.splice(Math.min(groupIndex, groups.length), 0, group);
  }
  return groups;
}
