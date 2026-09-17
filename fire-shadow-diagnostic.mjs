// Opt-in readback only. Does not alter the shadow algorithm or authored scene.
import * as THREE from './lib/three.webgpu.js';

export function rayEvidence(scene,originArray,targetArray) {
  const origin=new THREE.Vector3(...originArray),target=new THREE.Vector3(...targetArray);
  const delta=target.clone().sub(origin),distance=delta.length();
  const raycaster=new THREE.Raycaster(origin,delta.normalize());
  const casters=[];scene.traverseVisible(o=>{if(o.isMesh&&o.castShadow)casters.push(o);});
  const hits=raycaster.intersectObjects(casters,false).map(hit=>{
    const geometry=hit.object.geometry,face=hit.face;
    return {distance:hit.distance,point:hit.point.toArray(),faceIndex:hit.faceIndex,
      object:hit.object.name,uuid:hit.object.uuid,materialIndex:face.materialIndex,
      triangle:[face.a,face.b,face.c].map(i=>new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(hit.object.matrixWorld).toArray()),
      geometricNormal:face.normal.clone().transformDirection(hit.object.matrixWorld).toArray()};
  });
  return {origin:originArray,target:targetArray,distance,hits};
}

export async function diagnoseFireShadow({renderer,scene,anchors,cameraPosition,status,nodes}) {
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());
  if(!Array.isArray(anchors)||!anchors.length||anchors.some(p=>!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.y<0||p.x>=size.x||p.y>=size.y)) throw new Error('invalid-shadow-anchors');
  const result={identity:'actual-shadow-node-readback-v0',status,dimensions:size.toArray(),coordinateSpace:'WebGPU top-left backing pixels',anchors:anchors.map(p=>({...p}))};
  const rt=new THREE.RenderTarget(size.x,size.y,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false});
  const material=new THREE.NodeMaterial();material.toneMapped=false;material.blending=THREE.NoBlending;
  const quad=new THREE.QuadMesh(material);
  try {
    for(const [name,node] of Object.entries(nodes)) {
      material.fragmentNode=node;material.needsUpdate=true;
      const state=THREE.RendererUtils.resetRendererAndSceneState(renderer,scene);
      try {renderer.setRenderTarget(rt);quad.render(renderer);}
      finally {THREE.RendererUtils.restoreRendererAndSceneState(renderer,scene,state);}
      const pixels=await Promise.all(anchors.map(p=>renderer.readRenderTargetPixelsAsync(rt,p.x,p.y,1,1)));
      pixels.forEach((pixel,i)=>{
        if(!(pixel instanceof Float32Array)||pixel.length!==4||!pixel.every(Number.isFinite)) throw new Error('invalid-shadow-readback');
        result.anchors[i][name]=Array.from(pixel);
      });
    }
    scene.updateMatrixWorld(true);
    for(const row of result.anchors) {
      const source=row.source.slice(0,3),receiver=row.receiver.slice(0,3);
      row.exactRay=rayEvidence(scene,source,receiver);
      row.offsetRay=rayEvidence(scene,source,source.map((v,i)=>v+row.comparison[i]));
      if(cameraPosition)row.cameraRay=rayEvidence(scene,cameraPosition,receiver);
      row.shadowGap=row.comparison[3]-row.normal[3];
    }
    return result;
  } finally {rt.dispose();material.dispose();}
}
