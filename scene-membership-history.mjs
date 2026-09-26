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
