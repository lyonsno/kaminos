import * as THREE from '../lib/three.webgpu.js';
import pourStudy from './stage-pour.experiment.mjs';
import {createGenerationArrival,arrivalTranslation} from '../generation-arrival.mjs';
export default {id:'generation-arrival',title:'Generate · arrival study',async create({host,inputs,record}){
 const document=host.controls.document,app=document.defaultView;
 if(!Array.isArray(inputs.stageIds)||!inputs.stageIds.length)throw Error('Choose the saved kiln, mold and spigot object IDs as stageIds.');
 const ids=new Set(inputs.stageIds),rows=host.scene.objects().filter(row=>ids.has(row.id));
 if(rows.length!==ids.size)throw Error('Some arrival objects are absent from the current scene.');
 const session=await host.scene.open(),study=await pourStudy.create({host,inputs,record});
 let stopFrame,disposed=false,anchored=false,lastPlacement=null,slider,status,pausedByExit=false;
 const present=amount=>{
  host.scene.arrivalPresentation.set(amount===null?null:host.scene.objects().map(row=>[row.id,ids.has(row.id)?amount:1-amount]));
  if(slider)slider.value=String(amount??0);
  if(status)status.textContent=amount===null?'Closed':`${Math.round(amount*100)}% arrival · schematic visibility blend`;
  session.redraw();
 };
 const place=()=>{
  // Keep an evolving fluid field in the frame where it was released. Re-entry
  // does not rebuild, reset or drag its particles to a different location.
  if(anchored)return;
  const runtime=app.kaminosWaterSources.read().runtime;
  if(runtime?.population?.active>0)throw Error('Reset water before placing this arrival for the first time.');
  const box=new THREE.Box3();for(const row of rows){row.object.updateWorldMatrix(true,true);box.expandByObject(row.object);}
  const sphere=box.getBoundingSphere(new THREE.Sphere()),view=session.readView(),canvas=host.scene.renderer().domElement;
  const placement=arrivalTranslation({view:{...view,aspect:canvas.clientWidth/canvas.clientHeight},center:sphere.center.toArray(),radius:sphere.radius});
  const delta=new THREE.Vector3(...placement.translation);
  // Native roots keep their authored orientation and scale. World translation
  // preserves gravity and moves the inlet and collision surfaces together.
  for(const row of rows){const next=row.object.getWorldPosition(new THREE.Vector3()).add(delta);row.object.parent?.worldToLocal(next);row.object.position.copy(next);row.object.updateMatrixWorld(true);host.scene.refreshPresentation({id:row.id,root:row.object});}
  const water=app.kaminosWaterSources,settings=water.read().simulation.settings;
  if(settings?.waterSampling?.worldBounds){const bounds=settings.waterSampling.worldBounds;water.editSimulation({waterSampling:{...settings.waterSampling,worldBounds:{min:bounds.min.map((x,i)=>x+placement.translation[i]),max:bounds.max.map((x,i)=>x+placement.translation[i])}}});}
  anchored=true;lastPlacement={...placement,view};record({kind:'generation-arrival.place',phase:'applied',effective:lastPlacement});
 };
 const arrival=createGenerationArrival({duration:inputs.duration??2.5,present,place});
 const enter=()=>{arrival.enter();if(pausedByExit){app.kaminosPauseLocalLiquid(false);pausedByExit=false;}session.redraw();return read();};
 const exit=()=>{const runtime=app.kaminosWaterSources.read().runtime;if(runtime&&!runtime.paused){app.kaminosPauseLocalLiquid(true);pausedByExit=true;}arrival.exit();session.redraw();return read();};
 const read=()=>({arrival:arrival.read(),stageIds:[...ids],placement:lastPlacement,anchored,view:session.readView(),study:study.read(),atmosphere:'not connected',inference:'existing Generate controls; entry does not start a run'});
 const click=event=>{if(!event.target.closest('[data-workbench-tab="generate"]'))return;event.preventDefault();event.stopImmediatePropagation();try{enter();}catch(error){if(status)status.textContent=error.message;}};
 document.addEventListener('click',click,true);
 stopFrame=session.onFrame(({deltaSeconds})=>arrival.advance(deltaSeconds));
 return {read,operations:{...study.operations,enter,exit,hold:()=>{arrival.hold();return read();},seek:value=>{arrival.seek(Number(value));return read();},generationControls:()=>app.kaminosAssets.open('generate')},
  mount({root,invoke}){
   const section=document.createElement('section');root.append(section);study.mount({root:section,invoke});
   const title=document.createElement('h3');title.textContent='Generate arrival';
   const note=document.createElement('p');note.textContent='Generate opens this workspace without starting inference. The rig stays upright and anchors to the entry view. Return preserves its water. The blend is a boundary study; smoke is not connected.';
   const tools=document.createElement('div');
   for(const [name,label] of [['enter','Enter'],['hold','Hold'],['exit','Return'],['generationControls','Generation controls…']]){const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=()=>invoke(name).catch(error=>status.textContent=error.message);tools.append(b);}
   slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=1;slider.step=.001;slider.value=0;slider.setAttribute('aria-label','Arrival');slider.style.width='100%';slider.oninput=()=>invoke('seek',slider.value).catch(error=>status.textContent=error.message);
   status=document.createElement('p');status.setAttribute('role','status');root.prepend(title,note,tools,slider,status);present(0);
  },async dispose(){if(disposed)return;disposed=true;document.removeEventListener('click',click,true);stopFrame?.();arrival.dispose();host.scene.arrivalPresentation.dispose();if(pausedByExit)app.kaminosPauseLocalLiquid(false);await study.dispose();await session.dispose();}};
}};
