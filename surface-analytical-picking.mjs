import * as THREE from './lib/three.webgpu.js';
// Selection uses the same analytical spheres as optical intersection. No
// polygonal grain proxy is introduced into rendering or physics.
export function installAnalyticalPicking(root,spheres){
 root.userData.analyticalSpherePicking=true;root.userData.raycastsAsWhole=true;
 root.geometry.computeBoundingBox();const box=root.geometry.boundingBox;
 for(const s of spheres){box.expandByPoint(new THREE.Vector3(...s.center).addScalar(s.radius));box.expandByPoint(new THREE.Vector3(...s.center).addScalar(-s.radius));}root.geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
 root.raycast=function(raycaster,hits){THREE.Mesh.prototype.raycast.call(this,raycaster,hits);const inverse=this.matrixWorld.clone().invert(),ray=raycaster.ray.clone().applyMatrix4(inverse),sphere=new THREE.Sphere(),point=new THREE.Vector3();
  for(const s of spheres){sphere.center.fromArray(s.center);sphere.radius=s.radius;if(!ray.intersectSphere(sphere,point))continue;const world=point.clone().applyMatrix4(this.matrixWorld),distance=world.distanceTo(raycaster.ray.origin);if(distance<raycaster.near||distance>raycaster.far)continue;hits.push({distance,point:world,object:this,face:{materialIndex:s.materialIndex??0,normal:point.clone().sub(sphere.center).normalize()},faceIndex:null});}
 };
}
