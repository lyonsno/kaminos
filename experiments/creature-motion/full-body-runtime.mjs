import {skinTransport} from '../../hindquarter-live-core.mjs';

// The verified Mushfinger body/weights and same rigid DQ transport, with scene
// attachment left to Hotwet's owner session. No renderer or frame loop here.
export function createFullBodyRuntime({THREE,manifest,rest,triangles,weights}) {
 if(rest.length!==manifest.vertices*3||triangles.length!==manifest.triangles*3||weights.length!==manifest.vertices*manifest.channels.length)throw Error('Incomplete full-body arrays');
 const group=new THREE.Group();group.name='Creature · generated walking';
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xd6b17c,roughness:.72,side:THREE.DoubleSide}));mesh.userData.kaminosDynamicGeometry=true;group.add(mesh);
 const bones=new Map(),inverseRest=new Map();
 for(const spec of manifest.bones){const bone=new THREE.Bone();bone.name=spec.name;bones.set(spec.name,bone);inverseRest.set(spec.name,new THREE.Matrix4().set(...spec.restMatrix.flat()).invert());}
 for(const spec of manifest.bones){
  const bone=bones.get(spec.name),matrix=new THREE.Matrix4().set(...spec.restMatrix.flat());
  if(spec.parent){matrix.premultiply(inverseRest.get(spec.parent));bones.get(spec.parent).add(bone);}else group.add(bone);
  matrix.decompose(bone.position,bone.quaternion,bone.scale);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.035,12,8),new THREE.MeshBasicMaterial({color:0x37d7eb,depthTest:false}));marker.renderOrder=100;bone.add(marker);
 }
 let cached='',updates=0,lastUpdateMs=0;
 function update(){
  group.updateMatrixWorld(true);const inverseGroup=group.matrixWorld.clone().invert();
  const matrices=[new THREE.Matrix4().elements,...manifest.channels.slice(1).map(name=>new THREE.Matrix4().multiplyMatrices(inverseGroup,bones.get(name).matrixWorld).multiply(inverseRest.get(name)).elements)];
  const key=matrices.flat().join(',');if(key===cached)return;
  const begin=performance.now(),result=skinTransport(rest,weights,matrices);
  geometry.attributes.position.array.set(result);geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
  cached=key;updates++;lastUpdateMs=performance.now()-begin;
 }
 const runtime={group,bones,mesh,update,read:()=>({route:'shared-owner-scene-full-body-dq',vertices:manifest.vertices,bones:bones.size,updates,lastUpdateMs}),dispose(){group.traverse(object=>{object.geometry?.dispose();for(const material of [object.material].flat().filter(Boolean))material.dispose();});}};
 update();return runtime;
}
