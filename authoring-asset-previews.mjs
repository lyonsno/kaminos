// One independent WebGL2 preview context; scene/inference device is untouched.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AssetKTX2Loader as KTX2Loader} from './asset-ktx2-loader.mjs';
import {configureAssetTextures} from './asset-texture-support.mjs';
import {thumbnailDistance} from './authoring-browse-layout.mjs';
import {createAssetPreviewQueue} from './asset-preview-queue.mjs';
let renderer,initializing;
async function preview(entry,size){
 if(!initializing){renderer=new THREE.WebGPURenderer({forceWebGL:true,alpha:false,antialias:true});renderer.setSize(size,size);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;initializing=renderer.init();}
 await initializing;renderer.setSize(size,size);
 const model=(await configureAssetTextures(new GLTFLoader(),renderer,()=>new KTX2Loader()).loadAsync(entry.source)).scene;
 try{
  let meshes=0;model.traverse(object=>{if(object.isMesh)meshes++;});model.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model);if(!meshes||box.isEmpty())throw Error('Mesh has no visible geometry');
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=size.length()/2;
  model.position.sub(center);const scene=new THREE.Scene();scene.background=new THREE.Color('#242629');scene.add(model,new THREE.HemisphereLight(0xffffff,0x454b59,2));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
  // Square tiles: fit the object's box rather than its bounding sphere.
  const camera=new THREE.PerspectiveCamera(35,1,radius/100,radius*100);camera.position.set(1,.65,1.5).normalize().multiplyScalar(thumbnailDistance({size:size.toArray(),fovDeg:35,aspect:1}));camera.lookAt(0,0,0);camera.updateMatrixWorld();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }finally{
  const disposed=new Set();model.traverse(object=>{object.geometry?.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){for(const value of Object.values(material))if(value?.isTexture&&!disposed.has(value)){disposed.add(value);value.dispose();}material.dispose();}});
 }
}
const queue=createAssetPreviewQueue(preview);
export const meshThumbnail=queue.thumbnail;
export const meshPreview=queue.detail;
