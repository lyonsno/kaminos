import * as THREE from './lib/three.core.js';

// Native boxes and dock members have authored geometry, not inferred GLB bounds.
export function collectSpaceNeighborhood(root,recipe,entries){
 root.updateWorldMatrix(true,false);const inverse=root.matrixWorld.clone().invert(),boxes=[],unavailable=[];
 for(const id of recipe.neighbors??[]){
  const entry=entries.find(e=>e.id===id);if(!entry){unavailable.push({id,reason:'missing scene object'});continue;}
  let meshes=[];
  if(entry.object.userData.stockroomDock)meshes=entry.object.children.filter(o=>o.userData.dockMember);
  else if(entry.type==='procedural-mesh'&&entry.geometry?.kind==='box')meshes=[entry.object];
  else{unavailable.push({id,reason:'requires authored box or dock-member geometry'});continue;}
  entry.object.updateWorldMatrix(true,true);
  for(const mesh of meshes){
   mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox,matrix=inverse.clone().multiply(mesh.matrixWorld);
   if(Math.abs(matrix.determinant())<1e-12){unavailable.push({id,reason:'collapsed construction frame'});continue;}
   boxes.push({id,member:mesh.name,matrix:matrix.toArray(),min:bounds.min.toArray(),max:bounds.max.toArray()});
  }
 }
 const ids=[...(recipe.neighbors??[])],signature=JSON.stringify({ids,boxes,unavailable});return {ids,boxes,unavailable,signature};
}
export function compileNeighborBoxes(boxes){return boxes.map(box=>{
 const matrix=new THREE.Matrix4().fromArray(box.matrix),e=matrix.clone().invert().elements,center=box.min.map((v,i)=>(v+box.max[i])/2),half=box.min.map((v,i)=>(box.max[i]-v)/2);
 const scale=Math.min(...[0,1,2].map(i=>Math.hypot(...matrix.elements.slice(i*4,i*4+3))));
 return (x,y,z)=>{
  const a=Math.abs(e[0]*x+e[4]*y+e[8]*z+e[12]-center[0])-half[0],b=Math.abs(e[1]*x+e[5]*y+e[9]*z+e[13]-center[1])-half[1],c=Math.abs(e[2]*x+e[6]*y+e[10]*z+e[14]-center[2])-half[2];
  return (Math.hypot(Math.max(a,0),Math.max(b,0),Math.max(c,0))+Math.min(Math.max(a,b,c),0))*scale;
 };
});}
export function nearestSpaceBoundary(context,point,{horizontal=false}={}){
 let nearest=null;
 for(const box of context.boxes){
  const matrix=new THREE.Matrix4().fromArray(box.matrix),p=new THREE.Vector3(...point).applyMatrix4(matrix.clone().invert()),coordinates=p.toArray(),outside=coordinates.map((v,i)=>Math.max(box.min[i]-v,v-box.max[i],0));
  let axis=outside.indexOf(Math.max(...outside)),sign;
  if(outside[axis]>0)sign=coordinates[axis]>box.max[axis]?1:-1;
  else{const gaps=coordinates.map((v,i)=>Math.min(v-box.min[i],box.max[i]-v));axis=gaps.indexOf(Math.min(...gaps));sign=coordinates[axis]>(box.min[axis]+box.max[axis])/2?1:-1;}
  const face=coordinates.map((v,i)=>Math.max(box.min[i],Math.min(box.max[i],v)));face[axis]=sign>0?box.max[axis]:box.min[axis];
  const normal=new THREE.Vector3();normal.setComponent(axis,sign);normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();if(horizontal&&Math.abs(normal.y)>.6)continue;
  const contact=new THREE.Vector3(...face).applyMatrix4(matrix),distance=contact.distanceTo(new THREE.Vector3(...point));
  if(!nearest||distance<nearest.distance)nearest={id:box.id,member:box.member,point:contact.toArray(),normal:normal.toArray(),distance};
 }
 return nearest;
}
