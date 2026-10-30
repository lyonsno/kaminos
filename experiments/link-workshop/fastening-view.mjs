import * as T from '../../lib/three.core.js';
import {mountMatrix,attachmentBase,frameMatrix,connectionOrder} from './mounts.mjs';

// Evaluate the proposed relationship and its dependants on detached transforms.
// No source object, recipe or history is modified by a seating preview.
export function seatingWorlds(root,model,binding,t,entries){
 const next={...model,attachments:[...(model.attachments??[]),binding]};
 const virtual=entries.map(e=>{e.object.updateWorldMatrix(true,false);const object=new T.Object3D();object.matrixAutoUpdate=false;object.matrix.copy(e.object.matrixWorld);object.matrixWorld.copy(e.object.matrixWorld);object.userData.linkMechanism=e.object===root?next:e.object.userData.linkMechanism;return {...e,object};});
 const vr=virtual.find(e=>entries.find(o=>o.id===e.id)?.object===root)?.object;
 const order=connectionOrder(virtual),changed=new Map();
 for(const id of order){for(const owner of virtual){const recipe=owner.object.userData.linkMechanism,a=recipe?.attachments?.find(a=>a.objectId===id);if(!a)continue;const object=virtual.find(e=>e.id===id).object;
 // Other mechanisms retain their current authored pose. Their joint matrices
 // come from the live runtime's frame fraction when available.
 const fraction=owner.object===vr?t:(entries.find(e=>e.id===owner.id)?.object.userData.mechanismFraction??0);
 object.matrix.copy(attachmentBase(owner.object,recipe,a,fraction,virtual,new T.Vector3(...a.offset.scale)).multiply(frameMatrix(a.offset)));object.updateMatrixWorld(true);
 if(!object.matrixWorld.equals(entries.find(e=>e.id===id).object.matrixWorld))changed.set(id,object.matrixWorld.clone());
 }}return changed;
}
export function createFasteningView(root){
 const group=new T.Group();group.name='Fastenings';group.userData.mechanismVisual=true;root.add(group);
 const plate=new T.CylinderGeometry(.21,.21,.055,6),collar=new T.TorusGeometry(.225,.035,8,32),bolt=new T.CylinderGeometry(.035,.035,.025,6);
 const steel=new T.MeshStandardMaterial({color:0x78949b,metalness:.55,roughness:.38}),brass=new T.MeshStandardMaterial({color:0xc69e60,metalness:.6,roughness:.34}),selected=new T.MeshBasicMaterial({color:0xffce70,wireframe:true,transparent:true,opacity:.8,depthWrite:false});
 const ghostMaterial=new T.MeshBasicMaterial({color:0x85e6e2,transparent:true,opacity:.28,depthWrite:false});
 const connections=new Map(),ghost=new T.Group();ghost.name='Seating preview';ghost.userData.mechanismOverlay=true;const overlays=new T.Group();overlays.userData.kaminosEditorOnly=true;overlays.userData.mechanismOverlay=true;group.add(overlays);overlays.add(ghost);
 const mesh=(g,m,parent)=>{const o=new T.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 function make(id){const g=new T.Group(),ends=[new T.Group(),new T.Group()];for(const [i,end]of ends.entries()){g.add(end);const p=mesh(plate,i?brass:steel,end);p.rotation.x=Math.PI/2;p.position.z=i?.0325:-.0325;for(let k=0;k<3;k++){const b=mesh(bolt,brass,end);b.rotation.x=Math.PI/2;b.position.set(.14*Math.cos(k*2*Math.PI/3),.14*Math.sin(k*2*Math.PI/3),i?.072:-.072);}}
 const c=mesh(collar,brass,ends[1]);g.traverse(o=>{if(o.isMesh)o.userData.connection=id;});const highlight=new T.Group();highlight.userData.kaminosEditorOnly=true;highlight.userData.mechanismOverlay=true;g.add(highlight);const h=mesh(collar,selected,highlight);h.scale.setScalar(1.18);h.raycast=()=>{};h.castShadow=false;group.add(g);return {g,ends,c,highlight,h};}
 function clearPreview(){ghost.clear();}
 return {group,connectionMeshes:()=>[...connections.values()].flatMap(v=>{const meshes=[];v.g.traverse(o=>{if(o.isMesh&&o.userData.connection)meshes.push(o);});return meshes;}),
 update(model,t,entries,selection){root.updateWorldMatrix(true,false);group.matrixAutoUpdate=false;group.matrix.copy(root.matrixWorld).invert();const ids=new Set();
 for(const a of model.attachments??[]){if(!a.targetMount)continue;ids.add(a.objectId);let v=connections.get(a.objectId);if(!v){v=make(a.objectId);connections.set(a.objectId,v);}try{const source=mountMatrix(root,model,a.sourceMount,t,entries),target=mountMatrix(root,model,a.targetMount,t,entries);[source,target].forEach((m,i)=>m.decompose(v.ends[i].position,v.ends[i].quaternion,v.ends[i].scale));v.g.visible=true;const aligned=new T.Vector3().setFromMatrixPosition(source).distanceTo(new T.Vector3().setFromMatrixPosition(target))<.02&&Math.abs(v.ends[0].quaternion.dot(v.ends[1].quaternion))>.999;v.c.visible=aligned;v.highlight.position.copy(v.ends[1].position);v.highlight.quaternion.copy(v.ends[1].quaternion);v.h.visible=selection===a.objectId;}catch{v.g.visible=false;}}
 for(const [id,v]of connections)if(!ids.has(id)){v.g.removeFromParent();connections.delete(id);}group.updateMatrixWorld(true);},
 preview(entries,worlds){clearPreview();for(const [id,world]of worlds){const source=entries.find(e=>e.id===id).object;source.updateWorldMatrix(true,true);const delta=world.clone().multiply(source.matrixWorld.clone().invert());source.traverse(o=>{if(!o.isMesh)return;let p=o;while(p&&p!==source){if(!p.visible||p.userData.mechanismOverlay)return;p=p.parent;}const copy=new T.Mesh(o.geometry,ghostMaterial);copy.matrixAutoUpdate=false;copy.matrix.copy(delta).multiply(o.matrixWorld);copy.raycast=()=>{};ghost.add(copy);});}group.updateMatrixWorld(true);},
 clearPreview,showOverlays(enabled){ghost.visible=enabled;},dispose(){group.removeFromParent();for(const g of [plate,collar,bolt])g.dispose();for(const m of [steel,brass,selected,ghostMaterial])m.dispose();}};
}
