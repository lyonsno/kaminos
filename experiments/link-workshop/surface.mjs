import * as T from '../../lib/three.core.js';
import {checkedMechanism,frames,pistonMountPoint} from './model.mjs';
import {constructBodies,bodyLayout} from './bodies.mjs';
import {bisectFaces,extractFaces,capPlanarOpenings} from '../../poly-mesh-edit.mjs';

const loader=new T.ObjectLoader();
const serialize=object=>{object.updateMatrixWorld(true);return object.toJSON();};
export function disposeGeometry(root){const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();}
export function surfaceBounds(geometry,id){const entry=geometry.bodies.find(b=>b.id===id);if(!entry)throw Error('Choose existing body geometry');const object=loader.parse(entry.object);try{object.updateMatrixWorld(true);return new T.Box3().setFromObject(object);}finally{disposeGeometry(object);}}
function arraysOf(mesh){const g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv'),idx=g.index?.array??Uint32Array.from({length:p.count},(_,i)=>i),matrix=mesh.matrixWorld,normal=new T.Matrix3().getNormalMatrix(matrix),positions=[],normals=n?[]:null,uvs=uv?[]:null;
 for(let i=0;i<p.count;i++){positions.push(...new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix).toArray());if(n)normals.push(...new T.Vector3().fromBufferAttribute(n,i).applyMatrix3(normal).normalize().toArray());if(uv)uvs.push(uv.getX(i),uv.getY(i));}
 const faceMaterial=new Uint8Array(idx.length/3);for(const group of g.groups)for(let j=group.start;j<group.start+group.count;j+=3)faceMaterial[j/3]=group.materialIndex;
 return {positions:Float32Array.from(positions),normals:normals&&Float32Array.from(normals),uvs:uvs&&Float32Array.from(uvs),indices:Uint32Array.from(idx),faceMaterial};}
function meshOf(a,source,shift){if(!a.indices.length)return null;const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(a.positions,3));g.setIndex(new T.BufferAttribute(a.indices,1));if(a.normals)g.setAttribute('normal',new T.BufferAttribute(a.normals,3));else g.computeVertexNormals();if(a.uvs)g.setAttribute('uv',new T.BufferAttribute(a.uvs,2));for(let i=0;i<a.faceMaterial.length;i++)g.addGroup(i*3,3,a.faceMaterial[i]);g.translate(-shift,0,0);const mesh=new T.Mesh(g,Array.isArray(source.material)?source.material.map(m=>m.clone()):source.material.clone());mesh.name=source.name;mesh.userData=structuredClone(source.userData);mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;return mesh;}
function cutArrays(source,x,side){const plane={point:[x,0,0],normal:[1,0,0]},mask=new Uint8Array(source.indices.length/3).fill(1),cut=bisectFaces(source,mask,plane),take=new Uint8Array(cut.side.length);for(let i=0;i<take.length;i++)take[i]=cut.side[i]===side||cut.side[i]===0?1:0;const a=extractFaces(cut.arrays,take).part;if(!a.indices.length)return a;return capPlanarOpenings(a,plane,{side,material:0}).arrays;}

// This first cutter uses parallel seams across a body's local X, about local Z.
// It preserves the rigid body's frame; its old endpoint need not span the mesh.
export function divideSurface({recipe,geometry,joint,cuts}){
 const before=checkedMechanism(recipe),old=before.nodes[joint];if(!old||old.parent===null)throw Error('Choose a movable body');
 if(before.nodes.some(n=>n.parent===joint))throw Error('This surface already carries child links; separate their mounts before dividing it');
 const id=`link:${joint}`,entry=geometry.bodies.find(b=>b.id===id);if(!entry)throw Error('Choose existing body geometry');
 const bounds=surfaceBounds(geometry,id),end=bounds.max.x;
 if(!Array.isArray(cuts)||!cuts.length||cuts.some((x,i)=>!Number.isFinite(x)||x<=1e-5||x>=end-1e-5||(i&&x<=cuts[i-1]+1e-5)))throw Error('Seams must be ordered inside the selected surface');
 const edges=[0,...cuts,end],count=edges.length-1,delta=count-1,map=i=>i>joint?i+delta:i,m=structuredClone(before),layer=bodyLayout(before).layers[joint];
 const owner=x=>{if(cuts.some(c=>Math.abs(c-x)<1e-6))throw Error('A mounting point lies on a seam; move the seam or mount');let k=0;while(k<cuts.length&&x>cuts[k])k++;return {id:joint+k,start:edges[k],length:edges[k+1]-edges[k]};};
 m.nodes=before.nodes.flatMap((n,i)=>i===joint?edges.slice(0,-1).map((x,k)=>({...structuredClone(n),parent:k?joint+k-1:map(n.parent),length:edges[k+1]-x,angles:k?[0,0]:[...n.angles],layer,label:`${entry.object.object?.name??'Surface'} · Panel ${k+1}`,surfacePanel:{source:entry.object.object?.uuid??id,index:k,start:x,end:edges[k+1]}})):[{...n,parent:n.parent===null?null:map(n.parent)}]);
 m.pistons=before.pistons.map(p=>{const q=structuredClone(p);for(const key of ['a','b']){if(p[key]!==joint){q[key]=map(p[key]);continue;}const at=p[`${key}Offset`]??[old.length,0],o=owner(at[0]);q[key]=o.id;q[`${key}Offset`]=[at[0]-o.start,at[1]];}return q;});
 // Hospital mounts use the endpoint frame; translate that frame through the cut.
 if(m.mounts)m.mounts=m.mounts.map(v=>{if(v.owner.joint===undefined)return v;if(v.owner.joint!==joint)return {...v,owner:{joint:map(v.owner.joint)}};const x=old.length+v.position[0],o=owner(x);return {...v,owner:{joint:o.id},position:[x-o.start-o.length,v.position[1],v.position[2]]};});
 if(m.attachments)m.attachments=m.attachments.map(a=>{if(a.targetMount)return a;if(a.joint!==joint)return {...a,joint:map(a.joint)};const x=old.length+a.offset.position[0],o=owner(x);return {...a,joint:o.id,offset:{...a.offset,position:[x-o.start-o.length,...a.offset.position.slice(1)]}};});
 const fresh=constructBodies(m),defs=new Map(fresh.defs.map(d=>[d.id,d])),bodies=[],source=loader.parse(entry.object),panels=edges.slice(0,-1).map((_,k)=>{const g=new T.Group();g.name=`Panel ${k+1}`;return g;});
 try{
  source.updateMatrixWorld(true);source.traverse(mesh=>{if(!mesh.isMesh)return;const a=arraysOf(mesh),xs=a.positions;let min=Infinity,max=-Infinity;for(let q=0;q<xs.length;q+=3){min=Math.min(min,xs[q]);max=Math.max(max,xs[q]);}
   if(mesh.userData.copyPart&&cuts.some(c=>min<c-1e-6&&max>c+1e-6))throw Error(`${mesh.name||'Mounting bracket'} crosses a seam; move the seam clear of the bracket`);
   for(let k=0;k<count;k++){let part=a;if(k)part=cutArrays(part,edges[k],1);if(k<count-1)part=cutArrays(part,edges[k+1],-1);const result=meshOf(part,mesh,edges[k]);if(result)panels[k].add(result);}
  });
  for(const [k,g]of panels.entries()){
   if(!g.children.length)throw Error('A seam creates an empty panel');
   if(k){const depth=bounds.max.z-bounds.min.z,geo=new T.CylinderGeometry(.075,.075,depth,24);geo.rotateX(Math.PI/2);const material=new T.MeshStandardMaterial({color:0xb28a52,metalness:.65,roughness:.35}),pin=new T.Mesh(geo,material);pin.position.set(0,0,(bounds.max.z+bounds.min.z)/2);pin.name=`Panel ${k+1} hinge axle`;g.add(pin);const lug=new T.Mesh(new T.BoxGeometry(.12,.22,depth),material);lug.position.set(.04,.09,pin.position.z);lug.name=`Panel ${k+1} hinge attachment`;g.add(lug);}
   if(!g.children.length)throw Error('A seam creates an empty panel');const def=defs.get(`link:${joint+k}`);bodies.push({id:def.id,geometryKey:def.geometryKey,object:serialize(g)});}
  for(const item of geometry.bodies){if(item.id===id)continue;const match=/^(anchor|link|pin):(\d+)$/.exec(item.id),nextId=match?`${match[1]}:${map(+match[2])}`:item.id,def=defs.get(nextId);if(!def)continue;const object=loader.parse(item.object);
   try{if(item.id===`pin:${joint}`){const o=owner(old.length),x=old.length-o.start-o.length;for(const child of object.children)child.position.x+=x;}bodies.push({...item,id:nextId,geometryKey:def.geometryKey,object:serialize(object)});}finally{disposeGeometry(object);}
  }
  return {recipe:checkedMechanism(m),geometry:{schema:geometry.schema,bodies},panels:panels.map((_,k)=>`link:${joint+k}`),seams:cuts};
 }finally{disposeGeometry(source);panels.forEach(disposeGeometry);fresh.defs.forEach(d=>disposeGeometry(d.object));}
}

export function actuatorReport(recipe){
 const rows=[];for(const [index,p]of recipe.pistons.entries()){
  if(!p.hinge)continue;let lo=Infinity,hi=0,minArm=Infinity,lastSign=0,crossed=false;for(let i=0;i<=100;i++){const f=frames(recipe,i/100),a=pistonMountPoint(recipe,f,p.a,p.aOffset),b=pistonMountPoint(recipe,f,p.b,p.bOffset),h=f[recipe.nodes[p.b].parent].point,dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy),arm=((b[0]-h[0])*dy-(b[1]-h[1])*dx)/(d||1);lo=Math.min(lo,d);hi=Math.max(hi,d);minArm=Math.min(minArm,Math.abs(arm));const sign=Math.sign(arm);if(lastSign&&sign!==lastSign)crossed=true;lastSign=sign;}
  rows.push({index,minLength:lo,maxLength:hi,minMomentArm:minArm,deadCenter:crossed||minArm<.005,method:'101 uniform pose samples; clearance unverified'});
 }return rows;
}
export function addSurfaceActuators(recipe,geometry,joint){
 const m=checkedMechanism(recipe),node=m.nodes[joint];if(!node?.surfacePanel)throw Error('Choose a divided panel');const source=node.surfacePanel.source,chain=m.nodes.map((n,i)=>({n,i})).filter(v=>v.n.surfacePanel?.source===source),before=constructBodies(m);
 for(const {n,i}of chain){if(n.surfacePanel.index===0||m.pistons.some(p=>p.hinge&&p.b===i))continue;const parent=m.nodes[n.parent],h=Math.min(parent.length,n.length)*.32;const pa=surfaceBounds(geometry,`link:${n.parent}`),pb=surfaceBounds(geometry,`link:${i}`);m.pistons.push({a:n.parent,b:i,aBaseZ:pa.max.z,bBaseZ:pb.max.z,aOffset:[parent.length*.45,-h],bOffset:[n.length*.15,h],hinge:true,z:bodyLayout(m).layers[i]+.27});}
 const fresh=constructBodies(m),byId=new Map(geometry.bodies.map(b=>[b.id,b])),bodies=[];
 for(const d of fresh.defs){const prior=byId.get(d.id);if(prior&&!d.id.startsWith('piston:')){const object=loader.parse(prior.object);for(const child of [...object.children])if(child.userData.surfaceDrive)object.remove(child);for(const child of d.object.children)if(child.userData.surfaceDrive)object.add(child.clone(true));bodies.push({id:d.id,geometryKey:d.geometryKey,object:serialize(object)});disposeGeometry(object);}else if(prior&&prior.geometryKey===d.geometryKey)bodies.push(prior);else bodies.push({id:d.id,geometryKey:d.geometryKey,object:serialize(d.object)});}
 before.defs.forEach(d=>disposeGeometry(d.object));fresh.defs.forEach(d=>disposeGeometry(d.object));return {recipe:m,geometry:{schema:geometry.schema,bodies},report:actuatorReport(m)};
}
