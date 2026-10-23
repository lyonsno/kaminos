// Ordinary visible scene geometry wins by depth. Lines use a screen-sized
// aperture, not Three's default one-world-unit invisible selection tube.
import {BufferGeometry,Float32BufferAttribute,LineSegments,LineBasicMaterial,Vector3} from './lib/three.core.js';
export function visibleSceneIntersections({raycaster,roots,camera,viewport,linePixels=6}) {
 if(!(viewport?.width>0&&viewport?.height>0)||!(linePixels>0))throw Error('Picking requires an actual viewport');
 const hits=[],seen=new Set(),prior=raycaster.params.Line.threshold;
 function visit(node){
  if(!node.visible||seen.has(node))return;seen.add(node);
  const wide=node.userData.kaminosWideLine;
  if(wide?.visible&&wide.material.visible!==false&&wide.material.opacity>0){
   // Raycast the same centerline used by the visible expanded helper. Its
   // original torus/mesh is thinner than the screen-space line when zoomed out.
   const start=wide.geometry.getAttribute('instanceStart'),end=wide.geometry.getAttribute('instanceEnd'),positions=[];
   const point=new Vector3();
   for(let i=0;i<start.count;i++)for(const attribute of [start,end])positions.push(...point.set(attribute.getX(i),attribute.getY(i),attribute.getZ(i)).applyMatrix4(node.matrixWorld).toArray());
   const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
   const material=new LineBasicMaterial(),line=new LineSegments(geometry,material);
   try{pickLine(line,Math.max(linePixels,wide.material.linewidth/2),node);}finally{geometry.dispose();material.dispose();}
  }
  if(node.isLine)pickLine(node,linePixels,node);
  else if(typeof node.raycast==='function')hits.push(...raycaster.intersectObject(node,false));
  for(const child of node.children)visit(child);
 }
 function pickLine(node,pixels,owner){
   const geometry=node.geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
   const sphere=geometry.boundingSphere.clone().applyMatrix4(node.matrixWorld);
   const depth=Math.max(camera.near,sphere.center.clone().applyMatrix4(camera.matrixWorldInverse).z*-1+sphere.radius);
   raycaster.params.Line.threshold=camera.isOrthographicCamera?pixels*(camera.top-camera.bottom)/(camera.zoom*viewport.height):pixels*2*depth*Math.tan(camera.fov*Math.PI/360)/(camera.zoom*viewport.height);
   for(const hit of raycaster.intersectObject(node,false)){
    const p=hit.point.clone().project(camera),q=raycaster.ray.closestPointToPoint(hit.point,hit.point.clone()).project(camera);
    if(p.z>=-1&&p.z<=1&&Math.hypot((p.x-q.x)*viewport.width/2,(p.y-q.y)*viewport.height/2)<=pixels)hits.push({...hit,object:owner});
   }
 }
 try{for(const root of roots){let visible=true;for(let parent=root;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}if(visible)visit(root);}}
 finally{raycaster.params.Line.threshold=prior;}
 return hits.sort((a,b)=>a.distance-b.distance);
}
