import * as T from './lib/three.core.js';
import {MarchingCubes} from './vendor/StockroomMarchingCubes.js';
import {planPlace,placeBounds,samplePlace,regionDistance,receiverRegion} from './stockroom-place-state.mjs';

export function createPlaceView(){
 const root=new T.Group();root.name='Establish / Work - prepared deck composition';
 const cube=new T.BoxGeometry(1,1,1),sphere=new T.SphereGeometry(.065,12,8),matrix=new T.Matrix4(),q=new T.Quaternion(),s=new T.Vector3(),p=new T.Vector3();
 const mat=(color,metalness=0,roughness=.7)=>new T.MeshStandardMaterial({color,metalness,roughness});
 const timber=mat(0xb6b9b0),frame=mat(0x505957,.55,.5),ends=mat(0x8e978d),metal=mat(0x8e9b9d,.8,.27),bronze=mat(0xaa9876,.65,.4),proxyMaterial=mat(0x999d9b,0,.9);
 const pools=new Map(),markerMaterial=new T.MeshBasicMaterial({color:0xe6dfc9,depthTest:false}),emptyMaterial=new T.LineBasicMaterial({color:0x344c50,depthTest:false,transparent:true,opacity:.85});
 const pending=new T.Group();pending.name='Active region boundaries';pending.userData.kaminosEditorHelper=true;root.add(pending);
 const handles=new Map(),outlines=new Map();let model,plan,deckMeshes=[];
 function instances(name,items,material){let row=pools.get(name);if(!row||row.mesh.instanceMatrix.count<items.length){const capacity=2**Math.ceil(Math.log2(Math.max(1,items.length))),mesh=new T.InstancedMesh(cube,material,capacity);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;mesh.userData.placeHost=true;if(row){row.mesh.removeFromParent();row.mesh.dispose();}root.add(mesh);row={mesh};pools.set(name,row);}
  row.mesh.count=items.length;row.mesh.userData.members=items.map(x=>x.id);items.forEach((item,i)=>{p.fromArray(item.position);s.fromArray(item.size);matrix.compose(p,q.identity(),s);row.mesh.setMatrixAt(i,matrix);if(name==='Deck boards')row.mesh.setColorAt(i,new T.Color().setScalar(.85+(i%5)*.035));});
  row.mesh.instanceMatrix.needsUpdate=true;if(row.mesh.instanceColor)row.mesh.instanceColor.needsUpdate=true;row.mesh.computeBoundingBox();row.mesh.computeBoundingSphere();return row.mesh;
 }
 const extractor=new MarchingCubes(28,proxyMaterial,false,false,5*25**3),proxy=new T.Mesh(new T.BufferGeometry(),proxyMaterial);proxy.name='Unresolved allocation';proxy.userData.placeHost=true;proxy.castShadow=proxy.receiveShadow=true;root.add(proxy);
 function unresolved(value){
  const parts=value.regions.filter(r=>r.role!=='material'||r.id!=='dock'),active={...value,regions:parts},has=parts.some(r=>r.role==='material');proxy.visible=value.realization==='proxy'&&has;if(!proxy.visible)return;
  const b=placeBounds(active),lo=[b.min[0]-.3,value.height-.35,b.min[1]-.3],size=[b.max[0]-b.min[0]+.6,.6,b.max[1]-b.min[1]+.6],n=28,old=value.regions.find(r=>r.id==='dock');
  extractor.isolation=0;extractor.normal_cache.fill(0);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const px=lo[0]+size[0]*x/n,py=lo[1]+size[1]*y/n,pz=lo[2]+size[2]*z/n;let d=Math.max(samplePlace(active,px,pz),Math.abs(py-(value.height-.08))-.14);if(old)d=Math.max(d,-regionDistance(old,px,pz));extractor.field[x+n*(y+n*z)]=-d;}
  extractor.update();const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(extractor.positionArray.slice(0,extractor.count*3),3));geometry.setAttribute('normal',new T.Float32BufferAttribute(extractor.normalArray.slice(0,extractor.count*3),3));geometry.computeBoundingBox();geometry.computeBoundingSphere();proxy.geometry.dispose();proxy.geometry=geometry;proxy.position.set(...lo.map((v,i)=>v+size[i]/2));proxy.scale.set(...size.map(v=>v/2));
 }
 const insert=new T.Group();insert.name='Prepared removable insert';root.add(insert);
 const panel=new T.Mesh(cube,metal);panel.name='Metal insert';panel.userData.placeInsert=true;panel.castShadow=panel.receiveShadow=true;insert.add(panel);
 const pins=[];for(let i=0;i<2;i++){const pin=new T.Mesh(new T.CylinderGeometry(.043,.043,.16,12),bronze);pin.rotation.x=Math.PI/2;insert.add(pin);pins.push(pin);}
 const receiver=new T.Group();receiver.name='Host-scoped receiver';root.add(receiver);
 const rim=[];for(let i=0;i<4;i++){const mesh=new T.Mesh(cube,frame);mesh.castShadow=mesh.receiveShadow=true;receiver.add(mesh);rim.push(mesh);}
 const insertHandle=new T.Mesh(sphere,markerMaterial);insertHandle.userData.placeHandle={kind:'insert'};insertHandle.renderOrder=30;root.add(insertHandle);
 const ground=new T.Mesh(new T.PlaneGeometry(28,22),mat(0x818987,.05,.85));ground.rotation.x=-Math.PI/2;ground.position.y=-.055;ground.receiveShadow=true;root.add(ground);
 function mark(key,spec,at,active){let mesh=handles.get(key);if(!mesh){mesh=new T.Mesh(sphere,markerMaterial);mesh.renderOrder=30;pending.add(mesh);handles.set(key,mesh);}mesh.userData.placeHandle=spec;mesh.position.set(...at);mesh.visible=active;return mesh;}
 function boundaries(value){const wanted=new Set();for(const r of value.regions){let line=outlines.get(r.id);if(!line){line=new T.LineLoop(new T.BufferGeometry(),r.role==='space'?emptyMaterial:new T.LineBasicMaterial({color:0xc9ba8d,depthTest:false}));line.renderOrder=25;pending.add(line);outlines.set(r.id,line);}
   const points=r.shape==='box'?[[-1,-1],[1,-1],[1,1],[-1,1]]:Array.from({length:64},(_,i)=>[Math.cos(i*Math.PI/32),Math.sin(i*Math.PI/32)]),positions=points.flatMap(([x,z])=>[r.center[0]+x*r.half[0],value.height+.095,r.center[1]+z*r.half[1]]);line.geometry.dispose();line.geometry=new T.BufferGeometry();line.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));line.visible=value.mode==='establish';
   const key=`${r.id}:move`;wanted.add(key);mark(key,{kind:'move',id:r.id},[r.center[0],value.height+.13,r.center[1]],value.mode==='establish');
   for(const axis of [0,1])for(const sign of [-1,1]){const key=`${r.id}:${axis}:${sign}`,at=[...r.center];at[axis]+=sign*r.half[axis];wanted.add(key);mark(key,{kind:'boundary',id:r.id,axis,sign},[at[0],value.height+.13,at[1]],value.mode==='establish'&&value.selected===r.id);}
  }
  for(const [key,mesh]of handles)if(!wanted.has(key)){mesh.removeFromParent();handles.delete(key);}for(const [id,line]of outlines)if(!value.regions.some(r=>r.id===id)){line.geometry.dispose();line.removeFromParent();outlines.delete(id);}
 }
 function update(value){model=structuredClone(value);plan=planPlace(value);const resolved=value.realization==='deck'?plan:planPlace({...value,regions:value.regions.filter(r=>r.role!=='material'||r.id==='dock')});
  deckMeshes=[instances('Deck boards',resolved.boards,timber),instances('Deck structure',resolved.frame,frame),instances('Member ends',resolved.edges,ends),proxy];unresolved(value);boundaries(value);
  const a=value.insert,x=a.half[0],z=a.half[1];insert.position.set(a.center[0]-x,value.height+.045,a.center[1]);insert.rotation.z=a.angle;panel.scale.set(2*x,.055,2*z);panel.position.set(x,0,0);pins.forEach((pin,i)=>pin.position.set(0,0,(i?1:-1)*z*.7));
  insertHandle.position.set(2*x,0,0).applyMatrix4(insert.matrix.clone().compose(insert.position,insert.quaternion,insert.scale));insertHandle.visible=value.mode==='work';
  receiver.visible=a.fitted;receiver.position.set(a.center[0],value.height-.015,a.center[1]);const r=receiverRegion(value),u=r.half[0],v=r.half[1];
  [[2*u+.16,.09,.08,0,0,-v-.04],[2*u+.16,.09,.08,0,0,v+.04],[.08,.09,2*v,-u-.04,0,0],[.08,.09,2*v,u+.04,0,0]].forEach((b,i)=>{rim[i].scale.set(...b.slice(0,3));rim[i].position.set(...b.slice(3));});root.updateMatrixWorld(true);
 }
 function handlePoint(spec){if(spec.kind==='insert'||spec.kind==='fit'||spec.kind==='fold')return insertHandle.getWorldPosition(new T.Vector3()).toArray();return handles.get(spec.kind==='move'?`${spec.id}:move`:`${spec.id}:${spec.axis}:${spec.sign}`)?.getWorldPosition(new T.Vector3()).toArray();}
 return {root,update,handlePoint,plan:()=>structuredClone(plan),targets:()=>[...handles.values()].filter(m=>m.visible).concat(insertHandle.visible?[insertHandle,panel]:[]),hostTargets:()=>deckMeshes.filter(m=>m.visible),
  foldPoint(angle){const a=model.insert;return root.localToWorld(new T.Vector3(a.center[0]-a.half[0]+2*a.half[0]*Math.cos(angle),model.height+.045+2*a.half[0]*Math.sin(angle),a.center[1])).toArray();},
  dispose(){extractor.geometry.dispose();},
 };
}
