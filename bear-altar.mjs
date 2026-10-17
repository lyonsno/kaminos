import * as THREE from './lib/three.webgpu.js';

export const ALTAR_BEAR={root:'generated-meshes',path:'stunt-doubles/bear-trellis2-webgpu-r512-lod50k-decimate-tex1024-a9e7129b.glb',sha256:'a9e7129b7e2b7380e84efdd7c1f719b99f0b36f5481d396de0ce6df632e68457'};

export function createBearAltar(){
 const root=new THREE.Group();root.name='Midsummer altar';
 const wood=new THREE.MeshStandardMaterial({color:0x9b7954,roughness:.88}),end=new THREE.MeshStandardMaterial({color:0x493e31,roughness:1});
 const white=new THREE.MeshStandardMaterial({color:0xf4f6ee,roughness:.8}),yellow=new THREE.MeshStandardMaterial({color:0xe6bf34,roughness:.6}),green=new THREE.MeshStandardMaterial({color:0x426b40,roughness:.9});
 const add=(geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;};
 add(new THREE.CylinderGeometry(.86,.92,.1,8),end,0,-.79,0);
 for(let i=0;i<7;i++)add(new THREE.BoxGeometry(.22,.09,1.55),wood,(i-3)*.225,-.695,0);
 const stem=new THREE.CylinderGeometry(.012,.015,.45,5),petal=new THREE.SphereGeometry(.037,5,3),centre=new THREE.SphereGeometry(.027,6,4);
 for(let i=0;i<28;i++){
  const angle=i*Math.PI*2/28,r=.88+Math.sin(i*2.4)*.045,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
  add(stem,green,x,-.64,z).rotation.z=Math.sin(angle)*.35;
  for(let j=0;j<5;j++){const a=j*Math.PI*2/5;add(petal,white,x+Math.cos(a)*.045,-.415,z+Math.sin(a)*.045).scale.set(1,.35,.65);}
  add(centre,yellow,x,-.405,z);
 }
 for(const x of [-.78,.78]){
  add(new THREE.BoxGeometry(.055,.85,.055),wood,x,-.22,.68);
  const pennant=add(new THREE.ConeGeometry(.11,.28,3),white,x,.12,.68);pennant.rotation.z=Math.PI;
 }
 return root;
}

export function placeAltarBear(root){
 root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());
 root.scale.multiplyScalar(1.1/size.y);root.updateWorldMatrix(true,true);box.setFromObject(root);
 const centre=box.getCenter(new THREE.Vector3());root.position.add(new THREE.Vector3(-centre.x,-.64-box.min.y,-centre.z));root.updateWorldMatrix(true,true);
}
