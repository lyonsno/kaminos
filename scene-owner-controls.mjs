// Presentation attachment for actual registered objects; no domain state or clock.
export function createSceneOwnerControls({document,viewport,inspector,selected,onContext=()=>{}}) {
 const entries=new Set();
 let context=false;
 const belongs=(entry,selection)=>{
  if(!selection)return false;
  for(let object=selection.object;object;object=object.parent)if(object===entry.asset.root||entry.relatedAssets.some(asset=>asset?.id&&object===asset.root))return true;
  return false;
 };
 function update(){
  const selection=selected();
  for(const entry of entries){const active=belongs(entry,selection);entry.properties.hidden=!active;if(entry.playback)entry.playback.hidden=!active;if(active)entry.onSelected?.();}
  const next=[...entries].some(e=>belongs(e,selection));if(next!==context){context=next;onContext(next);}
 }
 function mount({asset,relatedAssets=[],properties,playback,onSelected}){
  if(!asset?.id||!asset.root||!properties)throw Error('Object controls require a registered root and properties');
  if(!Array.isArray(relatedAssets))throw Error('Related owner objects must be registered asset receipts');
  const entry={asset,relatedAssets,properties,playback,onSelected};entries.add(entry);
  if(playback)playback.className+=' scene-owner-playback';
  properties.className+=' scene-owner-properties';
  inspector.append(properties);if(playback)viewport.append(playback);update();
  let disposed=false;
  return {update,dispose(){if(disposed)return;disposed=true;entries.delete(entry);properties.remove();playback?.remove();update();}};
 }
 return {mount,update};
}
