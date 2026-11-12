import {createWorkpieceView} from '../stockroom-workpiece-view.mjs';
import {installWorkpieces} from '../stockroom-workpieces.mjs';
export default {id:'stockroom-workpieces',title:'Stockroom - Construction workpieces',async create({host,record}){
 const session=await host.scene.open(),view=createWorkpieceView(),priorScale=host.rendering.readGI().resolutionScale;let controller;
 try{const asset=await session.attach(view.root,{owned:true,metadata:{label:view.root.name,source:'study:stockroom-workpieces',type:'experiment'}});
  host.rendering.gi({resolutionScale:.2});controller=installWorkpieces({host,session,view,asset,record});controller.operations.frame();host.controls.document.defaultView.kaminosSelection.clear();
  return {read:controller.read,operations:controller.operations,mount:({root})=>controller.mount(root),dispose:async()=>{controller.dispose();if(host.rendering.readGI().resolutionScale===.2)host.rendering.gi({resolutionScale:priorScale});await session.dispose();}};
 }catch(error){controller?.dispose();await session.dispose();throw error;}
}};
