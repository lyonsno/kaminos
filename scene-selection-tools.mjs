import * as THREE from './lib/three.webgpu.js';
import {pass,vec2,vec4,mix,textureSize,screenUV,uniform} from './lib/three.tsl.js';
// Dedicated selection mask: never inserts helper geometry into authored scene,
// depth, fire-light shadow inputs, export, or serialization.
export function createSelectionFeedback(camera,baseOutput) {
  const maskScene=new THREE.Scene();maskScene.background=new THREE.Color(0);
  const material=new THREE.MeshBasicNodeMaterial({color:0xffffff,side:THREE.DoubleSide});
  const maskPass=pass(maskScene,camera),mask=maskPass.getTextureNode();
  const pixel=vec2(1.5).div(vec2(textureSize(mask)));
  let dilated=mask.sample(screenUV.add(vec2(pixel.x,0))).r;
  for(const offset of [vec2(pixel.x.negate(),0),vec2(0,pixel.y),vec2(0,pixel.y.negate())])dilated=dilated.max(mask.sample(screenUV.add(offset)).r);
  const enabled=uniform(1),edge=dilated.sub(mask.sample(screenUV).r).clamp(0,1).mul(enabled);
  const output=mix(baseOutput,vec4(1,.38,.04,1),edge);
  let target=null,pairs=[];
  function update(next) {
    if(target!==next) {
      target=next;maskScene.clear();pairs=[];
      next?.traverseVisible(source=>{
        // Static authored meshes; skinned/instanced/splat outlines need their
        // own deformation/render adapter and are not approximated here.
        if(!source.isMesh || source.isSkinnedMesh || source.isInstancedMesh)return;
        const proxy=new THREE.Mesh(source.geometry,material);proxy.matrixAutoUpdate=false;
        pairs.push([source,proxy]);maskScene.add(proxy);
      });
    }
    next?.updateWorldMatrix(true,true);
    for(const [source,proxy] of pairs){proxy.matrix.copy(source.matrixWorld);proxy.visible=source.visible;}
  }
  return {output,update,suspend(value){enabled.value=value?0:1;},state:()=>({meshes:pairs.length,selected:!!target})};
}
