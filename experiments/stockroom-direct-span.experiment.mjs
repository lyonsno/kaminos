import {createPlaceView} from '../stockroom-place-view.mjs';
import {installDirectSpan} from '../stockroom-direct-span-controls.mjs';

export default {id:'stockroom-direct-span',title:'Stockroom - Direct Dock Span',async create({host,record}){
 const session=await host.scene.open(),view=createPlaceView({showRegionGuides:false,showInsert:false});
 const prior=host.rendering.readGI().resolutionScale;
 let controls;
 async function dispose(){
  controls?.dispose();
  if(host.rendering.readGI().resolutionScale===.2)host.rendering.gi({resolutionScale:prior});
  view.dispose();
  await session.dispose();
 }
 try{
  view.root.name='Dock span study';
  const asset=await session.attach(view.root,{owned:true,metadata:{label:view.root.name,source:'study:stockroom-direct-span',type:'experiment'}});
  host.rendering.gi({resolutionScale:.2});
  controls=installDirectSpan({host,session,view,asset,record});
  controls.operations.frame();
  return {read:controls.read,operations:controls.operations,dispose};
 }catch(error){await dispose();throw error;}
}};
