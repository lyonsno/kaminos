// Whether the page boots the fluid simulation. Ordinary scenes start without it; a URL
// carrying fire intent (a saved flame recipe, a volume route or volume parameters) gets
// it, and so does a saved-scene address (#scene=), since the scene may hold fire and its
// restore waits for the volume route. fire=off and fire=on override.
// The current model's inexpensive built-in preview, derived from the committed
// Reactant source recipe. Historical defaults remain in Git, not in live boot.
export const SEMANTIC_FLAME_BASIN=Object.freeze({
  url:'/api/volume-settings-preset?runtime=1&id=%40reactant-preview',
  sourcePresetId:'vsp-603cb6e842f15e56fcbac4f9c2eb0a53ea6cbf9748a45c09337d766b7d901eee',
  label:'Reactant preview',
});

export function fireAtBoot(params,hash=new URLSearchParams()){
  const fire=params.get('fire');
  if(fire==='off')return {boot:false,reason:'fire=off'};
  if(fire==='on')return params.has('settings_preset')?{boot:true,reason:'fire=on'}:{boot:true,reason:'fire=on',basin:SEMANTIC_FLAME_BASIN.url};
  if(params.has('settings_preset'))return {boot:true,reason:'settings_preset'};
  if(params.get('kaminos_volume_smoke')==='1')return {boot:true,reason:'kaminos_volume_smoke'};
  const key=[...params.keys()].find(name=>name.startsWith('volume_'));
  if(key)return {boot:true,reason:key};
  if(hash.get('scene'))return {boot:true,reason:'saved scene'};
  return {boot:false,reason:'no fire in this page'};
}

// One boot of the fluid route per page, started either at load (fireAtBoot) or on demand when
// a person adds fire to a scene that started without it. A failed boot can be tried again.
export function createFluidBoot(init){
  if(typeof init!=='function')throw TypeError('fluid route initializer required');
  let pending=null,reason=null;
  return {
    ensure(why){
      if(!pending){reason=why;pending=Promise.resolve().then(init).catch(error=>{pending=null;reason=null;throw error;});}
      return pending;
    },
    state:()=>({started:!!pending,reason}),
  };
}
