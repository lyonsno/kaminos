import {createPlaceView} from '../stockroom-place-view.mjs';
import {installPlaceControls} from '../stockroom-place-controls.mjs';
export default {id:'stockroom-place',title:'Stockroom - Establish and Work',async create({host,inputs={},record,attachProposal}){
 const session=await host.scene.open(),view=createPlaceView(),priorScale=host.rendering.readGI().resolutionScale;let controller,unmount;
 try{const asset=await session.attach(view.root,{owned:true,metadata:{label:view.root.name,source:'study:stockroom-place',type:'experiment'}});host.rendering.gi({resolutionScale:.2});const proposal=await attachProposal?.({view,isPlaceEditing:()=>controller?.isEditing()??false});controller=installPlaceControls({host,session,view,asset,record,inputs:inputs.place,proposal});controller.operations.frame();host.scene.select(asset.id);
  return {read:controller.read,operations:controller.operations,mount({root}){unmount=controller.mount(root);},async dispose(){unmount?.();controller.dispose();view.dispose();if(host.rendering.readGI().resolutionScale===.2)host.rendering.gi({resolutionScale:priorScale});await session.dispose();}};
 }catch(e){unmount?.();controller?.dispose();view.dispose();if(host.rendering.readGI().resolutionScale===.2)host.rendering.gi({resolutionScale:priorScale});await session.dispose();throw e;}
}};
