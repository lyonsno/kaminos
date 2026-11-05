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
  const sx=size.x,sy=size.y,sz=size.z,minX=value.bounds.min.x,minY=value.bounds.min.y,minZ=value.bounds.min.z;
  const cube=new THREE.BoxGeometry(1,1,1),p=cube.attributes.position,index=cube.index;
  const triOff=new Float64Array(index.count*3);
  for(let k=0;k<index.count;k++){const vi=index.getX(k);triOff[k*3]=p.getX(vi)*sx;triOff[k*3+1]=p.getY(vi)*sy;triOff[k*3+2]=p.getZ(vi)*sz;}
  cube.dispose();
  for(let cell=0;cell<value.initial.length;cell++)if(value.initial[cell]){
    const cx=(cell%n+.5)*sx+minX,cy=(Math.floor(cell/n)%n+.5)*sy+minY,cz=(Math.floor(cell/(n*n))+.5)*sz+minZ;
    for(let at=0;at<index.count;at+=3){
      const o0=at*3,o1=o0+3,o2=o0+6;
      records.push({
        a:[cx+triOff[o0],cy+triOff[o0+1],cz+triOff[o0+2]],
        b:[cx+triOff[o1],cy+triOff[o1+1],cz+triOff[o1+2]],
        c:[cx+triOff[o2],cy+triOff[o2+1],cz+triOff[o2+2]],
        cell,
      });
    }
  }
  return records;
}
