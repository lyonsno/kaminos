import * as THREE from './lib/three.webgpu.js';
import {pass,vec2,vec4,mix,textureSize,screenUV,uniform} from './lib/three.tsl.js';

// This mask owns no authored geometry/materials. It never enters lighting,
// simulation, serialization or export, and is suspended during clean capture.
export function createSelectionFeedback(camera) {
  const maskScene=new THREE.Scene();maskScene.background=new THREE.Color(0);
  const selected=new THREE.MeshBasicNodeMaterial({color:0xff0000,side:THREE.DoubleSide});
  const active=new THREE.MeshBasicNodeMaterial({color:0x00ff00,side:THREE.DoubleSide});
  const maskPass=pass(maskScene,camera),mask=maskPass.getTextureNode(),width=uniform(1.5),opacity=uniform(1),pixel=vec2(width).div(vec2(textureSize(mask))),enabled=uniform(1);
  let dilation=mask.sample(screenUV).rg;
  for(const offset of [vec2(pixel.x,0),vec2(pixel.x.negate(),0),vec2(0,pixel.y),vec2(0,pixel.y.negate())])dilation=dilation.max(mask.sample(screenUV.add(offset)).rg);
  const edges=dilation.sub(mask.sample(screenUV).rg).clamp(0,1).mul(enabled).mul(opacity);
  const pairs=[],masks=createSelectionMaskProxies(maskScene,{selected,active,pairs});
  const update=masks.update;
  return{update,setStyle(style){width.value=style.width;opacity.value=style.opacity;},suspend(value){enabled.value=value?0:1;},output:base=>mix(mix(base,vec4(1,.38,.04,1),edges.x),vec4(1,.72,.22,1),edges.y),state:()=>({meshCount:pairs.length,activeCount:pairs.filter(p=>p.proxy.material===active).length,suspended:enabled.value===0})};
}

// The mask scene's proxies: one per drawn mesh of each selected object, sharing its geometry (and, for an
// instanced mesh such as a TRELLIS surfel chunk, its instance matrices). Proxies exist for hidden parts
// too (LOD levels), and each frame a proxy shows only while its source and the source's ancestors are visible.
function createSelectionMaskProxies(maskScene,{selected,active,pairs=[]}){
  let roots=[];
  const shown=(source,root)=>{for(let o=source;o;o=o.parent){if(!o.visible)return false;if(o===root)return true;}return true;};
  function update(entries,activeIds){
    const next=entries.map(entry=>entry.object),activeSet=new Set(activeIds);
    if(next.length!==roots.length||next.some((object,i)=>object!==roots[i])){
      roots=next;maskScene.clear();pairs.length=0;
      for(const entry of entries)entry.object.traverse(source=>{
        if(!source.isMesh||source.isSkinnedMesh||source.userData.kaminosEditorHelper||source.userData.kaminosEditorOnly)return;
        const proxy=source.isInstancedMesh?new THREE.InstancedMesh(source.geometry,selected,source.count):new THREE.Mesh(source.geometry,selected);
        proxy.matrixAutoUpdate=false;maskScene.add(proxy);pairs.push({source,proxy,id:entry.id,root:entry.object});
      });
    }
    for(const root of roots)root.updateWorldMatrix(true,true);
    for(const pair of pairs){const {source,proxy}=pair;
      proxy.geometry=source.geometry;proxy.matrix.copy(source.matrixWorld);
      if(source.isInstancedMesh){proxy.instanceMatrix=source.instanceMatrix;proxy.count=source.count;}
      proxy.visible=shown(source,pair.root);proxy.material=activeSet.has(pair.id)?active:selected;}
  }
  return {update,pairs:()=>pairs,proxies:()=>pairs.map(p=>p.proxy)};
}
// Exposed for tests of the proxy bookkeeping, which cannot build the shader graph without a renderer.
createSelectionFeedback.maskProxies=createSelectionMaskProxies;
