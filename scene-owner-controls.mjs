// Presentation attachment for actual registered objects; no domain state or clock.
export function createSceneOwnerControls({document,viewport,inspector,selected,onContext=()=>{}}) {
 const entries=new Set();
 let context=false;
 const belongs=(entry,selection)=>{
  if(!selection)return false;
  if(selection.ownerId===entry.asset.id)return true;
  for(let object=selection.object;object;object=object.parent)if(object===entry.asset.root)return true;
  return false;
 };
 function update(){
  const selection=selected();
  for(const entry of entries){const active=belongs(entry,selection);entry.properties.hidden=entry.playback.hidden=!active;if(active)entry.onSelected?.();}
  const next=[...entries].some(e=>belongs(e,selection));if(next!==context){context=next;onContext(next);}
 }
 function mount({asset,properties,playback,onSelected}){
  if(!asset?.id||!asset.root||!properties||!playback)throw Error('Object controls require a registered root, properties and playback');
  const entry={asset,properties,playback,onSelected};entries.add(entry);
  playback.className+=' scene-owner-playback';
  properties.className+=' scene-owner-properties';
  inspector.append(properties);viewport.append(playback);update();
  let disposed=false;
  return {update,dispose(){if(disposed)return;disposed=true;entries.delete(entry);properties.remove();playback.remove();update();}};
 }
 return {mount,update};
}
