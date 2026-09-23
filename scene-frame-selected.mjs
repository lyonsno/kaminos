import * as THREE from './lib/three.core.js';
export function sceneObjectsForFraming(entries,selectedId=null) {
  return entries.filter(entry=>selectedId===null||entry.id===selectedId).map(entry=>entry.object).filter(Boolean);
}
export function frameSceneObjectRecord(record,camera,controls) {
  const position=record?.type==='splat'?record.sceneTransform?.position:null;
  const authoredPoint=record?.object?.visible&&Array.isArray(position)&&position.length>=3&&position.slice(0,3).every(Number.isFinite)
    ? new THREE.Vector3(position[0],position[1],position[2])
    : null;
  return frameObjects(record?.object?[record.object]:[],camera,controls,authoredPoint?[authoredPoint]:[]);
}
function authoredSplatScenePoint(object) {
  const position=object?.userData?.kaminosSceneObject?.sceneTransform?.position;
  if(!Array.isArray(position)||position.length<3||!position.slice(0,3).every(Number.isFinite))return null;
  return new THREE.Vector3(position[0],position[1],position[2]);
}
export function frameObject(object,camera,controls) {
  // Corrected splats render from a centroid-shifted root while their authored
  // scene transform remains the placement/pivot used by selection and edits.
  // Include both so F restores the pivot without cropping the visible cloud.
  const authoredPoint=object?.visible?authoredSplatScenePoint(object):null;
  return frameObjects(object ? [object] : [],camera,controls,authoredPoint?[authoredPoint]:[]);
}
export function frameObjects(objects,camera,controls,extraPoints=[]) {
  const box=new THREE.Box3();
  for(const object of objects) {
    if(!object?.visible)continue;
    object.updateWorldMatrix(true,true);
    box.union(new THREE.Box3().setFromObject(object));
    box.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
  }
  for(const point of extraPoints)if(point?.isVector3&&[point.x,point.y,point.z].every(Number.isFinite))box.expandByPoint(point);
  if(box.isEmpty())return false;
  return frameBox(box,camera,controls);
}
function frameBox(box,camera,controls) {
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
