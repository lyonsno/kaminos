import {capturePlacements,restorePlacements} from './placements.mjs';
import {checkedMechanism} from './model.mjs';
import {checkedBodyGeometry} from './bodies.mjs';
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
   if(kind==='geometry'){
    edits.register(id,{
     read:()=>slot.adapter?slot.adapter.read():(root().userData.linkGeometry?structuredClone(root().userData.linkGeometry):{schema:'kaminos.assembly-geometry.v1',bodies:[]}),
     check:value=>{if(slot.adapter)return slot.adapter.check(value);checkedBodyGeometry(checkedMechanism(root().userData.linkMechanism),value);return structuredClone(value);},
     write:value=>{if(slot.adapter)return slot.adapter.write(value);const g=checkedBodyGeometry(checkedMechanism(root().userData.linkMechanism),value);if(g)root().userData.linkGeometry=g;else delete root().userData.linkGeometry;}
    });
   }else{
    const fallback=value=>{const r=root(),g=r.userData.linkGeometry?.bodies?.length?{geometry:structuredClone(r.userData.linkGeometry)}:{};return {...value,recipe:checkedMechanism(r.userData.linkMechanism),...g,placements:capturePlacements((value.placements??[]).map(p=>p.id),objects())};};
    edits.register(id,{
     read:()=>slot.adapter?slot.adapter.read():fallback({}),
     readForReplay:value=>slot.adapter?.readForReplay?slot.adapter.readForReplay(value):fallback(value),
     check:value=>slot.adapter?slot.adapter.check(value):{...value,recipe:checkedMechanism(value.recipe)},
     write:value=>{if(slot.adapter)return slot.adapter.write(value);const r=root(),m=checkedMechanism(value.recipe);r.userData.linkMechanism=m;if('geometry' in value){const g=checkedBodyGeometry(m,value.geometry);if(g)r.userData.linkGeometry=g;else delete r.userData.linkGeometry;}restorePlacements(value.placements,objects());}
    });
   }
  }
  if(slot.adapter)throw Error('Mechanism already has a live editing controller');slot.adapter=adapter;
  releases.push(()=>{if(slot.adapter!==adapter)return;slot.adapter=null;if(!edits.hasHistoryEntry(id)){edits.unregister(id);registry.delete(id);}});return id;
 },dispose(){for(const release of releases)release();}};
}
