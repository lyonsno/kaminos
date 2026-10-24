// Groups own direct objects and may parent other groups. Object membership is
// still unique: a machine wraps its rigid parts without absorbing their IDs.
export function groupDescendants(groups, id) {
  const result=[], seen=new Set([id]);
  function visit(parent){for(const group of groups)if(group.parentId===parent){
    if(seen.has(group.id))throw Error('Scene group cycle');
    seen.add(group.id);result.push(group);visit(group.id);
  }}
  visit(id);return result;
}
export function groupObjectIds(groups, id) {
  const group=groups.find(g=>g.id===id);if(!group)return [];
  return [group,...groupDescendants(groups,id)].flatMap(g=>g.objectIds);
}
export function checkedGroupTopology(groups, objectIds) {
  const names=new Set(),assigned=new Set(),present=new Set(objectIds);
  for(const group of groups){
    if(!group||typeof group.id!=='string'||!group.id||names.has(group.id)||!Array.isArray(group.objectIds))throw Error('Invalid scene group identity');
    names.add(group.id);
    for(const id of group.objectIds){if(!present.has(id)||assigned.has(id))throw Error('Scene group contains an absent or already grouped object');assigned.add(id);}
  }
  const byId=new Map(groups.map(g=>[g.id,g]));
  for(const group of groups){
    const seen=new Set([group.id]);let parent=group.parentId;
    while(parent!=null){
      if(!byId.has(parent))throw Error('Scene group parent is absent');
      if(seen.has(parent))throw Error('Scene group cycle');
      seen.add(parent);parent=byId.get(parent).parentId;
    }
  }
  return groups;
}
export function pruneGroupTopology(groups, objectIds) {
  const present=new Set(objectIds);
  let result=groups.map(g=>({...structuredClone(g),objectIds:g.objectIds.filter(id=>present.has(id))}));
  // Empty ancestors remain while any descendant contains a live member.
  for(;;){const parents=new Set(result.map(g=>g.parentId));const next=result.filter(g=>g.objectIds.length||parents.has(g.id));if(next.length===result.length)break;result=next;}
  const names=new Set(result.map(g=>g.id));
  return result.map(g=>g.parentId&&!names.has(g.parentId)?{...g,parentId:null}:g);
}
