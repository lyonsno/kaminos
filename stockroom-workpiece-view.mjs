import * as T from './lib/three.core.js';
import {WORKPIECES,initialWorkpieces,stairPlan,troughPlan,cornerPlan} from './stockroom-workpiece-state.mjs';

export function createWorkpieceView(){
 const root=new T.Group();root.name='Construction workpieces - prepared comparison';
 const cube=new T.BoxGeometry(1,1,1),sphere=new T.SphereGeometry(.065,12,8),groups={},pools={},materials={};
 const material=(color,metalness=0,roughness=.65)=>new T.MeshStandardMaterial({color,metalness,roughness});
 const base={timber:material(0x9ba69b),metal:material(0x454b4d,.7,.36),ceramic:material(0xb8c9c8,.12,.28),counter:material(0xd1d1c8),return:material(0x9d6460,.15,.45),fixed:material(0x818780),accent:material(0xcfb677,.55,.3)};
 const retained=new T.MeshBasicMaterial({color:0x38babc,depthTest:false}),affected=new T.MeshBasicMaterial({color:0xf18e72,depthTest:false});
 for(const [id,definition]of Object.entries(WORKPIECES)){
  const group=new T.Group();group.position.fromArray(definition.origin);root.add(group);groups[id]=group;pools[id]=[];
  materials[id]=Object.fromEntries(Object.entries(base).map(([key,value])=>[key,value.clone()]));
 }
 const ground=new T.Mesh(new T.PlaneGeometry(22,12),material(0x858b89,.08,.85));ground.rotation.x=-Math.PI/2;ground.position.set(0,-.12,0);ground.receiveShadow=true;root.add(ground);
 const markers={},targets=[];let plans={},models=initialWorkpieces(),hover=null;
 for(const id of Object.keys(WORKPIECES)){
  markers[id]={moving:new T.Mesh(sphere,affected),fixed:[]};groups[id].add(markers[id].moving);markers[id].moving.renderOrder=30;markers[id].moving.userData.workpiece=id;targets.push(markers[id].moving);
  for(let i=0;i<3;i++){const m=new T.Mesh(sphere,retained);m.renderOrder=30;groups[id].add(m);markers[id].fixed.push(m);}
 }
 const channelSection=[[-.27,-.115],[.27,-.115],[.27,.145],[.205,.145],[.205,-.045],[-.205,-.045],[-.205,.145],[-.27,.145]];
 const channels=Array.from({length:3},(_,route)=>{
  const geometry=new T.BufferGeometry(),indices=[];
  geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(13*8*3),3));
  for(let i=0;i<12;i++)for(let j=0;j<8;j++){const a=i*8+j,b=i*8+(j+1)%8,c=a+8,d=b+8;indices.push(a,b,c,b,d,c);}
  geometry.setIndex(indices);const mesh=new T.Mesh(geometry,materials.trough.ceramic);mesh.userData={workpiece:'trough',channelRoute:route};mesh.castShadow=mesh.receiveShadow=true;groups.trough.add(mesh);targets.push(mesh);return mesh;
 });
 function writer(id){let index=0;const pool=pools[id],group=groups[id];
  const box=(size,position,kind='timber',rotation=null)=>{let mesh=pool[index++];if(!mesh){mesh=new T.Mesh(cube,materials[id][kind]);mesh.userData.workpiece=id;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);pool.push(mesh);targets.push(mesh);}
   mesh.visible=true;mesh.material=materials[id][kind];mesh.position.fromArray(position);mesh.scale.fromArray(size);mesh.quaternion.identity();if(rotation?.isQuaternion)mesh.quaternion.copy(rotation);else if(rotation)mesh.rotation.set(...rotation);return mesh;};
  const beam=(a,b,width,depth,kind='metal')=>{const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);return box([width,delta.length(),depth],start.add(end).multiplyScalar(.5).toArray(),kind,new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));};
  return {box,beam,finish(){for(let i=index;i<pool.length;i++)pool[i].visible=false;}};
 }
 function stairs(model){const w=writer('stairs'),p=stairPlan(model);plans.stairs=p;
  for(let i=0;i<7;i++)w.box([2.6,.1,.22],[0,1.3,-1.4+i*.23]);
  for(const x of [-1.12,1.12]){w.box([.14,.25,1.8],[x,1.08,-.75],'metal');for(const z of [-1.35,-.1])w.box([.13,1.15,.13],[x,.55,z],'metal');}
  const q=new T.Quaternion().setFromEuler(new T.Euler(-p.tilt,p.yaw,0,'YXZ'));
  for(const t of p.treads)w.box([1.1,.075,t.depth-.012],t.point,'timber',q);
  const side=new T.Vector3(Math.cos(p.yaw),0,-Math.sin(p.yaw)).multiplyScalar(.47);
  for(const sign of [-1,1])w.beam(new T.Vector3(...p.points[0]).addScaledVector(side,sign).add(new T.Vector3(0,-.12,0)).toArray(),new T.Vector3(...p.foot).addScaledVector(side,sign).add(new T.Vector3(0,-.08,0)).toArray(),.09,.15);
  w.box([1.15,.08,.6],new T.Vector3(...p.foot).add(new T.Vector3(0,-.04,.24).applyQuaternion(q)).toArray(),'counter',q);
  w.box([1.3,.07,.12],[0,1.33,0],'accent');w.finish();
 }
 function trough(model){const w=writer('trough'),p=troughPlan(model);plans.trough=p;
  for(const [index,route]of p.routes.entries()){
   const geometry=channels[index].geometry,positions=geometry.attributes.position;
   for(let i=0;i<route.length;i++){
    const center=new T.Vector3(...route[i]),tangent=new T.Vector3(...route[Math.min(i+1,route.length-1)]).sub(new T.Vector3(...route[Math.max(0,i-1)])).normalize();
    const across=new T.Vector3(0,1,0).cross(tangent).normalize(),up=tangent.clone().cross(across).normalize();
    for(const [j,[x,y]]of channelSection.entries()){const point=center.clone().addScaledVector(across,x).addScaledVector(up,y);positions.setXYZ(i*8+j,...point.toArray());}
   }
   // Shared rings keep the bent channel continuous; unused capacity is hidden.
   for(let i=route.length*8;i<positions.count;i++){const last=(route.length-1)*8+i%8;positions.setXYZ(i,positions.getX(last),positions.getY(last),positions.getZ(last));}
   positions.needsUpdate=true;geometry.setDrawRange(0,(route.length-1)*8*6);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  }
  for(const [x,z]of [[0,1.5],[-1.4,-1.4],[0,0]]){w.box([.12,.67,.12],[x,.31,z],'metal');w.box([.55,.08,.42],[x,-.06,z],'fixed');}
  w.finish();
 }
 function corner(model){const w=writer('corner'),p=cornerPlan(model);plans.corner=p;
  for(const x of [-1.2,1.2]){w.box([.11,2.5,.11],[x,1.15,-.85],'metal');w.box([.3,.08,.3],[x,-.06,-.85],'fixed');}
  w.box([2.65,.11,.8],[0,2.55,-.55],'counter');w.box([2.65,.16,.1],[0,2.46,-.88],'metal');
  w.box([.12,1.2,1.6],[-1.2,.6,0],'metal');w.box([.12,1.15,.12],[1.2,.55,-.63],'metal');
  const matrix=new T.Matrix4().fromArray(p.matrix),q=new T.Quaternion().setFromRotationMatrix(matrix),position=local=>new T.Vector3(...local).applyMatrix4(matrix).toArray(),frontCenter=.7-p.band/2;
  w.box([2.3,.1,p.band-.012],position([1.15,0,frontCenter]),'counter',q);
  w.box([2.3,.12,.07],position([1.15,-.12,.65]),'metal',q);
  if(model.kind==='wrap'){
   const rear=1.4-p.band;w.box([2.3,.1,rear-.012],[0,1.2,-.7+rear/2],'counter');w.box([.09,.75,rear-.012],[1.15,1.575,-.7+rear/2],'return');
   w.box([2.3,.025,.025],position([1.15,.07,p.splitZ]),'accent',q);w.box([.025,.75,.025],position([2.34,.375,p.splitZ]),'accent',q);
  }
  if(model.kind==='leave')w.box([.09,.75,1.4],[1.15,1.575,0],'return');
  else w.box([.09,.75,p.band-.012],position([2.3,.375,frontCenter]),'return',q);
  w.box([.06,.11,1.55],[-1.15,1.23,0],'accent');w.finish();
 }
 function update(values,active=null){models=structuredClone(values);stairs(models.stairs);trough(models.trough);corner(models.corner);
  for(const id of Object.keys(WORKPIECES)){
   const p=plans[id],marker=markers[id];marker.moving.position.fromArray(id==='stairs'?p.foot:id==='trough'?p.right:p.tip);marker.moving.position.y+=.1;
   marker.moving.visible=!active||active===id;
   marker.fixed.forEach((m,i)=>{m.visible=active===id&&i<p.retained.length;if(m.visible)m.position.fromArray(p.retained[i]);});
   for(const mat of Object.values(materials[id]))mat.emissive.setHex(id===hover?0x122825:0);
  }
  root.updateMatrixWorld(true);
 }
 function points(){root.updateMatrixWorld(true);const result={};for(const id of Object.keys(WORKPIECES)){
  const p=plans[id];result[id]={target:markers[id].moving.getWorldPosition(new T.Vector3()).toArray(),label:groups[id].localToWorld(new T.Vector3(0,.05,2.9)).toArray(),offer:groups[id].localToWorld(new T.Vector3(0,3.15,0)).toArray(),retained:p.retained.map(v=>groups[id].localToWorld(new T.Vector3(...v)).toArray())};
 }return result;}
 update(models);
 return {root,update,points,plans:()=>structuredClone(plans),targets:()=>targets.filter(m=>m.visible),hover(id){if(id===hover)return false;hover=id;update(models);return true;}};
}
