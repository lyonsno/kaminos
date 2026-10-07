// One independent WebGL2 preview context; scene/inference device is untouched.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
let renderer,initializing,tail=Promise.resolve();
const cache=new Map();
async function preview(entry){
 if(!initializing){renderer=new THREE.WebGPURenderer({forceWebGL:true,alpha:false,antialias:true});renderer.setSize(256,160);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;initializing=renderer.init();}
 await initializing;
 const model=(await new GLTFLoader().loadAsync(entry.source)).scene;
 try{
  let meshes=0;model.traverse(object=>{if(object.isMesh)meshes++;});model.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model);if(!meshes||box.isEmpty())throw Error('Mesh has no visible geometry');
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=size.length()/2;
  model.position.sub(center);const scene=new THREE.Scene();scene.background=new THREE.Color('#242629');scene.add(model,new THREE.HemisphereLight(0xffffff,0x454b59,2));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
  const camera=new THREE.PerspectiveCamera(35,256/160,radius/100,radius*100);camera.position.set(1,.65,1.5).normalize().multiplyScalar(radius/Math.sin(35*Math.PI/360)*1.12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }finally{
  const disposed=new Set();model.traverse(object=>{object.geometry?.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){for(const value of Object.values(material))if(value?.isTexture&&!disposed.has(value)){disposed.add(value);value.dispose();}material.dispose();}});
 }
}
export function meshThumbnail(entry,isCurrent=()=>true){
 const key=JSON.stringify([entry.source,entry.mtime,entry.size]);
 const existing=cache.get(key);if(existing){existing.checks?.add(isCurrent);return existing.promise;}
 const record={checks:new Set([isCurrent]),promise:null};
 // Serial rendering owns one context; queued work for closed/removed cards is
 // skipped. Every catalog entry remains available regardless of preview state.
 const result=tail.then(()=>{const wanted=[...record.checks].some(check=>check());record.checks=null;if(!wanted){cache.delete(key);return null;}return preview(entry);});
 record.promise=result;tail=result.catch(()=>{});cache.set(key,record);result.catch(()=>{if(cache.get(key)===record)cache.delete(key);});return result;
}
