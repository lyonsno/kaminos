// Whether the page boots the fluid simulation. Ordinary scenes start without it; a URL
// carrying fire intent (a saved flame recipe, a volume route or volume parameters) gets
// it, which is also how a saved scene containing fire reopens. fire=off and fire=on
// override.
export function fireAtBoot(params){
  const fire=params.get('fire');
  if(fire==='off')return {boot:false,reason:'fire=off'};
  if(fire==='on')return {boot:true,reason:'fire=on'};
  if(params.has('settings_preset'))return {boot:true,reason:'settings_preset'};
  if(params.get('kaminos_volume_smoke')==='1')return {boot:true,reason:'kaminos_volume_smoke'};
  const key=[...params.keys()].find(name=>name.startsWith('volume_'));
  if(key)return {boot:true,reason:key};
  return {boot:false,reason:'no fire in this page'};
}
