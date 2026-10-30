import {restorePlacements} from './placements.mjs';
import {checkedMechanism} from './model.mjs';
// Scene membership can destroy/reconstruct a root before the next render frame.
// Retained edit targets address its stable scene ID, never a disposed controller.
const registries=new WeakMap();
export function mechanismHistory(edits,objectId,objects){
 let registry=registries.get(edits);if(!registry){registry=new Map();registries.set(edits,registry);}
 const releases=[];
 return {register(kind,adapter){
  const id=`@link-${kind}:${objectId}`;let slot=registry.get(id);
  if(!slot){slot={adapter:null};registry.set(id,slot);
   const root=()=>{const found=objects().find(e=>e.id===objectId)?.object;if(!found)throw Error('Restore the mechanism before editing it');return found;};
   const fallback=value=>({...value,recipe:checkedMechanism(root().userData.linkMechanism)});
   edits.register(id,{
    read:()=>slot.adapter?slot.adapter.read():fallback({}),
    readForReplay:value=>slot.adapter?.readForReplay?slot.adapter.readForReplay(value):fallback(value),
    check:value=>slot.adapter?slot.adapter.check(value):{...value,recipe:checkedMechanism(value.recipe)},
    write:value=>{if(slot.adapter)return slot.adapter.write(value);root().userData.linkMechanism=checkedMechanism(value.recipe);restorePlacements(value.placements,objects());}
   });
  }
  if(slot.adapter)throw Error('Mechanism already has a live editing controller');slot.adapter=adapter;
  releases.push(()=>{if(slot.adapter!==adapter)return;slot.adapter=null;if(!edits.hasHistoryEntry(id)){edits.unregister(id);registry.delete(id);}});return id;
 },dispose(){for(const release of releases)release();}};
}
