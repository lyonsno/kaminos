import {createWalkingCreature} from './walking.experiment.mjs';
import {loadFullBodySources,loadFullBodySkin} from './full-body-source.mjs';

// A composition of the ordinary creature consumer, not another motion engine.
// Shared source data is read-only; Bone palettes, bodies, controls and clocks
// belong to each actor. Actor ids survive a recipe roundtrip; scene ids do not.
export async function createLivingScene({host,inputs={},record=()=>{}},dependencies={}) {
 if(!Array.isArray(inputs.actors))throw Error('Living scene requires explicit actors');
 const actors=new Map(),pending=new Set(),sourceCache=new Map(),skinCache=new Map();
 let disposed=false,mountRoot=null,serial=0,tail=Promise.resolve(),selectedId=null,onSelection=()=>{};
 const cache=(store,load)=>input=>{
  const key=JSON.stringify(['case','case_sha256','motion','motion_sha256','frame','frame_sha256','prefix','prefix_sha256'].map(name=>input[name]??null));
  if(!store.has(key)){const promise=Promise.resolve().then(()=>load(input));store.set(key,promise);promise.catch(()=>{if(store.get(key)===promise)store.delete(key);});}
  return store.get(key);
 };
 const deps={...dependencies,publishInspector:false,loadSources:cache(sourceCache,dependencies.loadSources??loadFullBodySources),loadSkin:cache(skinCache,dependencies.loadSkin??loadFullBodySkin)};
 const active=()=>{if(disposed)throw Error('Living scene is disposed');};
 const get=id=>{active();const row=actors.get(id);if(!row)throw Error(`Unknown actor: ${id}`);return row;};
 function check(spec){if(typeof spec?.id!=='string'||!spec.id.trim()||typeof spec.label!=='string'||!spec.label.trim()||!spec.creature||typeof spec.creature!=='object')throw Error('Actor requires stable id, label and creature setup');}
 const serialEdit=fn=>{const operation=tail.then(()=>{active();return fn();});tail=operation.catch(()=>{});return operation;};
 function read(){active();return {schema:'kaminos.living-scene.v1',actors:[...actors.values()].map(row=>({id:row.id,label:row.label,state:row.entry.read()})),recipe:{...structuredClone(inputs),actors:[...actors.values()].filter(row=>row.entry.read().playback.status!=='removed').map(row=>({id:row.id,label:row.label,creature:row.entry.read().recipe}))}};}
 async function construct(spec){
  check(spec);if(pending.has(spec.id))throw Error(`Actor is being constructed: ${spec.id}`);pending.add(spec.id);
  const row={id:spec.id,label:spec.label,entry:null,mounted:null};
  // Global camera/floor/gizmo settings are room state, never actor disposal state.
  const {view,ground,gizmos,...creature}=spec.creature;
  if(creature.actor_root!==undefined&&creature.actor_root!=='live'){pending.delete(spec.id);throw Error('Unknown living creature root mode; actors require live roots');}
  const scopedHost={...host,controls:{...host.controls}};
  if(host.controls.mountObject)scopedHost.controls.mountObject=options=>host.controls.mountObject({...options,onSelected:()=>{selectedId=spec.id;onSelection();options.onSelected?.();}});
  try{row.entry=await createWalkingCreature({host:scopedHost,inputs:{...creature,label:spec.label,actor_root:'live'},record:event=>record({...event,actor:spec.id})},deps);active();return row;}
  catch(error){await row.entry?.dispose();throw error;}finally{pending.delete(spec.id);}
 }
 function seat(row){
  if(!mountRoot)return;
  // Reuse the same selection-context property/transport seating. No per-actor
  // left-hand dashboard or private selection mechanism is introduced.
  row.mounted=row.entry.mount({root:mountRoot,invoke:(operation,input)=>operations.actor({id:row.id,operation,input}),reopen:creature=>operations.replace({id:row.id,creature})});
 }
 async function add(spec){check(spec);if(actors.has(spec.id))throw Error(`Duplicate actor: ${spec.id}`);const row=await construct(spec);try{actors.set(row.id,row);seat(row);return read();}catch(error){actors.delete(row.id);await row.entry.dispose();throw error;}}
 async function remove(id){const row=get(id);await row.entry.dispose();actors.delete(id);return read();}
 const operations={
  actor:async({id,operation,input}={})=>{const row=get(id);if(!Object.hasOwn(row.entry.operations,operation))throw Error(`Unknown actor operation: ${operation}`);return row.entry.operations[operation](input);},
  add:spec=>serialEdit(()=>add(spec)),
  remove:({id}={})=>serialEdit(()=>remove(id)),
  replace:({id,creature}={})=>serialEdit(async()=>{
   const old=get(id),next=await construct({id,label:old.label,creature});
   try{seat(next);}catch(error){await next.entry.dispose();throw error;}
   await old.entry.dispose();actors.set(id,next);return read();
  }),
  duplicate:({id}={})=>serialEdit(async()=>{
   const old=get(id),creature=structuredClone(old.entry.read().recipe);creature.transform.position[0]+=3*creature.transform.scale[0];
   let next;do{next=`creature-${++serial}`;}while(actors.has(next));
   return add({id:next,label:`${old.label} copy`,creature});
  }),
  select:({id}={})=>{const row=get(id),state=row.entry.read();if(state.playback.status==='removed')throw Error('Creature was removed from the scene');globalThis.window?.selectSceneObject?.(state.host.id);return state;},
 };
 const registry={read,invoke:(id,operation,input)=>operations.actor({id,operation,input}),inspect:(id,options)=>get(id).entry.inspect(options),pose:(id,options)=>get(id).entry.pose(options)};
 async function dispose(){if(disposed)return;disposed=true;await tail;const results=await Promise.allSettled([...actors.values()].map(row=>row.entry.dispose()));actors.clear();sourceCache.clear();skinCache.clear();if(globalThis.window?.kaminosCreatureActors===registry)delete window.kaminosCreatureActors;const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(failures.length)throw new AggregateError(failures,'Living scene cleanup failed');}
 try{
  // Preflight identity before mounting anything, including an accidental duplicate.
  const ids=new Set();for(const spec of inputs.actors){check(spec);if(ids.has(spec.id))throw Error(`Duplicate actor: ${spec.id}`);ids.add(spec.id);}
  for(const spec of inputs.actors)await add(spec);
  if(inputs.view){const session=await host.scene.open();try{session.setView(inputs.view);}finally{await session.dispose();}}
  if(globalThis.window)window.kaminosCreatureActors=registry;
  return {...registry,operations,dispose,mount({root}){
   mountRoot=root;for(const row of actors.values())seat(row);
   const document=host.controls.document,section=document.createElement('section'),title=document.createElement('h3'),select=document.createElement('select'),duplicate=document.createElement('button'),removeButton=document.createElement('button'),save=document.createElement('button'),open=document.createElement('input'),output=document.createElement('output');
   title.textContent='Creatures';select.setAttribute('aria-label','Scene creature');duplicate.textContent='Duplicate creature';removeButton.textContent='Remove creature';save.textContent='Save creatures';open.type='file';open.accept='.json,application/json';open.setAttribute('aria-label','Open creatures setup');
   const update=()=>{select.replaceChildren();for(const row of actors.values()){if(row.entry.read().playback.status==='removed')continue;const option=document.createElement('option');option.value=row.id;option.textContent=row.label;select.append(option);}if(actors.has(selectedId))select.value=selectedId;};
   onSelection=()=>{if(selectedId)select.value=selectedId;};
   const call=async action=>{try{await action();output.textContent='';update();}catch(error){output.textContent=error.message;}};
   select.onchange=()=>call(()=>operations.select({id:select.value}));duplicate.onclick=()=>call(()=>operations.duplicate({id:select.value}));removeButton.onclick=()=>call(()=>operations.remove({id:select.value}));
   save.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(read().recipe,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='creatures.setup.json';link.click();URL.revokeObjectURL(url);};
   open.onchange=()=>call(async()=>{const file=open.files?.[0];if(!file)return;const entry=globalThis.window?.kaminosWorkbenchExperiments;if(!entry?.open)throw Error('Shared creature entry is unavailable');await entry.open('mushfinger/living-scene',JSON.parse(await file.text()));});
   section.append(title,select,duplicate,removeButton,save,open,output);root.append(section);update();return {dispose(){onSelection=()=>{};section.remove();}};
  }};
 }catch(error){await dispose();throw error;}
}

export default {id:'mushfinger/living-scene',title:'Creatures · shared world',create:createLivingScene};
