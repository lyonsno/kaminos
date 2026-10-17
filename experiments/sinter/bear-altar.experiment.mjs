import liveLog from './live-log-heat.experiment.mjs';
import {createBearAltar,placeAltarBear,ALTAR_BEAR} from '../../bear-altar.mjs';
import {createBurnableSelection} from '../../burnable-selection.mjs';
import {resolveBurnableTarget} from '../../burnable-target.mjs';

export default {id:'bear-altar',title:'Midsummer burn altar',async create({host,inputs={},record}){
 const session=await host.scene.open(),document=host.controls.document;
 const source=`/api/read?root=${ALTAR_BEAR.root}&path=${encodeURIComponent(ALTAR_BEAR.path)}`;
 let controller,body,mount=null,disposed=false;const controls=new Map(),inspected=new WeakSet();
 try{
  await session.attach(createBearAltar(),{owned:true,metadata:{label:'Midsummer altar',source:'authored:bear-altar-v1'}});
  const asset=await session.loadAsset({url:source,normalize:false,arrival:'append',metadata:{label:'TRELLIS bear',collision:{domainId:'flame-field',enabled:true}}});
  placeAltarBear(asset.root);host.scene.refreshPresentation(asset);
  function show(instance){mount?.dispose?.();mount=null;if(body){body.replaceChildren();if(instance)mount=instance.mount({root:body,document,invoke:(name,value)=>Promise.resolve(instance.operations[name](value))});}}
  controller=createBurnableSelection({objects:host.scene.objects,changed:show,create:async objectId=>{
   return liveLog.create({host,inputs:{...inputs,targetId:objectId,disintegrate:true,followObject:true},record});
  }});
  const setBurnable=async value=>{const state=await controller.set(value);record({kind:'burnable.target',target:value.objectId,phase:'applied',requested:value,effective:{objectId:state.objectId,material:'wood',active:state.active}});for(const entry of controls.values())entry.checkbox.checked=controller.read().objectId===entry.id;return read();};
  const read=()=>({...controller.get()?.read(),identity:'kaminos.selected-burnable.v1',burnable:controller.read().active,objectId:controller.read().objectId,altarBearId:asset.id,asset:ALTAR_BEAR,view:session.readView(),support:'one active static volumetric mesh; wood-like law'});
  function syncControls(){
   const objects=host.scene.objects(),present=new Set(objects.map(row=>row.id));
   for(const [id,entry]of controls)if(!present.has(id)){entry.seating.dispose();controls.delete(id);}
   for(const entry of objects){
    if(controls.has(entry.id)||inspected.has(entry.object))continue;inspected.add(entry.object);
    try{resolveBurnableTarget(objects,entry.id);}catch{continue;}
    const properties=document.createElement('section'),playback=document.createElement('div'),label=document.createElement('label'),checkbox=document.createElement('input'),status=document.createElement('p');
    checkbox.type='checkbox';checkbox.checked=controller.read().objectId===entry.id;checkbox.setAttribute('aria-label','Burnable wood');label.append(checkbox,document.createTextNode('Burnable · wood'));properties.append(label,status);
    checkbox.onchange=()=>{checkbox.disabled=true;setBurnable({objectId:entry.id,enabled:checkbox.checked}).catch(error=>{status.textContent=error.message;checkbox.checked=controller.read().objectId===entry.id;}).finally(()=>{checkbox.disabled=false;});};
    const seating=host.controls.mountObject({asset:{id:entry.id,root:entry.object},properties,playback,onSelected:()=>{checkbox.checked=controller.read().objectId===entry.id;}});
    controls.set(entry.id,{id:entry.id,checkbox,seating});
   }
  }
  await controller.set({objectId:asset.id});syncControls();
  const unsubscribe=session.onFrame(syncControls);
  session.setView({position:[2.5,1.5,3.1],target:[0,-.2,0]});host.scene.select(asset.id);
  const operations={setBurnable,frame:()=>{if(controller.get())return controller.get().operations.frame();session.setView({position:[2.5,1.5,3.1],target:[0,-.2,0]});return read();}};
  for(const name of ['run','burnerOff','pause','reset','move','snapshot','view','flameView','selectFire','basins','reconnectFire','fuelFeed'])operations[name]=value=>{const active=controller.get();if(!active)throw Error('Select a mesh and enable Burnable');return active.operations[name](value);};
  return {read,operations,mount({root}){body=document.createElement('div');root.append(body);show(controller.get());return {dispose(){mount?.dispose?.();body.remove();body=null;}};},async dispose(){if(disposed)return;disposed=true;unsubscribe();for(const entry of controls.values())entry.seating.dispose();controls.clear();await controller.dispose();await session.dispose();}};
 }catch(error){await controller?.dispose();for(const entry of controls.values())entry.seating.dispose();await session.dispose();throw error;}
}};
