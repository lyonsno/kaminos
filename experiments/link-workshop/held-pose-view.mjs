import * as T from '../../lib/three.core.js';
import {frameMatrix} from './mounts.mjs';
// One editor-only desired-pose ghost shares the real panel's geometry. The pin
// is a native component target; it is not a second independently posed body.
export function createHeldPoseView(root){
 const group=new T.Group(),ghost=new T.Group(),pin=new T.Mesh(new T.OctahedronGeometry(.105),new T.MeshBasicMaterial({color:0x80e2d3,depthTest:false,toneMapped:false})),material=new T.MeshBasicMaterial({color:0x8cddd2,transparent:true,opacity:.12,depthWrite:false,side:T.DoubleSide}),lineGeometry=new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3()]),lineMaterial=new T.LineBasicMaterial({color:0xf0aa66,depthTest:false}),line=new T.Line(lineGeometry,lineMaterial);
 group.userData.kaminosEditorOnly=true;group.userData.mechanismOverlay=true;pin.userData.poseHold=true;pin.renderOrder=120;group.add(ghost,pin,line);root.add(group);let source=null,meshes=[];
 return {pin,group,update(state,entries,visible){group.visible=!!state&&visible&&!!state.actual;if(!group.visible)return;const object=entries.find(e=>e.id===state.objectId)?.object;if(!object){group.visible=false;return;}object.updateWorldMatrix(true,true);root.updateWorldMatrix(true,false);group.matrixAutoUpdate=false;group.matrix.copy(root.matrixWorld).invert();
  const found=[];object.traverse(o=>{if(o.isMesh&&o.visible&&!o.userData.kaminosEditorOnly)found.push(o);});if(source!==object||found.length!==meshes.length||found.some((o,i)=>o!==meshes[i])){ghost.clear();meshes=found;source=object;for(const o of meshes){const copy=new T.Mesh(o.geometry,material);copy.matrixAutoUpdate=false;copy.raycast=()=>{};ghost.add(copy);}}
  const desired=frameMatrix(state.target),actual=frameMatrix(state.actual),delta=desired.clone().multiply(actual.invert());meshes.forEach((o,i)=>ghost.children[i].matrix.copy(delta).multiply(o.matrixWorld));pin.position.setFromMatrixPosition(desired);pin.material.color.setHex(state.status==='held'?0x80e2d3:0xf0aa66);
  const a=lineGeometry.attributes.position;a.setXYZ(0,...state.target.position);a.setXYZ(1,...state.actual.position);a.needsUpdate=true;lineGeometry.computeBoundingSphere();line.visible=state.positionError>1e-6;group.updateMatrixWorld(true);
 },dispose(){group.removeFromParent();pin.geometry.dispose();pin.material.dispose();material.dispose();lineGeometry.dispose();lineMaterial.dispose();}};
}
