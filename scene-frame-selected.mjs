import * as THREE from './lib/three.core.js';
import {currentGeometrySnapshot} from './scene-export-geometry.mjs';
export function sceneObjectsForFraming(entries,selectedId=null) {
  return entries.filter(entry=>selectedId===null||entry.id===selectedId).map(entry=>entry.object).filter(Boolean);
}
export function frameSceneObjectRecord(record,camera,controls) {
  return frameObjects(record?.object?[record.object]:[],camera,controls);
}
export function frameObject(object,camera,controls) {
  return frameObjects(object ? [object] : [],camera,controls);
}
export function sceneContentBounds(object,box=new THREE.Box3()) {
  object.updateWorldMatrix(true,true);
  function visit(node){
    if(node.userData.kaminosEditorHelper||node.userData.kaminosEditorOnly)return;
    if(node.boundingBox!==undefined){
      if(node.boundingBox===null)node.computeBoundingBox();
      if(node.boundingBox)box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }else if(node.geometry){
      const geometry=currentGeometrySnapshot(node)??node.geometry;
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      if(geometry.boundingBox)box.union(geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }
    for(const child of node.children)visit(child);
  }
  visit(object);return box;
}
export function frameObjects(objects,camera,controls) {
  const box=new THREE.Box3();
  for(const object of objects) {
    if(!object?.visible)continue;
    object.updateWorldMatrix(true,true);
    const content=sceneContentBounds(object);
    box.union(content);
    // Ordinary authored objects keep their editable pivot in view. Animated
    // placement owners may explicitly frame current content instead of origin.
    if(content.isEmpty()||object.userData.kaminosFrameContentOnly!==true)box.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
  }
  if(box.isEmpty())return false;
  return frameBox(box,camera,controls);
}
export function frameBox(box,camera,controls) {
  const center=box.getCenter(new THREE.Vector3()),radius=box.getSize(new THREE.Vector3()).length()/2;
  if(!Number.isFinite(radius)||radius<=0)return false;
  const vertical=camera.fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*camera.aspect);
  const distance=radius/Math.sin(Math.min(vertical,horizontal))*1.12;
  const direction=camera.position.clone().sub(controls.target).normalize();
  if(direction.lengthSq()===0)direction.set(0,0,1);
  camera.position.copy(center).addScaledVector(direction,distance);controls.target.copy(center);
  camera.near=Math.min(camera.near,Math.max(.001,distance-radius)/10);camera.far=Math.max(camera.far,distance+radius*3);
  camera.updateProjectionMatrix();controls.update();return true;
}
