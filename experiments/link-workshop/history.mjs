import {capturePlacements,restorePlacements} from './placements.mjs';
import {checkedMechanism} from './model.mjs';
import {checkedBodyGeometry} from './bodies.mjs';
// Scene membership can destroy/reconstruct a root before the next render frame.
// Retained edit targets address its stable scene ID, never a disposed controller.
const registries=new WeakMap();let nextStore=0;
export function mechanismHistory(edits,objectId,objects){
 let registry=registries.get(edits);if(!registry){registry=new Map();registries.set(edits,registry);}
 const storeId=`@link-snapshots:${objectId}`;
 let store=registry.get(storeId);if(!store){
  store={generation:++nextStore,released:false,next:0,packets:new Map(),identities:new WeakMap(),bodies:new WeakMap(),owners:0,targets:new Set()};registry.set(storeId,store);
  store.cleanup=(state=edits.state())=>{
   if(state.replaying||edits.isSettling?.())return;
   for(const id of [...store.targets])if(!registry.get(id)?.adapter&&state.active?.id!==id&&!edits.hasHistoryEntry(id)){edits.unregister(id);registry.delete(id);store.targets.delete(id);}
   if(!store.owners&&!store.targets.size){store.released=true;store.packets.clear();store.identities=new WeakMap();store.bodies=new WeakMap();store.unsubscribe();registry.delete(storeId);}
  };
  store.unsubscribe=edits.subscribe(state=>store.cleanup(state));
 }
 store.owners++;let closed=false;
 // Native transform state contains a small reference. Immutable geometry values
 // stay here once, shared across previews and retained scene-history entries.
 function rememberGeometry(packet){
  if(store.released)throw Error('Geometry history snapshot store is released');
  if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies))throw Error('Choose an assembly geometry package');
  const known=store.identities.get(packet);if(known)return known;
  const bodies=packet.bodies.map(body=>{let owned=store.bodies.get(body);if(!owned){owned=structuredClone(body);store.bodies.set(body,owned);store.bodies.set(owned,owned);}return owned;});
  const value={schema:packet.schema,bodies},ref=`${objectId}:geometry:${store.generation}:${++store.next}`;store.identities.set(packet,ref);store.identities.set(value,ref);store.packets.set(ref,value);return ref;
 }
 function geometry(ref){const value=store.packets.get(ref);if(!value)throw Error('Geometry history snapshot is unavailable');return value;}
 const releases=[];
 return {rememberGeometry,geometry,register(kind,adapter){
  if(closed)throw Error('Mechanism history client is disposed');
  const id=`@link-${kind}:${objectId}`;let slot=registry.get(id);
  if(!slot){slot={adapter:null};registry.set(id,slot);
   const root=()=>{const found=objects().find(e=>e.id===objectId)?.object;if(!found)throw Error('Restore the mechanism before editing it');return found;};
   if(kind==='geometry'){
    edits.register(id,{
     read:()=>slot.adapter?slot.adapter.read():(root().userData.linkGeometry?structuredClone(root().userData.linkGeometry):{schema:'kaminos.assembly-geometry.v1',bodies:[]}),
     check:value=>{if(slot.adapter)return slot.adapter.check(value);checkedBodyGeometry(checkedMechanism(root().userData.linkMechanism),value);return structuredClone(value);},
     write:(value,context)=>{if(slot.adapter)return slot.adapter.write(value,context);const g=checkedBodyGeometry(checkedMechanism(root().userData.linkMechanism),value);if(g)root().userData.linkGeometry=g;else delete root().userData.linkGeometry;}
    });
   }else{
    const fallback=value=>{const r=root(),g=r.userData.linkGeometry??{schema:'kaminos.assembly-geometry.v1',bodies:[]};return {...value,recipe:checkedMechanism(r.userData.linkMechanism),geometryRef:rememberGeometry(g),placements:capturePlacements((value.placements??[]).map(p=>p.id),objects())};};
    edits.register(id,{
     read:()=>slot.adapter?slot.adapter.read():fallback({}),
     committed:continuation=>slot.adapter?.committed?.(continuation),
     readForReplay:value=>slot.adapter?.readForReplay?slot.adapter.readForReplay(value):fallback(value),
     check:value=>slot.adapter?slot.adapter.check(value):{...value,recipe:checkedMechanism(value.recipe)},
     write:(value,context)=>{if(slot.adapter)return slot.adapter.write(value,context);const r=root(),m=checkedMechanism(value.recipe);r.userData.linkMechanism=m;if('geometry' in value||'geometryRef' in value){const g=checkedBodyGeometry(m,value.geometryRef?geometry(value.geometryRef):value.geometry);if(g)r.userData.linkGeometry=g;else delete r.userData.linkGeometry;}restorePlacements(value.placements,objects());}
    });
   }
  }
  if(slot.adapter)throw Error('Mechanism already has a live editing controller');slot.adapter=adapter;store.targets.add(id);
  releases.push(()=>{if(slot.adapter===adapter)slot.adapter=null;});return id;
 },dispose(){if(closed)return;closed=true;for(const release of releases)release();store.owners--;store.cleanup();}};
}
