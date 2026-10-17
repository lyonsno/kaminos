import {createWalkingCreature} from './walking.experiment.mjs';
import {loadFullBodySources,loadFullBodySkin} from './full-body-source.mjs';
import * as THREE from '../../lib/three.core.js';
import {mountCreatureProperties} from './creature-properties.mjs';

function checkZone(spec){const t=spec?.transform;if(typeof spec?.id!=='string'||!spec.id.trim()||typeof spec.label!=='string'||!spec.label.trim()||t?.position?.length!==3||t?.quaternion?.length!==4||t?.scale?.length!==3||![...t.position,...t.quaternion,...t.scale].every(Number.isFinite)||t.scale.some(v=>v<=0)||Math.abs(Math.hypot(...t.quaternion)-1)>1e-5)throw Error('Invalid authored zone');}
function checkPlaces(places,ids){if(!Array.isArray(places))throw Error('Creature requires zone references');const seen=new Set();for(const p of places){if(!ids.has(p?.zoneId)||seen.has(p.zoneId)||typeof p.enabled!=='boolean'||!Number.isFinite(p.preference)||p.preference<0)throw Error('Unknown/duplicate zone or invalid preference');seen.add(p.zoneId);}return structuredClone(places);}
function checkActor(spec){if(typeof spec?.id!=='string'||!spec.id.trim()||typeof spec.label!=='string'||!spec.label.trim()||!spec.creature||typeof spec.creature!=='object')throw Error('Actor requires stable id, label and creature setup');if(typeof(spec.active??true)!=='boolean'||typeof(spec.preview??false)!=='boolean')throw Error('Invalid actor behavior flags');if(spec.creature.actor_root!==undefined&&spec.creature.actor_root!=='live')throw Error('Unknown living creature root mode; actors require live roots');}
// The same preflight serves factory and file Open. In particular, a bad place
// reference must be rejected before the shared entry disposes the current room.
export function validateLivingSetup(inputs){
 if(!Array.isArray(inputs?.actors))throw Error('Living scene requires explicit actors');
 if(typeof(inputs.running??false)!=='boolean'||inputs.zones!==undefined&&!Array.isArray(inputs.zones))throw Error('Invalid scene run state or zones');
 const ids=new Set();for(const spec of inputs.actors){checkActor(spec);if(ids.has(spec.id))throw Error(`Duplicate actor: ${spec.id}`);ids.add(spec.id);}
 if(inputs.zones!==undefined){const zones=new Set();for(const zone of inputs.zones){checkZone(zone);if(zones.has(zone.id))throw Error('Duplicate zone');zones.add(zone.id);}for(const spec of inputs.actors)checkPlaces(spec.places??[],zones);}
}
export async function openLivingSetup({entry,inputs,prepare=async()=>{}}){validateLivingSetup(inputs);await prepare(inputs);return entry.open('mushfinger/living-scene',inputs);}

// A composition of the ordinary creature consumer, not another motion engine.
// Shared source data is read-only; Bone palettes, bodies, controls and clocks
// belong to each actor. Actor ids survive a recipe roundtrip; scene ids do not.
export async function createLivingScene({host,inputs={},record=()=>{}},dependencies={}) {
 validateLivingSetup(inputs);
 const actors=new Map(),pending=new Set(),sourceCache=new Map(),skinCache=new Map(),zones=new Map();
 const authored=inputs.zones!==undefined;
 let running=inputs.running??false,zoneSession=null,sceneControls=null;
 if(typeof running!=='boolean'||authored&&!Array.isArray(inputs.zones))throw Error('Invalid scene run state or zones');
 let disposed=false,mountRoot=null,serial=0,tail=Promise.resolve();
 const cache=(store,load)=>input=>{
  const key=JSON.stringify(['case','case_sha256','motion','motion_sha256','frame','frame_sha256','prefix','prefix_sha256'].map(name=>input[name]??null));
  if(!store.has(key)){const promise=Promise.resolve().then(()=>load(input));store.set(key,promise);promise.catch(()=>{if(store.get(key)===promise)store.delete(key);});}
  return store.get(key);
 };
 const deps={...dependencies,publishInspector:false,loadSources:cache(sourceCache,dependencies.loadSources??loadFullBodySources),loadSkin:cache(skinCache,dependencies.loadSkin??loadFullBodySkin)};
 const active=()=>{if(disposed)throw Error('Living scene is disposed');};
 const get=id=>{active();const row=actors.get(id);if(!row)throw Error(`Unknown actor: ${id}`);return row;};
 const transformOf=root=>({position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()});
 const zoneRead=row=>({id:row.id,label:row.root.userData.kaminosSceneObject?.label??row.label,transform:transformOf(row.root),hostId:row.asset.id,mounted:Boolean(row.root.parent)});
 function liveZones(row){return row.places.filter(p=>p.enabled&&p.preference>0).map(p=>{const zone=zones.get(p.zoneId);if(!zone?.root.parent)throw Error('Referenced Wander zone is missing');return {...zone,preference:p.preference};});}
 function behavior(row){let available=[],error=null;try{available=liveZones(row);}catch(e){error=e.message;}return {active:row.active,preview:row.preview,sceneRunning:running,status:row.preview?'Motion preview':error??(!row.active?'Held':!available.length?'No active places':!running?'Paused with scene':row.entry.read().playback.status==='playing'?'Wandering':'Held'),error};}
 function refreshAll(){for(const row of actors.values())row.refreshPanel?.();if(sceneControls){sceneControls.button.textContent=running?'Ⅱ Pause scene':'▶ Run scene';sceneControls.status.textContent=running?'Active creatures running':'Scene paused';}}
 async function applyGate(row){if(row.preview)return;let available=[];try{available=liveZones(row);}catch{}if(running&&row.active&&available.length){if(row.entry.read().action.kind!=='wander')await row.entry.operations.action({kind:'wander'});row.entry.operations.play();}else row.entry.operations.pause();}
 function seatZone(row){if(!mountRoot||row.seating||!host.controls.mountObject)return;const document=host.controls.document,properties=document.createElement('section'),title=document.createElement('strong'),description=document.createElement('p');properties.className='creature-zone-properties';title.textContent=row.label;description.textContent='Shared Wander zone. Move, rotate or scale it with the ordinary scene controls. Each creature chooses its own enabled places and preferences.';properties.append(title,description);row.seating=host.controls.mountObject({asset:row.asset,properties});}
 async function addZone(spec){checkZone(spec);if(zones.has(spec.id))throw Error('Duplicate zone');const root=new THREE.Group();root.name=spec.label;root.userData.kaminosEditorOnly=true;
  // WebGPU rejects LineLoop. Repeat the first point in a supported Line so the
  // visible boundary and its ordinary screen-space selection share geometry.
  const edge=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:65},(_,i)=>new THREE.Vector3(Math.cos((i%64)/64*Math.PI*2),0,Math.sin((i%64)/64*Math.PI*2)))),new THREE.LineBasicMaterial({color:0x55cbd7,depthTest:false}));edge.renderOrder=90;root.userData.kaminosHelperKind='zones';root.add(edge);
  root.position.fromArray(spec.transform.position);root.quaternion.fromArray(spec.transform.quaternion);root.scale.fromArray(spec.transform.scale);
  const asset=await zoneSession.attach(root,{owned:true,metadata:{fileName:spec.label,label:spec.label,source:null}});const row={id:spec.id,label:spec.label,root,asset};zones.set(spec.id,row);seatZone(row);return zoneRead(row);
 }
 const serialEdit=fn=>{const operation=tail.then(()=>{active();return fn();});tail=operation.catch(()=>{});return operation;};
 function read(){active();return {schema:'kaminos.living-scene.v1',...(authored?{running,zones:[...zones.values()].map(zoneRead)}:{}),actors:[...actors.values()].map(row=>({id:row.id,label:row.label,...(authored?{active:row.active,places:structuredClone(row.places),behavior:behavior(row)}:{}),state:row.entry.read()})),recipe:{...structuredClone(inputs),...(authored?{running,zones:[...zones.values()].filter(row=>row.root.parent).map(row=>{const {hostId,mounted,...spec}=zoneRead(row);return spec;})}:{}),actors:[...actors.values()].filter(row=>row.entry.read().playback.status!=='removed').map(row=>({id:row.id,label:row.label,...(authored?{active:row.active,preview:row.preview,places:structuredClone(row.places)}:{}),creature:row.entry.read().recipe}))}};}
 async function construct(spec){
  checkActor(spec);if(pending.has(spec.id))throw Error(`Actor is being constructed: ${spec.id}`);
  const row={id:spec.id,label:spec.label,entry:null,mounted:null,active:spec.active??true,preview:spec.preview??false,places:authored?checkPlaces(spec.places??[],new Set(zones.keys())):[]};
  pending.add(spec.id);
  // Global camera/floor/gizmo settings are room state, never actor disposal state.
  const {view,ground,gizmos,...creature}=spec.creature;
  if(creature.actor_root!==undefined&&creature.actor_root!=='live'){pending.delete(spec.id);throw Error('Unknown living creature root mode; actors require live roots');}
  const scopedHost={...host,controls:{...host.controls}};
  if(host.controls.mountObject)scopedHost.controls.mountObject=options=>{
   const document=host.controls.document,bar=document.createElement('div'),title=document.createElement('strong'),duplicate=document.createElement('button'),remove=document.createElement('button'),error=document.createElement('output');
   title.textContent=spec.label;duplicate.textContent='Duplicate creature';remove.textContent='Remove creature';error.setAttribute('role','alert');
   const call=async action=>{try{await action();error.textContent='';}catch(e){error.textContent=e.message;}};
   duplicate.onclick=()=>call(()=>operations.duplicate({id:spec.id}));remove.onclick=()=>call(()=>operations.remove({id:spec.id}));
   bar.style.cssText='display:grid;gap:6px';bar.append(title,duplicate,remove,error);options.properties.prepend(bar);
   const setup=document.createElement('details'),summary=document.createElement('summary'),save=document.createElement('button'),open=document.createElement('input');summary.textContent='Save / open creatures';save.textContent='Save creatures';open.type='file';open.accept='.json,application/json';open.setAttribute('aria-label','Open creatures setup');
   save.onclick=()=>call(async()=>{const recipe=read().recipe;if(authored){const ids=new Set(recipe.zones.map(z=>z.id));for(const actor of recipe.actors)checkPlaces(actor.places,ids);}const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='creatures.setup.json';link.click();URL.revokeObjectURL(url);});
   open.onchange=()=>call(async()=>{const file=open.files?.[0];if(!file)return;const entry=globalThis.window?.kaminosWorkbenchExperiments;if(!entry?.open)throw Error('Shared creature entry is unavailable');await openLivingSetup({entry,inputs:JSON.parse(await file.text()),prepare:async setup=>{for(const actor of setup.actors)await deps.loadSources(actor.creature);}});});
   setup.append(summary,save,open);options.properties.append(setup);
   return host.controls.mountObject(options);
  };
  const extra=authored?{zoneProvider:{roots:()=>liveZones(row)},mountProperties:options=>{const panel=mountCreatureProperties({...options,behaviorContext:{read:()=>({behavior:behavior(row),places:structuredClone(row.places),zones:[...zones.values()].map(zoneRead)}),setActive:active=>operations.setActive({id:row.id,active}),setPlaces:places=>operations.setPlaces({id:row.id,places}),setPreview:preview=>operations.setPreview({id:row.id,preview}),selectZone:id=>operations.selectZone({id}),addZone:()=>operations.addZone({actorId:row.id})}});row.refreshPanel=panel.update;return panel;}}:{};
  const safe=authored?{play:false,...(!creature.wander&&!row.places.some(p=>p.enabled&&p.preference>0)?{action:'preview'}:{})}:{};
  try{row.entry=await createWalkingCreature({host:scopedHost,inputs:{...creature,...safe,label:spec.label,actor_root:'live'},record:event=>record({...event,actor:spec.id})},{...deps,...extra});active();return row;}
  catch(error){await row.entry?.dispose();throw error;}finally{pending.delete(spec.id);}
 }
 function seat(row){
  if(!mountRoot)return;
  for(const zone of zones.values())seatZone(zone);
  // Reuse the same selection-context property/transport seating. No per-actor
  // left-hand dashboard or private selection mechanism is introduced.
  row.mounted=row.entry.mount({root:mountRoot,invoke:(operation,input)=>operations.actor({id:row.id,operation,input}),reopen:creature=>operations.replace({id:row.id,creature})});
 }
 async function add(spec){checkActor(spec);if(actors.has(spec.id))throw Error(`Duplicate actor: ${spec.id}`);const row=await construct(spec);try{actors.set(row.id,row);seat(row);if(authored)await applyGate(row);refreshAll();return read();}catch(error){actors.delete(row.id);await row.entry.dispose();throw error;}}
 async function remove(id){const row=get(id);await row.entry.dispose();actors.delete(id);return read();}
 const operations={
  actor:async({id,operation,input}={})=>{const row=get(id);if(!Object.hasOwn(row.entry.operations,operation))throw Error(`Unknown actor operation: ${operation}`);if(authored&&operation==='action'){if(!['preview','wander'].includes(input?.kind))throw Error('Unknown creature action');return operations.setPreview({id,preview:input.kind==='preview'});}if(authored&&!row.preview){if(operation==='play'||operation==='pause')return operations.setActive({id,active:operation==='play'});if(['replay','seek','mode'].includes(operation))throw Error('Enter explicit motion preview before clip playback');}return row.entry.operations[operation](input);},
  setRunning:({running:value}={})=>serialEdit(async()=>{if(!authored||typeof value!=='boolean')throw Error('Scene behavior requires an explicit running flag');running=value;for(const row of actors.values()){if(!running)row.entry.operations.pause();else await applyGate(row);}refreshAll();record({kind:'living.run',running});return read();}),
  setActive:({id,active:value}={})=>serialEdit(async()=>{if(typeof value!=='boolean')throw Error('Behavior active must be boolean');const row=get(id);row.active=value;await applyGate(row);refreshAll();record({kind:'living.active',id,active:value});return read();}),
  setPlaces:({id,places}={})=>serialEdit(async()=>{const next=checkPlaces(places,new Set(zones.keys())),row=get(id);row.places=next;await applyGate(row);refreshAll();record({kind:'living.places',id,places:next});return read();}),
  setPreview:({id,preview}={})=>serialEdit(async()=>{if(typeof preview!=='boolean')throw Error('Preview must be boolean');const row=get(id),state=row.entry.read();if(preview||liveZones(row).length||state.recipe.held_wander||state.recipe.wander)await row.entry.operations.action({kind:preview?'preview':'wander'});row.preview=preview;if(preview)row.entry.operations.pause();else await applyGate(row);refreshAll();return read();}),
  selectZone:({id}={})=>{const zone=zones.get(id);if(!zone?.root.parent)throw Error('Unknown Wander zone');(host.scene.select??globalThis.window?.selectSceneObject)?.(zone.asset.id);return zoneRead(zone);},
  addZone:({actorId,spec}={})=>serialEdit(async()=>{if(!authored)throw Error('Shared zones are unavailable');const row=actorId?get(actorId):null;if(!spec){const p=row?.entry.read().transform.position??[0,0,0];let id;do{id=`zone-${++serial}`;}while(zones.has(id));spec={id,label:`Wander zone ${serial}`,transform:{position:[p[0],inputs.zoneHeight??p[1],p[2]],quaternion:[0,0,0,1],scale:[1,1,1]}};}const result=await addZone(spec);if(row){row.places.push({zoneId:spec.id,enabled:true,preference:1});await applyGate(row);}refreshAll();return result;}),
  add:spec=>serialEdit(()=>add(spec)),
  remove:({id}={})=>serialEdit(()=>remove(id)),
  replace:({id,creature}={})=>serialEdit(async()=>{
   const old=get(id),next=await construct({id,label:old.label,active:old.active,preview:old.preview,places:old.places,creature});
   try{seat(next);}catch(error){await next.entry.dispose();throw error;}
   await old.entry.dispose();actors.set(id,next);if(authored)await applyGate(next);refreshAll();return read();
  }),
  duplicate:({id}={})=>serialEdit(async()=>{
   const old=get(id),creature=structuredClone(old.entry.read().recipe);creature.transform.position[0]+=3*creature.transform.scale[0];
   let next;do{next=`creature-${++serial}`;}while(actors.has(next));
   return add({id:next,label:`${old.label} copy`,active:old.active,preview:old.preview,places:old.places,creature});
  }),
  select:({id}={})=>{const row=get(id),state=row.entry.read();if(state.playback.status==='removed')throw Error('Creature was removed from the scene');globalThis.window?.selectSceneObject?.(state.host.id);return state;},
 };
 const registry={read,invoke:(id,operation,input)=>operations.actor({id,operation,input}),inspect:(id,options)=>get(id).entry.inspect(options),pose:(id,options)=>get(id).entry.pose(options)};
 async function dispose(){if(disposed)return;disposed=true;await tail;sceneControls?.node.remove();for(const row of zones.values())row.seating?.dispose();const results=await Promise.allSettled([...actors.values()].map(row=>row.entry.dispose()));await zoneSession?.dispose();zones.clear();actors.clear();sourceCache.clear();skinCache.clear();if(globalThis.window?.kaminosCreatureActors===registry)delete window.kaminosCreatureActors;const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(failures.length)throw new AggregateError(failures,'Living scene cleanup failed');}
 try{
  // Preflight identity before mounting anything, including an accidental duplicate.
  if(authored){zoneSession=await host.scene.open();for(const spec of inputs.zones)await addZone(spec);}
  for(const spec of inputs.actors)await add(spec);
  if(inputs.view){const session=await host.scene.open();try{session.setView(inputs.view);}finally{await session.dispose();}}
  if(globalThis.window)window.kaminosCreatureActors=registry;
  return {...registry,operations,dispose,mount({root}){mountRoot=root;for(const row of actors.values())seat(row);if(authored&&!sceneControls){const document=host.controls.document,node=document.createElement('span'),button=document.createElement('button'),status=document.createElement('span');node.className='living-scene-run';node.style.cssText='display:flex;align-items:center;gap:8px';button.type='button';button.setAttribute('aria-label','Run or pause scene behavior');button.title='Run active creatures in this scene';status.style.fontSize='11px';button.onclick=async()=>{try{await operations.setRunning({running:!running});}catch(e){status.textContent=e.message;}};node.append(button,status);(document.getElementById('scene-add-menu')?.closest('nav')??root).append(node);sceneControls={node,button,status};refreshAll();}}};
 }catch(error){await dispose();throw error;}
}

export default {id:'mushfinger/living-scene',title:'Creatures · shared world',create:createLivingScene};
