import * as T from '../../lib/three.core.js';
import {mountMatrix} from './mounts.mjs';
// Editor-only annotations and a physical-distance piston preview share the picked frames.
export function createConnectView(root,document){
 const group=new T.Group();group.userData.kaminosEditorOnly=true;group.userData.mechanismOverlay=true;root.add(group);group.matrixAutoUpdate=false;
 const ball=new T.SphereGeometry(.12,16,12),tube=new T.CylinderGeometry(1,1,1,16),materials=[0xffc36b,0x6ee4dc].map(color=>new T.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));
 const ends=materials.map(m=>{const mesh=new T.Mesh(ball,m);mesh.renderOrder=120;mesh.raycast=()=>{};group.add(mesh);return mesh;});
 const line=new T.Line(new T.BufferGeometry(),new T.LineDashedMaterial({color:0xffffff,dashSize:.1,gapSize:.07,transparent:true,opacity:.65,depthTest:false}));line.raycast=()=>{};group.add(line);
 const pistonMaterial=new T.MeshBasicMaterial({color:0x95e5dc,transparent:true,opacity:.5,depthWrite:false}),body=new T.Mesh(tube,pistonMaterial),shaft=new T.Mesh(tube,pistonMaterial);for(const o of [body,shaft]){o.raycast=()=>{};group.add(o);}
 const labels=ends.map(()=>{if(!document?.createElement)return null;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=80;const texture=new T.CanvasTexture(canvas),material=new T.SpriteMaterial({map:texture,depthTest:false,transparent:true,toneMapped:false}),sprite=new T.Sprite(material);sprite.scale.set(1.3,.25,1);sprite.renderOrder=121;sprite.raycast=()=>{};group.add(sprite);return {canvas,texture,material,sprite,text:null};});
 function segment(mesh,a,b,r){mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());mesh.scale.set(r,a.distanceTo(b),r);}
 return {update(model,t,entries,draft,visible){group.visible=!!draft&&visible;if(!draft)return;root.updateWorldMatrix(true,false);group.matrix.copy(root.matrixWorld).invert();const points=[];
  for(let i=0;i<2;i++){const endpoint=draft.ends[i],label=labels[i];ends[i].visible=!!endpoint;if(label)label.sprite.visible=!!endpoint;if(!endpoint)continue;
   try{const p=new T.Vector3().setFromMatrixPosition(mountMatrix(root,model,endpoint.id,t,entries));points.push(p);ends[i].position.copy(p);if(label){label.sprite.position.copy(p).add(new T.Vector3(0,.3,0));const text=`${i+1} · ${endpoint.label}`;if(label.text!==text){label.text=text;const ctx=label.canvas.getContext('2d');ctx.clearRect(0,0,640,80);ctx.fillStyle='#17242bee';ctx.fillRect(0,0,640,80);ctx.font='bold 32px sans-serif';ctx.fillStyle=i?'#6ee4dc':'#ffc36b';ctx.textAlign='center';ctx.fillText(text,320,51);label.texture.needsUpdate=true;}}}catch{ends[i].visible=false;if(label)label.sprite.visible=false;}
  }
  line.geometry.dispose();line.geometry=new T.BufferGeometry().setFromPoints(points);line.computeLineDistances();line.visible=points.length===2;body.visible=shaft.visible=points.length===2&&draft.kind==='piston';if(body.visible){const [a,b]=points,mid=a.clone().lerp(b,.55);segment(body,a,mid,.105);segment(shaft,mid,b,.045);}group.updateMatrixWorld(true);
 },dispose(){group.removeFromParent();ball.dispose();tube.dispose();materials.forEach(m=>m.dispose());pistonMaterial.dispose();line.geometry.dispose();line.material.dispose();for(const l of labels)if(l){l.texture.dispose();l.material.dispose();}}};
}
