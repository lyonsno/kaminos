// Ordinary visible scene geometry wins by depth. Lines use a screen-sized
// aperture, not Three's default one-world-unit invisible selection tube.
export function visibleSceneIntersections({raycaster,roots,camera,viewport,linePixels=6}) {
 if(!(viewport?.width>0&&viewport?.height>0)||!(linePixels>0))throw Error('Picking requires an actual viewport');
 const hits=[],seen=new Set(),prior=raycaster.params.Line.threshold;
 function visit(node){
  if(!node.visible||seen.has(node))return;seen.add(node);
  if(node.isLine){
   const geometry=node.geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
   const sphere=geometry.boundingSphere.clone().applyMatrix4(node.matrixWorld);
   const depth=Math.max(camera.near,sphere.center.clone().applyMatrix4(camera.matrixWorldInverse).z*-1+sphere.radius);
   raycaster.params.Line.threshold=camera.isOrthographicCamera?linePixels*(camera.top-camera.bottom)/(camera.zoom*viewport.height):linePixels*2*depth*Math.tan(camera.fov*Math.PI/360)/(camera.zoom*viewport.height);
   for(const hit of raycaster.intersectObject(node,false)){
    const p=hit.point.clone().project(camera),q=raycaster.ray.closestPointToPoint(hit.point,hit.point.clone()).project(camera);
    if(p.z>=-1&&p.z<=1&&Math.hypot((p.x-q.x)*viewport.width/2,(p.y-q.y)*viewport.height/2)<=linePixels)hits.push(hit);
   }
  }else if(typeof node.raycast==='function')hits.push(...raycaster.intersectObject(node,false));
  for(const child of node.children)visit(child);
 }
 try{for(const root of roots){let visible=true;for(let parent=root;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}if(visible)visit(root);}}
 finally{raycaster.params.Line.threshold=prior;}
 return hits.sort((a,b)=>a.distance-b.distance);
}
