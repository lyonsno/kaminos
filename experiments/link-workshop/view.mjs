import * as T from '../../lib/three.core.js';
import {evaluate} from './model.mjs';
export function createMechanismView(root){
 const geometries=[new T.BoxGeometry(1,1,1),new T.CylinderGeometry(1,1,1,24),new T.SphereGeometry(1,16,10)];
 const materials={beam:new T.MeshStandardMaterial({color:0x348c99,metalness:.65,roughness:.28}),joint:new T.MeshStandardMaterial({color:0xe2ac5a,metalness:.7,roughness:.25}),rod:new T.MeshStandardMaterial({color:0xd9e4ea,metalness:.85,roughness:.2}),barrel:new T.MeshStandardMaterial({color:0x374653,metalness:.65,roughness:.3}),A:new T.MeshBasicMaterial({color:0x4fe0e6,transparent:true,opacity:.14,depthWrite:false}),B:new T.MeshBasicMaterial({color:0xffb65a,transparent:true,opacity:.18,depthWrite:false})};
 materials.selected=new T.MeshStandardMaterial({color:0xffce70,metalness:.6,roughness:.3});
 let markers=[],links=[],pistons=[],ghosts=[],topology;
 const mesh=(geo,mat,parent=root)=>{const m=new T.Mesh(geo,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
 function segment(o,a,b,width,depth,z=0){const dx=b[0]-a[0],dy=b[1]-a[1];o.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,z);o.rotation.z=Math.atan2(dy,dx);o.scale.set(Math.hypot(dx,dy),width,depth);}
 function rebuild(m){
  for(const o of [...markers,...links,...pistons.flat(),...ghosts.flat()])o?.removeFromParent();markers=[];links=[];pistons=[];ghosts=[];
  m.nodes.forEach((n,i)=>{const pin=mesh(geometries[1],materials.joint.clone());pin.rotation.x=Math.PI/2;pin.scale.set(.13,.26,.13);pin.userData.joint=i;markers.push(pin);links.push(n.parent===null?mesh(geometries[0],materials.barrel):mesh(geometries[0],materials.beam));});
  for(const [i,p] of m.pistons.entries()){const pair=[mesh(geometries[0],materials.barrel),mesh(geometries[0],materials.rod)];for(const o of pair)o.userData.piston={kind:'pistons',index:i};pistons.push(pair);}
  for(const pose of ['A','B'])ghosts.push(m.nodes.map(n=>n.parent===null?null:mesh(geometries[0],materials[pose])));
 }
 function update(m,t,selected,showGhosts=true,selectedPiston=null){
  const nextTopology=JSON.stringify([m.nodes.map(n=>n.parent),m.pistons]);
  if(topology!==nextTopology){topology=nextTopology;for(const p of markers)p.material.dispose();rebuild(m);}
  const p=evaluate(m,t);m.nodes.forEach((n,i)=>{markers[i].position.set(...p[i],.03);markers[i].material.color.set(i===selected?0xffe5a3:0xe2ac5a);if(n.parent===null){links[i].position.set(...p[i],-.1);links[i].scale.set(.45,.45,.22);}else segment(links[i],p[n.parent],p[i],.16,.14);});
  m.pistons.forEach((v,i)=>{pistons[i][0].material=i===selectedPiston?materials.selected:materials.barrel;pistons[i][1].material=i===selectedPiston?materials.selected:materials.rod;const a=p[v.a],b=p[v.b],middle=a.map((x,k)=>x+(b[k]-x)*.57);segment(pistons[i][0],a,middle,.22,.2,.23);segment(pistons[i][1],middle,b,.075,.075,.23);});
  for(let k=0;k<2;k++){const q=evaluate(m,k);m.nodes.forEach((n,i)=>{const o=ghosts[k][i];if(o){o.visible=showGhosts;segment(o,q[n.parent],q[i],.19,.16,-.17);o.raycast=()=>{};}});}
  root.updateMatrixWorld(true);
 }
 return {update,pistonMeshes:()=>pistons.flat(),markers:()=>markers,dispose(){for(const p of markers)p.material.dispose();for(const g of geometries)g.dispose();for(const m of Object.values(materials))m.dispose();}};
}
