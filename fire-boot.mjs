// Whether the page boots the fluid simulation. Ordinary scenes start without it; a URL
// carrying fire intent (a saved flame recipe, a volume route or volume parameters) gets
// it, which is also how a saved scene containing fire reopens. fire=off and fire=on
// override.
// The basin semantic flame uses when no recipe is named: Noah's smokeyfuckinkilndemo-basin
// (64x128x64, 28 ray steps, 30% render scale), his cheapest recent preview, chosen
// 2026-10-13. Committed byte-identical so a fresh checkout has it.
export const SEMANTIC_FLAME_BASIN=Object.freeze({
  url:'./artifacts/default-basin/semantic-flame.json',
  presetId:'vsp-73c7fa64b2498e1dc5a24f1feefe79a6c1ce1c1effeb2c90ae318c56b0c75350',
  label:'smokeyfuckinkilndemo-basin',
});

export function fireAtBoot(params){
  const fire=params.get('fire');
  if(fire==='off')return {boot:false,reason:'fire=off'};
  if(fire==='on')return params.has('settings_preset')?{boot:true,reason:'fire=on'}:{boot:true,reason:'fire=on',basin:SEMANTIC_FLAME_BASIN.url};
  if(params.has('settings_preset'))return {boot:true,reason:'settings_preset'};
  if(params.get('kaminos_volume_smoke')==='1')return {boot:true,reason:'kaminos_volume_smoke'};
  const key=[...params.keys()].find(name=>name.startsWith('volume_'));
  if(key)return {boot:true,reason:key};
  return {boot:false,reason:'no fire in this page'};
}
