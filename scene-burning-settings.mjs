export function checkedBurnable(record,value=record?.burnable){
  if(value==null)return null;
  if(!['glb','pbr','procedural-mesh'].includes(record?.type))throw Error('Burnable requires a mesh object');
  if(typeof value.enabled!=='boolean')throw Error('Burnable enabled must be Boolean');
  if(value.material!=='wood')throw Error('Burnable material must be wood');
  if(value.enabled&&record.repetition)throw Error('Burnable wood requires independent objects; make repeated copies editable first');
  if(value.structure!==undefined&&typeof value.structure!=='boolean')throw Error('Burnable structure must be Boolean');
  return {enabled:value.enabled,material:'wood',...(value.structure!==undefined?{structure:value.structure}:{})};
}
