import {createFoldFlowView,installFoldFlow} from '../stockroom-fold-flow.mjs';
export default {id:'stockroom-fold-flow',title:'Stockroom - Fold / receive',async create({host,record,inputs}){
 const session=await host.scene.open(),view=createFoldFlowView(),priorScale=host.rendering.readGI().resolutionScale;let controller;
 try{const asset=await session.attach(view.root,{owned:true,metadata:{label:view.root.name,source:'study:stockroom-fold-flow',type:'experiment'}});
  let detailSource=null;
  if(inputs.tiles!==false){
   const sha='0c57b96262b041ed2f2d578596a187d95ca31cf8072816ffb23048721ec9745f';detailSource='/api/read?root=generated-meshes&path='+sha+'.glb';
   const source=await session.loadAsset({url:detailSource,normalize:false,arrival:null,metadata:{label:'Woven clay - source'}});
   source.root.scale.setScalar(.12);source.root.position.set(2.7,1.16,.7);
   for(const x of [.3,.42,.54]){const copy=source.root.clone(true);copy.userData={stockroomDetailSource:sha};copy.scale.setScalar(.12);copy.position.set(x,.105,.73);copy.rotation.y=0;view.leaf.add(copy);}
  }
  host.rendering.gi({resolutionScale:.2});controller=installFoldFlow({host,session,view,asset,record});controller.operations.frame();host.controls.document.defaultView.kaminosSelection.clear();
  return {read:()=>({...controller.read(),detailSource}),operations:controller.operations,mount:({root})=>controller.mount(root),dispose:async()=>{controller.dispose();if(host.rendering.readGI().resolutionScale===.2)host.rendering.gi({resolutionScale:priorScale});await session.dispose();}};
 }catch(error){controller?.dispose();await session.dispose();throw error;}
}};
