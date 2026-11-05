import {buildHingeParts,disposePart} from './hinge-primitives.mjs';
import * as T from '../../lib/three.core.js';
import {mountMatrix,attachmentBase,frameMatrix,connectionOrder,hingeWorldFrame,hingeAngle} from './mounts.mjs';

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
 const plate=new T.CylinderGeometry(.21,.21,.055,6),collar=new T.TorusGeometry(.225,.035,8,32),bolt=new T.CylinderGeometry(.035,.035,.025,6),axle=new T.CylinderGeometry(.068,.068,.26,18);
 const steel=new T.MeshStandardMaterial({color:0x78949b,metalness:.55,roughness:.38}),brass=new T.MeshStandardMaterial({color:0xc69e60,metalness:.6,roughness:.34}),selected=new T.MeshBasicMaterial({color:0xffce70,wireframe:true,transparent:true,opacity:.8,depthWrite:false});
 const ghostMaterial=new T.MeshBasicMaterial({color:0x85e6e2,transparent:true,opacity:.28,depthWrite:false});
 const patchGeometry=new T.PlaneGeometry(1,1),patchEdges=new T.EdgesGeometry(patchGeometry);
 const patchMaterials=[0xffc36b,0x6ee4dc].map(color=>new T.MeshBasicMaterial({color,transparent:true,opacity:.2,side:T.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));
 const edgeMaterials=[0xffc36b,0x6ee4dc].map(color=>new T.LineBasicMaterial({color,transparent:true,opacity:.9,depthTest:false,depthWrite:false,toneMapped:false}));
 const connections=new Map(),ghost=new T.Group();ghost.name='Seating preview';ghost.userData.mechanismOverlay=true;const overlays=new T.Group();overlays.userData.kaminosEditorOnly=true;overlays.userData.mechanismOverlay=true;group.add(overlays);overlays.add(ghost);
 const mesh=(g,m,parent)=>{const o=new T.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 function make(id){const g=new T.Group(),ends=[new T.Group(),new T.Group()];for(const [i,end]of ends.entries()){g.add(end);const p=mesh(plate,i?brass:steel,end);p.rotation.x=Math.PI/2;p.position.z=i?.0325:-.0325;for(let k=0;k<3;k++){const b=mesh(bolt,brass,end);b.rotation.x=Math.PI/2;b.position.set(.14*Math.cos(k*2*Math.PI/3),.14*Math.sin(k*2*Math.PI/3),i?.072:-.072);}}
 const c=mesh(collar,brass,ends[1]),pin=mesh(axle,brass,ends[0]);pin.rotation.x=Math.PI/2;pin.userData.hingePin=true;g.traverse(o=>{if(o.isMesh)o.userData.connection=id;});const highlight=new T.Group();highlight.userData.kaminosEditorOnly=true;highlight.userData.mechanismOverlay=true;g.add(highlight);const h=mesh(collar,selected,highlight);h.scale.setScalar(1.18);h.raycast=()=>{};h.castShadow=false;const guides=ends.map((end,i)=>{const guide=new T.Group();guide.userData.kaminosEditorOnly=true;guide.userData.mechanismOverlay=true;end.add(guide);const patch=new T.Mesh(patchGeometry,patchMaterials[i]);patch.position.z=i?.009:-.009;patch.renderOrder=110;patch.raycast=()=>{};guide.add(patch);const edges=new T.LineSegments(patchEdges,edgeMaterials[i]);edges.position.copy(patch.position);edges.renderOrder=111;edges.raycast=()=>{};guide.add(edges);return guide;});
 group.add(g);return {g,ends,c,pin,highlight,h,guides,hardware:[],hardwareKey:null};}
 function clearPreview(){ghost.clear();}
 return {group,selectedObjects:id=>connections.get(id)?.ends??[],connectionMeshes:()=>[...connections.values()].flatMap(v=>{const meshes=[];v.g.traverse(o=>{if(o.isMesh&&o.userData.connection){let parent=o;while(parent&&parent.visible)parent=parent.parent;if(!parent)meshes.push(o);}});return meshes;}),
 update(model,t,entries,selection,editing){root.updateWorldMatrix(true,false);group.matrixAutoUpdate=false;group.matrix.copy(root.matrixWorld).invert();const ids=new Set();
 for(const a of model.attachments??[]){if(!a.targetMount)continue;ids.add(a.objectId);let v=connections.get(a.objectId);if(!v){v=make(a.objectId);connections.set(a.objectId,v);}try{const source=mountMatrix(root,model,a.sourceMount,t,entries),target=mountMatrix(root,model,a.targetMount,t,entries);[source,target].forEach((m,i)=>m.decompose(v.ends[i].position,v.ends[i].quaternion,v.ends[i].scale));v.g.visible=true;
 const hardwareKey=a.hardware?JSON.stringify([a.hardware.family,a.hardware.size,a.hardware.appearanceId??a.hardware.parts??null]):null;if(hardwareKey!==v.hardwareKey){v.hardware.forEach(disposePart);v.hardware=a.hardware?buildHingeParts(a.hardware):[];v.hardwareKey=hardwareKey;for(const part of v.hardware){part.traverse(o=>{if(o.isMesh)o.userData.connection=a.objectId;});v.g.add(part);}}
 if(v.hardware.length){const axle=hingeWorldFrame(root,model,a,t,entries);for(const part of v.hardware){const m=axle.clone();if(part.userData.hingePart.id==='moving')m.multiply(new T.Matrix4().makeRotationZ(hingeAngle(a,t)));m.decompose(part.position,part.quaternion,part.scale);}}
 for(const end of v.ends)for(const o of end.children)if(!o.userData.kaminosEditorOnly)o.visible=!v.hardware.length;
 const aligned=new T.Vector3().setFromMatrixPosition(source).distanceTo(new T.Vector3().setFromMatrixPosition(target))<.02&&Math.abs(v.ends[0].quaternion.dot(v.ends[1].quaternion))>.999;v.c.visible=aligned&&!v.hardware.length;v.pin.visible=Array.isArray(a.hinge)&&!v.hardware.length;v.highlight.position.copy(v.ends[0].position);v.highlight.quaternion.copy(v.ends[0].quaternion);v.h.visible=selection===a.objectId;for(const [i,guide]of v.guides.entries()){guide.visible=selection===a.objectId;guide.scale.setScalar(i?1.5:.9);}v.h.scale.setScalar(editing===a.objectId?1.4:1.18);}catch{v.g.visible=false;}}
 for(const [id,v]of connections)if(!ids.has(id)){v.hardware.forEach(disposePart);v.g.removeFromParent();connections.delete(id);}group.updateMatrixWorld(true);},
 preview(entries,worlds){clearPreview();for(const [id,world]of worlds){const source=entries.find(e=>e.id===id).object;source.updateWorldMatrix(true,true);const delta=world.clone().multiply(source.matrixWorld.clone().invert());source.traverse(o=>{if(!o.isMesh)return;let p=o;while(p&&p!==source){if(!p.visible||p.userData.mechanismOverlay)return;p=p.parent;}const copy=new T.Mesh(o.geometry,ghostMaterial);copy.matrixAutoUpdate=false;copy.matrix.copy(delta).multiply(o.matrixWorld);copy.raycast=()=>{};ghost.add(copy);});}group.updateMatrixWorld(true);},
 clearPreview,showOverlays(enabled){ghost.visible=enabled;},dispose(){for(const v of connections.values())v.hardware.forEach(disposePart);group.removeFromParent();for(const g of [plate,collar,bolt,axle,patchGeometry,patchEdges])g.dispose();for(const m of [steel,brass,selected,ghostMaterial,...patchMaterials,...edgeMaterials])m.dispose();}};
}
