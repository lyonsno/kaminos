import * as THREE from './lib/three.webgpu.js';
const bindings=new WeakMap();
export const residentLightCoverage=mesh=>bindings.get(mesh)??null;
export function bindResidentLightCoverage(mesh,binding){
  if(!mesh?.isMesh||!binding?.owner?.isMesh||typeof binding.read!=='function')throw Error('Resident light coverage requires a mesh owner and current GPU descriptor');
  if(bindings.has(mesh))throw Error('Resident light coverage already bound');
  bindings.set(mesh,binding);
  return ()=>{if(bindings.get(mesh)===binding)bindings.delete(mesh);};
}
export function validateResidentLightCoverage(mesh,binding){
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(mesh.isSkinnedMesh||Array.isArray(mesh.morphTargetInfluences)||Object.values(mesh.geometry.morphAttributes??{}).some(a=>a.length)||materials.some(m=>m.transparent||m.opacity<1||m.alphaMap||m.displacementMap||!m.opacityNode))throw Error('Resident coverage requires opaque node-cutout material without skinning or morphs');
  const value=binding.read(),n=value.dimensions?.[0];
  if(!value.texture||!value.device||!Number.isInteger(n)||n<=0||value.dimensions.some(d=>d!==n)||value.initial?.length!==n**3||!value.bounds?.isBox3)throw Error('Invalid resident light coverage descriptor');
  const size=value.bounds.getSize(new THREE.Vector3());
  if(![...value.bounds.min.toArray(),...size.toArray()].every(Number.isFinite)||Math.min(size.x,size.y,size.z)<=0)throw Error('Invalid resident light coverage bounds');
  return value;
}
// Initial topology only. Current occupancy stays on the GPU; the immutable
// conservative BVH encloses every cell that can survive the burn.
export function residentCellTriangles(value){
  const n=value.dimensions[0],size=value.bounds.getSize(new THREE.Vector3()).divideScalar(n),records=[];
  const cube=new THREE.BoxGeometry(1,1,1),p=cube.attributes.position,index=cube.index;
  for(let cell=0;cell<value.initial.length;cell++)if(value.initial[cell]){
    const center=new THREE.Vector3(cell%n+.5,Math.floor(cell/n)%n+.5,Math.floor(cell/(n*n))+.5).multiply(size).add(value.bounds.min);
    for(let at=0;at<index.count;at+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index.getX(at+j)).multiply(size).add(center).toArray());
      records.push({a:points[0],b:points[1],c:points[2],cell});
    }
  }
  cube.dispose();return records;
}
