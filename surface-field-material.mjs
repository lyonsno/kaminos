import {MeshStandardMaterial,MeshPhysicalMaterial} from './lib/three.core.js';
import {MeshStandardNodeMaterial,MeshPhysicalNodeMaterial,TSL} from './lib/three.webgpu.js';

// glTF custom attributes are lowercased by GLTFLoader. Unlike standard glTF's
// texture channels, this pair is interpolated from the raw decoder vertices.
const ATTRIBUTE='_kaminos_material',SCHEMA='vertex-metallic-roughness.v1';
export function installSurfaceFieldMaterials(root){
 const entries=[];
 root.traverse(mesh=>{
  const field=mesh.geometry?.getAttribute(ATTRIBUTE);if(!mesh.isMesh||!field||mesh.material?.userData?.kaminosSurfaceFields===SCHEMA)return;
  const source=mesh.material,physical=source?.isMeshPhysicalMaterial||source?.isMeshPhysicalNodeMaterial;
  if(Array.isArray(source)||!(physical||source?.isMeshStandardMaterial||source?.isMeshStandardNodeMaterial)||field.itemSize!==2||field.count!==mesh.geometry.getAttribute('position')?.count)
   throw Error('Invalid surface material field or PBR material');
  for(let i=0;i<field.count;i++)for(const v of [field.getX(i),field.getY(i)])if(!Number.isFinite(v)||v<0||v>1)throw Error('Invalid surface material field value');
  entries.push({mesh,source,physical});
 });
 for(const e of entries){
  const material=new (e.physical?MeshPhysicalNodeMaterial:MeshStandardNodeMaterial)();
  if(e.source.isNodeMaterial)material.copy(e.source);
  // NodeMaterial.copy alone omits ordinary texture/BRDF properties in our bundle.
  (e.physical?MeshPhysicalMaterial:MeshStandardMaterial).prototype.copy.call(material,e.source);
  const pair=TSL.attribute(ATTRIBUTE,'vec2');material.metalnessNode=pair.x;material.roughnessNode=pair.y;
  material.userData={...e.source.userData,kaminosSurfaceFields:SCHEMA};e.material=material;e.mesh.material=material;
 }
 let disposed=false;
 return {count:entries.length,dispose(){if(disposed)return;disposed=true;for(const e of entries){if(e.mesh.material===e.material)e.mesh.material=e.source;e.material.dispose();}}};
}

export function surfaceFieldMaterialsGLTFPlugin(){
 return {name:'KAMINOS_surface_material_fields',afterRoot(gltf){
  for(const scene of new Set(gltf.scenes??[gltf.scene]))installSurfaceFieldMaterials(scene);
 }};
}
