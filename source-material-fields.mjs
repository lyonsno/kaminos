import * as THREE from './lib/three.webgpu.js';
export function populateSourceMaterialFields(geometry,source){
 const count=source.triangles.length*3,colors=new Float32Array(count*3),roughness=new Float32Array(count),metalness=new Float32Array(count);
 for(const [i,triangle]of source.triangles.entries()){
  const m=source.materials[triangle.materialIndex];if(!m||m.color?.length!==3||!m.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(m.roughness)||m.roughness<0||m.roughness>1||!Number.isFinite(m.metalness)||m.metalness<0||m.metalness>1)throw Error('Invalid source PBR field');
  for(let v=0;v<3;v++){colors.set(m.color,(i*3+v)*3);roughness[i*3+v]=m.roughness;metalness[i*3+v]=m.metalness;}
 }
 geometry.setAttribute('sourceColor',new THREE.BufferAttribute(colors,3));geometry.setAttribute('sourceRoughness',new THREE.BufferAttribute(roughness,1));geometry.setAttribute('sourceMetalness',new THREE.BufferAttribute(metalness,1));
}
export function createSourceFieldMaterial({tracing=false}={}){
 const m=new THREE.MeshStandardNodeMaterial({side:THREE.DoubleSide,colorWrite:!tracing,depthWrite:!tracing});
 m.colorNode=THREE.TSL.attribute('sourceColor','vec3');m.roughnessNode=THREE.TSL.attribute('sourceRoughness','float');m.metalnessNode=THREE.TSL.attribute('sourceMetalness','float');return m;
}
