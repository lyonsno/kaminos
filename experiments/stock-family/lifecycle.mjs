// Native removal disposes a member's maps. Keep GPU ownership per member,
// while the immutable decoded image data can still be shared.
export function cloneStockMaterial(source){
  const material=source.clone(),textures=new Map();
  for(const [key,value] of Object.entries(material))if(value?.isTexture){
    if(!textures.has(value))textures.set(value,value.clone());material[key]=textures.get(value);
  }
  return material;
}
export function disposeStockMaterial(material){
  for(const texture of new Set(Object.values(material).filter(value=>value?.isTexture)))texture.dispose();
  material.dispose();
}

export function stockRetirementIds(objectIds,groups){
  const ids=new Set(objectIds);
  for(const group of groups)if(group.objectIds.length&&group.objectIds.every(id=>ids.has(id)))ids.add('@group:'+group.id);
  return ids;
}

// A compound edit is atomic: retire the whole transaction if it contains a
// destroyed root, not unrelated earlier edits or incidental selection context.
export function stockHistoryReferences(entry,ids){
  function payload(value){
    if(!value||typeof value!=='object')return false;
    if(Array.isArray(value))return value.some(payload);
    if(value.ids?.some(id=>ids.has(id)))return true;
    if(value.objectIds?.some(id=>ids.has(id)))return true;
    for(const key of ['roots','members'])if(value[key]&&Object.entries(value[key]).some(([id,state])=>ids.has(id)||payload(state)))return true;
    return payload(value.groups);
  }
  return ids.has(entry.id)||['before','after','historyBefore','historyAfter'].some(key=>payload(entry[key]));
}
