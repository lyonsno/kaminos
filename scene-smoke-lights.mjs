import * as THREE from './lib/three.webgpu.js';
import {validateSceneSourceTransform,sceneSourceLocalPoint} from './scene-volume-source.mjs';

// Read the actual Three lights used by the scene, not a second lighting recipe.
export function collectSceneSmokeLights(scene,sourceTransform){
 const transform=validateSceneSourceTransform(sourceTransform),lights=[],unsupported=[];
 const position=new THREE.Vector3(),target=new THREE.Vector3();
 scene.traverseVisible(light=>{
  if(!light.isLight||light.intensity===0)return;
  const type=light.isSpotLight?'spot':light.isPointLight?'point':light.isDirectionalLight?'directional':null;
  if(!type){unsupported.push({id:light.uuid,type:light.type});return;}
  if(light.map||light.colorNode)throw Error('Projected scene-light textures are not supported by smoke lighting');
  light.getWorldPosition(position);
  const direction=type==='point'?[0,0,-1]:light.target.getWorldPosition(target).sub(position).normalize().toArray();
  lights.push({id:light.uuid,type,position:sceneSourceLocalPoint(position.toArray(),transform),direction,
   color:light.color.toArray().map(c=>c*light.intensity),decay:light.decay??0,distance:light.distance??0,
   coneCos:type==='spot'?Math.cos(light.angle):-1,penumbraCos:type==='spot'?Math.cos(light.angle*(1-light.penumbra)):-1,
   castShadow:light.castShadow===true});
 });
 return {lights,worldScale:transform.scale,unsupported};
}

export function packSceneSmokeLights(packet={lights:[],worldScale:1,unsupported:[]}){
 const {lights,worldScale}=packet;
 if(!Array.isArray(lights)||!Number.isFinite(worldScale)||worldScale<=0)throw Error('valid scene-light packet and positive source world scale required');
 const data=new Float32Array(Math.max(1,lights.length)*16),visibility=[];
 lights.forEach((light,i)=>{
  const type={point:1,spot:2,directional:3}[light.type];
  if(!type||![light.position,light.direction,light.color].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))
   ||![light.decay,light.distance,light.coneCos,light.penumbraCos].every(Number.isFinite)
   ||light.color.some(v=>v<0)||light.decay<0||light.distance<0||typeof light.castShadow!=='boolean'
   ||(type!==1&&Math.abs(Math.hypot(...light.direction)-1)>1e-5))throw Error('invalid punctual smoke scene light');
  data.set([...light.position,type,...light.color,light.decay,...light.direction,light.distance,light.coneCos,light.penumbraCos,light.castShadow?1:0,0],i*16);
  visibility.push([light.id,type,light.position,type===3?light.direction:null,light.castShadow]);
 });
 return {data,count:lights.length,worldScale,visibilityKey:JSON.stringify(visibility),
  metadata:{count:lights.length,ids:lights.map(l=>l.id),types:lights.map(l=>l.type),unsupported:packet.unsupported??[],route:'actual-scene-punctual-isotropic-v1'}};
}
