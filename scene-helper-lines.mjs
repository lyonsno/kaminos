import * as THREE from './lib/three.webgpu.js';
import {uv,If} from './lib/three.tsl.js';
import {LineSegmentsGeometry} from './lib/addons/lines/LineSegmentsGeometry.js';

// Editor overlays blend against the current destination once. This vendored
// Line2NodeMaterial normally preblends against an opaque snapshot; keep its
// vertex expansion, but use straight color/alpha and its screen-space round caps.
class EditorOverlayLineMaterial extends THREE.Line2NodeMaterial {
 static get type(){return 'EditorOverlayLineMaterial';}
 setupDiffuseColor(builder) {
  THREE.NodeMaterial.prototype.setupDiffuseColor.call(this,builder);
  const v=uv();
  If(v.y.abs().greaterThan(1),()=>{const a=v.x,b=v.y.greaterThan(0).select(v.y.sub(1),v.y.add(1));a.mul(a).add(b.mul(b)).greaterThan(1).discard();});
 }
}

// Fat triangle-backed lines use the renderer's existing Line2NodeMaterial.
// Original helper geometry remains the picking authority; visual proxies never raycast.
export function styleHelperLines(root,{width,opacity}) {
 const sources=[];root.traverse(object=>{if(object.userData.kaminosWideLineProxy)return;if(object.isLine||object.isMesh&&(object.material?.wireframe||object.geometry?.type==='TorusGeometry'))sources.push(object);});
 for(const source of sources) {
  let proxy=source.userData.kaminosWideLine;
  if(!proxy) {
   let geometry=source.geometry,temporary=null;
   if(source.geometry.type==='TorusGeometry'){const {radius,tubularSegments,arc}=source.geometry.parameters;const points=[];for(let i=0;i<tubularSegments;i++)for(const step of [i,i+1]){const angle=arc*step/tubularSegments;points.push(radius*Math.cos(angle),radius*Math.sin(angle),0);}temporary=new THREE.BufferGeometry();temporary.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry=temporary;}
   else if(source.isMesh){temporary=new THREE.WireframeGeometry(geometry);geometry=temporary;}
   const position=geometry.getAttribute('position'),index=geometry.index,segments=[];
   const put=i=>segments.push(position.getX(i),position.getY(i),position.getZ(i));
   const count=index?index.count:position.count;
   if(source.isLine&&!source.isLineSegments){for(let i=1;i<count;i++){put(index?index.getX(i-1):i-1);put(index?index.getX(i):i);}}
   else for(let i=0;i<count;i++)put(index?index.getX(i):i);
   temporary?.dispose();
   const material=new EditorOverlayLineMaterial({color:source.material.color,linewidth:width,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NormalBlending,alphaToCoverage:false});
   proxy=new THREE.Mesh(new LineSegmentsGeometry().setPositions(segments),material);proxy.userData.kaminosWideLineProxy=true;proxy.userData.kaminosEditorOnly=true;proxy.renderOrder=1001;proxy.frustumCulled=false;proxy.raycast=()=>{};
   proxy.userData.sourceGeometry=source.geometry;
   proxy.userData.sourcePositions=Array.from(source.geometry.getAttribute('position').array);
   source.add(proxy);source.material.visible=false;source.userData.kaminosWideLine=proxy;
  }
  if(source.isLineSegments){const positions=source.geometry.getAttribute('position').array,old=proxy.userData.sourcePositions;
   if(positions.length!==old.length||positions.some((v,i)=>v!==old[i])){const index=source.geometry.index,data=[];for(let i=0;i<(index?index.count:positions.length/3);i++){const j=3*(index?index.getX(i):i);data.push(...positions.slice(j,j+3));}proxy.geometry.setPositions(data);proxy.userData.sourcePositions=Array.from(positions);}
  }
  proxy.material.linewidth=width;proxy.material.opacity=opacity;proxy.material.color.copy(source.material.color);
 }
 // Arrow cones/other solid markers still share helper opacity.
 root.traverse(object=>{if(object.userData.kaminosWideLineProxy||!object.material||object.material.visible===false)return;for(const material of [object.material].flat()){material.transparent=true;material.opacity=opacity;material.depthTest=false;material.depthWrite=false;}});
}
