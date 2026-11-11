// A cold kiln supplies a spatial consumer for a reusable mounted-hinge operation.
// Every wall/panel is ordinary editable stock; the fixture adds no private editor.
import {hingeMountFrames} from './link-workshop/hinge-primitives.mjs';
import {frameMatrix,matrixFrame} from './link-workshop/mounts.mjs';
import * as T from '../lib/three.core.js';
export default {id:'hinge-installation',title:'Hold a kiln panel while moving its hinges',async create({host}){
 const win=host.controls.document.defaultView,edit=win.kaminosSceneAuthoring,service=win.kaminosMechanisms;
 const existing=host.scene.objects().find(e=>e.object.userData.linkMechanism?.fixture==='held-kiln-panel');
 if(existing){const runtime=await service.ensure(existing.object);host.scene.select(existing.id);return {read:runtime.read,operations:runtime.operations,mount({root}){root.textContent='Select a hinge and use G/R/S. The held panel goal is editable with its native pin.';},dispose(){}};}
 const box=(label,size,position,color,metalness=.35)=>{const id=edit.addMesh('box',{width:size[0],height:size[1],depth:size[2]});win.renameSceneObject(id,label);win.kaminosSetSceneObjectTransform(id,{position,rotation:[0,0,0],scale:[1,1,1]});edit.setMaterial(id,{color,metalness,roughness:.52});return id;};
 box('Kiln hearth',[2.35,.22,2.25],[-1.18,.48,-.95],'#a38c70',.05);box('Kiln roof',[2.35,.22,2.25],[-1.18,3.55,-.95],'#52616a');box('Kiln back',[.22,2.96,2.25],[-2.25,2,-.95],'#46535b');
 for(const z of [-2.1,.2])box('Kiln side',[2.35,2.96,.16],[-1.18,2,z],'#46535b');
 const fixed=box('Fixed hinge pedestal',[.38,.42,.4],[-.19,3.6,.32],'#53616a'),panels=[0,1,2].map(i=>box('Door panel '+(i+1),[.72,.14,2.04],[0,0,0],['#967d59','#b29974','#8e795e'][i],.15));
 const recipe={schema:'kaminos.links.v1',fixture:'held-kiln-panel',period:5,nodes:[],pistons:[],mounts:[],attachments:[]},hardware={family:'clevis',size:.28,mounting:'part-frames'},fixedFrame=hingeMountFrames(hardware).fixed,first=matrixFrame(new T.Matrix4().makeTranslation(0,3.6,.32).multiply(frameMatrix(fixedFrame)));
 for(let i=0;i<3;i++){const objectId=panels[i],sourceMount='panel-'+i,targetMount='receiver-'+i;recipe.mounts.push({id:sourceMount,label:'Panel '+(i+1)+' mounting face',owner:{objectId},position:[-.36,0,1.02],rotation:[0,-Math.PI/2,0]},{id:targetMount,label:i?'Previous panel':'Kiln frame',owner:{objectId:i?panels[i-1]:fixed},position:i?[.36,0,1.02]:[first.position[0]+.19,first.position[1]-3.6,first.position[2]-.32],rotation:[0,-Math.PI/2,0]});recipe.attachments.push({objectId,sourceMount,targetMount,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[[.3,-1.15,.45][i],i?0:-Math.PI/2],hardware:{...hardware}});}
 const runtime=await service.add(recipe);runtime.operations.mode({value:'A'});runtime.operations.selectConnection({objectId:panels[2]});runtime.operations.holdPose();runtime.operations.editAxle({objectId:panels[0]});
 win.kaminosSetCameraDebugPose({position:[7.5,5.6,8.5],target:[-.05,2.4,-.7],fov:38});
 return {read:runtime.read,operations:runtime.operations,mount({root}){root.textContent='The last door panel is held in Pose A. Move the first axle with G: the other hinges accommodate. Click the mint pin to move the desired pose; amber shows a miss. These are editable stock objects in the ordinary scene.';},dispose(){}};
}};
