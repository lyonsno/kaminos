import {Group,BoxGeometry,InstancedMesh,MeshStandardNodeMaterial,StorageBufferAttribute,Matrix4,Box3,Vector3,Sphere} from './lib/three.webgpu.js';
import {storage,instanceIndex,positionGeometry,vec3} from './lib/three.tsl.js';
import {validateVoxelFrame} from './models/trellis2/voxel-history.js';

// Uses the app renderer and its existing device. Packed scalar i32 storage avoids
// vec3 alignment padding, and no live coordinates pass through CPU/canvas.
export function createTrellisVoxelVisual({renderer,frame,coordinates=null}){
 validateVoxelFrame(frame,coordinates??undefined);
 if(renderer?.backend?.isWebGPUBackend!==true)throw Error('TRELLIS voxel view requires the actual app WebGPU renderer');
 const root=new Group();root.name='TRELLIS · '+frame.stage;root.visible=false;
 root.applyMatrix4(new Matrix4().fromArray(frame.spatial.sourceToGltf));
 let geometry,material,mesh,attribute,disposed=false;
 if(frame.count){
  const values=coordinates??new Int32Array(frame.count*3);
  attribute=new StorageBufferAttribute(values,1);attribute.name='trellis-voxel:'+frame.runId+':'+frame.id;
  renderer.backend.createStorageAttribute(attribute);
  const rows=storage(attribute,'int',values.length).toReadOnly(),i=instanceIndex.mul(3);
  const center=vec3(rows.element(i).toFloat(),rows.element(i.add(1)).toFloat(),rows.element(i.add(2)).toFloat());
  const {scale,offset}=frame.spatial.gridToSource,c=frame.spatial.cellCenterOffset;
  geometry=new BoxGeometry(...scale);
  material=new MeshStandardNodeMaterial({color:0x46c2ac,roughness:.68,metalness:0});
  material.positionNode=positionGeometry.add(center.add(vec3(...c)).mul(vec3(...scale)).add(vec3(...offset)));
  mesh=new InstancedMesh(geometry,material,frame.count);mesh.name=root.name;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;
  // This is a safe full-grid bound, not a CPU reconstruction of GPU coordinates.
  const max=frame.grid.dimensions.map((d,a)=>offset[a]+d*scale[a]);
  mesh.boundingBox=new Box3(new Vector3(...offset),new Vector3(...max));mesh.boundingSphere=new Sphere(new Vector3(0,0,0),Math.sqrt(3));
  root.add(mesh);
 }
 const buffer=()=>attribute?renderer.backend.get(attribute).buffer:null;
 return {root,frame,buffer,
  read:()=>({route:'kaminos-native-scene/storage-i32-instanced-cells',runId:frame.runId,frameId:frame.id,count:frame.count,coordinateBytesToCPUForDisplay:0,registered:!!root.parent,visible:root.visible}),
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();
   // Storage nodes are not ordinary geometry attributes. Their owner releases the
   // renderer attribute explicitly (including a never-rendered retained frame).
   if(attribute){if(renderer._attributes?.has(attribute))renderer._attributes.delete(attribute);else if(renderer.backend.get(attribute).buffer)renderer.backend.destroyAttribute(attribute);}
   mesh?.dispose();geometry?.dispose();material?.dispose();
  },
 };
}
