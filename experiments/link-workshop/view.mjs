import * as T from '../../lib/three.core.js';
import {evaluate} from './model.mjs';
import {createBodyView,bodyLayout} from './bodies.mjs';

export function createMechanismView(root){
 let bodyRoot=new T.Group(),bodies=createBodyView(bodyRoot),lastModel,lastT;root.add(bodyRoot);
 const box=new T.BoxGeometry(1,1,1),ring=new T.TorusGeometry(1,.12,8,32);
 const materials={joint:new T.MeshBasicMaterial({color:0xe2ac5a}),A:new T.MeshBasicMaterial({color:0x4fe0e6,transparent:true,opacity:.14,depthWrite:false}),B:new T.MeshBasicMaterial({color:0xffb65a,transparent:true,opacity:.18,depthWrite:false})};
 let markers=[],ghosts=[],topology;
 const mesh=(geo,mat)=>{const m=new T.Mesh(geo,mat);root.add(m);return m;};
 function segment(o,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];o.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,-.17);o.rotation.z=Math.atan2(dy,dx);o.scale.set(Math.hypot(dx,dy),.19,.16);}
 function clear(){for(const o of [...markers,...ghosts.flat()])o?.removeFromParent();for(const p of markers)p.material.dispose();markers=[];ghosts=[];}
 function update(m,t,selected,showGhosts=true){
  lastModel=m;lastT=t;
  const next=JSON.stringify(m.nodes.map(n=>n.parent));
  if(topology!==next){clear();topology=next;
   markers=m.nodes.map((n,i)=>{const pin=mesh(ring,materials.joint.clone());pin.scale.setScalar(.18);pin.userData.joint=i;return pin;});
   for(const pose of ['A','B'])ghosts.push(m.nodes.map(n=>{if(n.parent===null)return null;const g=mesh(box,materials[pose]);g.raycast=()=>{};return g;}));
  }
  const p=evaluate(m,t),layout=bodyLayout(m);
  m.nodes.forEach((n,i)=>{markers[i].position.set(...p[i],layout.joints[i].high+.052);markers[i].material.color.set(i===selected?0xffe5a3:0xe2ac5a);});
  for(let k=0;k<2;k++){const q=evaluate(m,k);m.nodes.forEach((n,i)=>{const o=ghosts[k][i];if(o){o.visible=showGhosts;segment(o,q[n.parent],q[i]);}});}
  bodies.update(m,t);root.updateMatrixWorld(true);
 }
 function setBodies(packet){
  const nextRoot=new T.Group(),next=createBodyView(nextRoot);
  try{if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies))throw Error('Choose an assembly geometry package');next.update(lastModel,lastT);if(packet.bodies.length)next.importBodies(packet);}catch(e){next.dispose();throw e;}
  bodies.dispose();bodyRoot.removeFromParent();bodyRoot=nextRoot;bodies=next;root.add(bodyRoot);root.updateMatrixWorld(true);return bodies.manifest();
 }
 return {update,setBodies,replacementState:()=>bodies.replacementState(),bodyManifest:()=>bodies.manifest(),exportBodies:()=>bodies.exportBodies(),importBodies:p=>bodies.importBodies(p),markers:()=>markers,dispose(){bodies.dispose();bodyRoot.removeFromParent();clear();box.dispose();ring.dispose();for(const m of Object.values(materials))m.dispose();}};
}
