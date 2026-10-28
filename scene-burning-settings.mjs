export function checkedBurnAppearance(value={}){
 const next={profile:'composed',glow:1,...value};
 if(!['composed','crust','incineration'].includes(next.profile))throw Error('Unknown burn surface response');
 if(!Number.isFinite(next.glow)||next.glow<0||next.glow>10)throw Error('Emission gain must be between zero and ten');
 return {profile:'composed',glow:next.glow};
}
export function checkedBurnable(record,value=record?.burnable){
  if(value==null)return null;
  if(!['glb','pbr','procedural-mesh'].includes(record?.type))throw Error('Burnable requires a mesh object');
  if(typeof value.enabled!=='boolean')throw Error('Burnable enabled must be Boolean');
  if(value.material!=='wood')throw Error('Burnable material must be wood');
  if(value.enabled&&record.repetition)throw Error('Burnable wood requires independent objects; make repeated copies editable first');
  return {enabled:value.enabled,material:'wood',...(value.appearance!=null?{appearance:checkedBurnAppearance(value.appearance)}:{})};
}
