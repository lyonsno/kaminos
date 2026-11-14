import {PerspectiveCamera,Matrix4,Vector3} from './lib/three.core.js';
import {checkedCameraView} from './scene-camera-views.mjs';
export function checkedParticleInspectionView(value){
 if(value===null)return null;
 const view=checkedCameraView(value),zoom=value.zoom??1;
 if(!Number.isFinite(zoom)||zoom<=0)throw Error('Integral view zoom must be positive');
 return {...view,zoom};
}
// The optical camera is a projection basis only. Material acquisition and the
// actual viewing camera retain their existing owners.
export function particleInspectionProjection(value,frame,aspect,coordinateSystem){
 const view=checkedParticleInspectionView(value);
 if(!Number.isFinite(aspect)||aspect<=0||!Array.isArray(frame.translate)||frame.translate.length!==3||!frame.translate.every(Number.isFinite)||!Number.isFinite(frame.scale)||frame.scale<=0)throw Error('Invalid integral view domain');
 const c=new PerspectiveCamera(view.fov,aspect,view.near,view.far);if(coordinateSystem!==undefined)c.coordinateSystem=coordinateSystem;
 c.zoom=view.zoom;c.position.fromArray(view.position);c.up.fromArray(view.up);c.lookAt(new Vector3(...view.target));c.updateMatrixWorld(true);c.updateProjectionMatrix();
 const model=new Matrix4().makeScale(frame.scale,frame.scale,frame.scale).setPosition(...frame.translate);
 const vp=new Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse).multiply(model);
 return {viewProj:vp.toArray(),inverse:vp.clone().invert().toArray()};
}
