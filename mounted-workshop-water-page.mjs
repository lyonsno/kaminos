import {createMountedWaterDomain} from './mounted-water-domain.mjs';
import * as THREE from './lib/three.core.js';
import {createMountedWorkshopWater,mountedWaterPresentation} from './mounted-workshop-water.mjs';
import {createAuthoredWaterFeature} from './authored-water-feature.mjs';
import {createLocalLiquidEmitterObject} from './local-liquid-scene-object.mjs';
import {installRelativeNumberDrag} from './scene-control-history.mjs';

export async function installMountedWorkshopWater({document,workshop,camera,onFrame,services,objects,ordinaryFeature,selectFeature,editSource,commitEdits,select,registerDomain=()=>()=>{}}){
 const sourceRecord={label:'Workshop spigot',transform:{position:[-2.7875,1,.625],rotation:[Math.PI/2,0,0],scale:[1,1,1]},settings:{schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',baseRadius:.075,strength:.25,rate:120,volumeRate:.02806015625,lifetimeSeconds:null,emissionEnabled:false}};
 const built=createLocalLiquidEmitterObject(THREE,{...sourceRecord,id:'mounted-water-construction'});
 const {id:discard,...metadata}=built.record;
 const handle=await workshop.attach(built.object,{...metadata,waterCollision:false});
 const source=()=>{const row=objects().find(r=>r.id===handle.id);if(!row)return null;return {id:row.id,type:row.type,transform:{position:row.object.position.toArray(),rotation:row.object.rotation.toArray().slice(0,3),scale:row.object.scale.toArray()},localLiquidEmitter:structuredClone(row.localLiquidEmitter)};};
 const presentationParent=built.object.parent;
 const frame=()=>{presentationParent.updateWorldMatrix(true,false);return mountedWaterPresentation({parent:presentationParent});};
 const unrelated=()=>objects().some(r=>r.type==='local-liquid-emitter'&&!workshop.owns(r.id));
 const setup={schema:'kaminos.local-liquid-setup.v1',support:'scene_primitives',particleCount:30000,densityIterations:3,showSupportGeometry:false,trackPopulation:false,waterSampling:{spacing:.05/Math.cbrt(3),container:null,worldBounds:{min:[-3.5875,0,-1.5],max:[3.5875,1.3,1.5]}}};
 const colliders=()=>objects().filter(r=>workshop.owns(r.id)&&r.object.userData.kaminosStageMold).map(r=>({...r,object:undefined,waterCollision:true,stageMold:r.object.userData.kaminosStageMold,transform:{position:r.object.position.toArray(),rotation:r.object.rotation.toArray().slice(0,3),scale:r.object.scale.toArray()}}));
 const feature=createAuthoredWaterFeature({loadHost:async()=>{const {createAuthoredWaterHost}=await import('./authored-water-host.mjs');return {createAuthoredWaterHost:options=>createAuthoredWaterHost({...options,setup:{...options.setup,trackPopulation:false}})};},services:()=>({...services(),readColliders:colliders}),emitters:()=>source()?[source()]:[],runtimeEmitters:()=>source()?[source()]:[],visible:()=>true,viewerPaused:()=>true,report:()=>{}});
 const domain=createMountedWaterDomain({id:handle.id,feature,sources:()=>source()?[source()]:[],frame,changed:()=>{services().refreshDomain?.();services().redraw?.();}});const unregisterDomain=registerDomain(domain);
 let disposed=false,water,statusText='',flowEditing=false;
 const viewport=document.getElementById('viewport'),card=document.createElement('section');card.dataset.mountedWater='controls';card.setAttribute('aria-label','Workshop spigot');
 card.style.cssText='position:absolute;z-index:10;width:220px;padding:12px;border:1px solid #646260;border-radius:8px;background:#202528ed;color:#ead5ad;pointer-events:auto;font:14px system-ui';card.hidden=true;
 const heading=document.createElement('strong');heading.textContent='Spigot';const pour=document.createElement('button');pour.type='button';pour.textContent='Pour';pour.dataset.mountedWater='pour';
 const reset=document.createElement('button');reset.type='button';reset.textContent='Reset water';reset.title='Clear this workshop’s liquid and prepare a fresh paused pool. Source edits are retained.';
 const properties=document.createElement('button');properties.type='button';properties.textContent='Properties';properties.onclick=()=>select(handle.id);
 const label=document.createElement('label');label.textContent='Flow · L/s ';const flow=document.createElement('input');flow.type='number';flow.min='0';flow.step='.1';flow.setAttribute('aria-label','Workshop spigot flow');flow.style.width='100%';label.append(flow);
 const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='font-size:12px;margin:8px 0 0';card.append(heading,pour,reset,properties,label,status);viewport.append(card);
 function render(){if(!water)return;const state=water.read(),record=source();pour.disabled=state.phase!=='prepared'||!state.visible;pour.textContent=record?.localLiquidEmitter.emissionEnabled?'Stop':'Pour';reset.disabled=state.phase==='preparing';if(!flowEditing&&document.activeElement!==flow&&record)flow.value=String(record.localLiquidEmitter.volumeRate*1000);status.textContent=statusText||state.error||(state.phase==='preparing'?'Preparing water…':state.phase==='prepared'?'Liquid is retained when you Return.':'Water unavailable');}
 const act=async fn=>{statusText='';try{await fn();}catch(e){statusText=e.message;}render();};
 water=createMountedWorkshopWater({prepareHost:async()=>{if(unrelated())throw Error('This first workshop water connection requires a scene without other water sources.');feature.setup??=structuredClone(setup);if(!await feature.restore())throw Error(feature.failure||'Workshop water preparation failed');return feature.host;},
  currentHost:()=>feature.host,retireHost:()=>feature.reset(),setPaused:value=>feature.setPaused(value),source,editSource:patch=>editSource(handle.id,patch),commitEdits,frame,
  activate:()=>{if(unrelated())throw Error('Other scene water has appeared; Return before operating it.');selectFeature(feature);},deactivate:()=>selectFeature(ordinaryFeature),changed:render});
 pour.onclick=()=>act(()=>source()?.localLiquidEmitter.emissionEnabled?water.stop():water.pour());reset.onclick=()=>act(()=>water.reset());
 for(const button of [pour,reset,properties]){button.className='btn';button.style.margin='0 4px 6px 0';}heading.style.cssText='display:block;margin-bottom:8px';label.style.display='block';flow.className='transform-input';
 const drag=installRelativeNumberDrag({input:flow,grip:flow,step:()=>.1,onStart:()=>{flowEditing=true;},onEnd:()=>{flowEditing=false;render();}});
 flow.addEventListener('change',()=>act(async()=>{const value=Number(flow.value);if(flow.value===''||!Number.isFinite(value)||value<0)throw Error('Flow must be zero or more litres per second');editSource(handle.id,{volumeRate:value/1000});water.sync();}));
 const tick=(amount=workshop.read().amount)=>{if(disposed)return;const mounted=amount>0&&workshop.handles().some(h=>h.id===handle.id&&h.root.parent);try{const supported=!unrelated();if(!supported)statusText='Workshop water requires a scene without another water source.';water.present(mounted&&supported);water.sync();}catch(e){statusText=e.message;feature.setPaused(true);}card.hidden=!mounted;if(mounted){const p=built.object.getWorldPosition(new THREE.Vector3()).project(camera),w=viewport.clientWidth,h=viewport.clientHeight;card.style.left=Math.max(12,Math.min(w-244,(p.x+1)*w/2-244))+'px';card.style.top=Math.max(130,Math.min(h-card.offsetHeight-16,(1-p.y)*h/2-card.offsetHeight-26))+'px';}render();};
 const stop=onFrame(()=>tick());const unsubscribe=services().subscribeEdits?.(()=>{water.sync();render();});await water.prepare();
 return {domain,present:tick,read:()=>({...water.read(),sourceId:handle.id,source:source()}),pour:()=>water.pour(),stop:()=>water.stop(),reset:()=>water.reset(),
  async dispose(){if(disposed)return;disposed=true;stop();unsubscribe?.();unregisterDomain();drag?.dispose?.();await water.dispose();feature.clear();card.remove();}};
}
