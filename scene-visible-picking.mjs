import {BufferGeometry,Float32BufferAttribute,LineSegments,LineBasicMaterial,WireframeGeometry} from './lib/three.core.js';
const helperLines=new WeakMap();
function pickingLines(node) {
 const source=node.geometry;let cached=helperLines.get(node);
 if(cached?.source===source)return cached.line;
 let geometry;
 if(source.type==='TorusGeometry') {
  const {radius,tubularSegments,arc}=source.parameters,points=[];
  for(let i=0;i<tubularSegments;i++)for(const step of [i,i+1]){const angle=arc*step/tubularSegments;points.push(radius*Math.cos(angle),radius*Math.sin(angle),0);}
  geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));
 } else geometry=new WireframeGeometry(source);
 const line=new LineSegments(geometry,new LineBasicMaterial());helperLines.set(node,{source,line});return line;
}
// Ordinary visible scene geometry wins by depth. Lines use a screen-sized
// aperture, not Three's default one-world-unit invisible selection tube.
export function visibleSceneIntersections({raycaster,roots,camera,viewport,linePixels=6}) {
 if(!(viewport?.width>0&&viewport?.height>0)||!(linePixels>0))throw Error('Picking requires an actual viewport');
 const hits=[],seen=new Set(),prior=raycaster.params.Line.threshold;
 function visit(node){
  if(!node.visible||seen.has(node))return;seen.add(node);
  let editor=false;for(let owner=node;owner;owner=owner.parent)if(owner.userData.kaminosEditorHelper){editor=true;break;}
  const helper=node.isMesh&&editor&&(node.material?.wireframe||node.geometry?.type==='TorusGeometry');
  if(node.isLine||helper){
   const target=helper?pickingLines(node):node;if(helper)target.matrixWorld.copy(node.matrixWorld);
   const geometry=target.geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
   const sphere=geometry.boundingSphere.clone().applyMatrix4(node.matrixWorld);
   const depth=Math.max(camera.near,sphere.center.clone().applyMatrix4(camera.matrixWorldInverse).z*-1+sphere.radius);
   raycaster.params.Line.threshold=camera.isOrthographicCamera?linePixels*(camera.top-camera.bottom)/(camera.zoom*viewport.height):linePixels*2*depth*Math.tan(camera.fov*Math.PI/360)/(camera.zoom*viewport.height);
   for(const hit of raycaster.intersectObject(target,false)){
    const p=hit.point.clone().project(camera),q=raycaster.ray.closestPointToPoint(hit.point,hit.point.clone()).project(camera);
    if(p.z>=-1&&p.z<=1&&Math.hypot((p.x-q.x)*viewport.width/2,(p.y-q.y)*viewport.height/2)<=linePixels)hits.push({...hit,object:node});
   }
  }else if(typeof node.raycast==='function')hits.push(...raycaster.intersectObject(node,false));
  for(const child of node.children)visit(child);
 }
 try{for(const root of roots){let visible=true;for(let parent=root;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}if(visible)visit(root);}}
 finally{raycaster.params.Line.threshold=prior;}
 return hits.sort((a,b)=>a.distance-b.distance);
}
