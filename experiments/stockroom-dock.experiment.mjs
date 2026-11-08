import {DOCK_SOURCE} from '../stockroom-dock.mjs';
export default {id:'stockroom-dock',title:'Stockroom dock',async create({host}){
 const session=await host.scene.open();
 const previous=host.scene.objects().find(e=>e.source===DOCK_SOURCE),empty=host.scene.objects().length===0;
 const entry=previous??await host.scene.addDock();
 const asset=await session.attach(entry.object,{owned:false});
 host.scene.select(asset.id);
 if(!previous){
  if(empty){const ground=host.controls.document.getElementById('composition-ground-height');ground.value='0';ground.dispatchEvent(new Event('change',{bubbles:true}));}
  session.setView({position:[10,7,9],target:[1,.6,0],up:[0,1,0]});host.scene.frame([asset.root]);
 }
 return {read:()=>({id:asset.id,recipe:structuredClone(asset.root.userData.stockroomDock)}),operations:{frame(){host.scene.frame([asset.root]);}},mount(){},dispose:()=>session.dispose()};
}};
