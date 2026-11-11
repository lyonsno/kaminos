import * as THREE from './lib/three.core.js';
import {MarchingCubes} from './vendor/MarchingCubes.js';
import {checkedPose} from './scene-edit-session.mjs';
import {compileNeighborField} from './stockroom-space-context.mjs';
export const SPACE_SOURCE='kaminos:stockroom-space-v1';
export const defaultSpace=()=>({schema:'kaminos.stockroom-space.v1',resolution:36,neighbors:[],claims:[{id:'passage',role:'empty',center:[0,1.05,0],radii:[1.25,.85,1.2],rotation:[0,0,0],rim:true,bandNormal:[0,0,1],bandHalfWidth:.44}]});
const resources=new WeakMap();
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x))))throw Error(`Finite ${name} required`);return [...v];};
export function checkedSpace(value){
 if(value?.schema!=='kaminos.stockroom-space.v1'||!Number.isSafeInteger(value.resolution)||value.resolution<12||!Array.isArray(value.claims)||!value.claims.length)throw Error('Invalid space recipe');
 const ids=new Set();
 const claims=value.claims.map(c=>{
  if(typeof c?.id!=='string'||!c.id||ids.has(c.id)||!['occupy','empty'].includes(c.role)||typeof c.rim!=='boolean'||c.rim&&c.role!=='empty')throw Error('Space claims require unique identity, role and boundary choice');
  ids.add(c.id);const radii=vector(c.radii,'claim radii');if(radii.some(x=>x<=.04))throw Error('Claim radii must exceed four centimetres');
  const bandNormal=vector(c.bandNormal??[0,0,1],'boundary normal'),length=Math.hypot(...bandNormal),bandHalfWidth=c.bandHalfWidth??.44;
  if(length<1e-8||!Number.isFinite(bandHalfWidth)||bandHalfWidth<=0)throw Error('An explicit boundary frame and positive thickness are required');
  return {id:c.id,role:c.role,center:vector(c.center,'claim center'),radii,rotation:vector(c.rotation,'claim rotation'),rim:c.rim,bandNormal:bandNormal.map(x=>x/length),bandHalfWidth};
 });
 const neighbors=value.neighbors??[];if(!Array.isArray(neighbors)||!neighbors.every(id=>typeof id==='string'&&id)||new Set(neighbors).size!==neighbors.length)throw Error('Construction neighbors require unique scene identities');
 return {schema:value.schema,resolution:value.resolution,neighbors:[...neighbors],claims};
}
function frame(claim){return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...claim.rotation));}
function compiledClaim(c){
 const e=frame(c).invert().elements,r=c.radii,small=Math.min(...r);
 return (x,y,z,inflate=0)=>{
  x-=c.center[0];y-=c.center[1];z-=c.center[2];
  const a=(e[0]*x+e[4]*y+e[8]*z)/(r[0]+inflate),b=(e[1]*x+e[5]*y+e[9]*z)/(r[1]+inflate),d=(e[2]*x+e[6]*y+e[10]*z)/(r[2]+inflate);
  return (Math.hypot(a,b,d)-1)*(small+inflate);
 };
}
const smoothUnion=(a,b)=>{const h=Math.max(.18-Math.abs(a-b),0)/.18;return Math.min(a,b)-h*h*.045;};
export function compileSpace(value,context={boxes:[]}){
 const p=checkedSpace(value),parts=p.claims.map(c=>({c,distance:compiledClaim(c)})),obstacles=compileNeighborField(context.boxes);
 return (x,y,z)=>{
  let solid=1e6;
  for(const {c,distance}of parts){
   if(c.role==='occupy')solid=smoothUnion(solid,distance(x,y,z));
   // A kept-open region can bring its surrounding bearing into being. The
   // shallow band is an explicit fixture construction rule, not a terrain solve.
   else if(c.rim)solid=smoothUnion(solid,Math.max(distance(x,y,z,.3),Math.abs((x-c.center[0])*c.bandNormal[0]+(y-c.center[1])*c.bandNormal[1]+(z-c.center[2])*c.bandNormal[2])-c.bandHalfWidth));
  }
  for(const {c,distance}of parts)if(c.role==='empty')solid=Math.max(solid,-distance(x,y,z));
  solid=obstacles(x,y,z,solid);
  return Math.max(solid,-y);
 };
}
export const concreteDistance=(value,point)=>compileSpace(value)(...point);
export function spaceDirection(value,probe){
 const p=checkedSpace(value),c=probe.claim?p.claims.find(c=>c.id===probe.claim):null;
 let normal;
 if(probe.claim&&!c)throw Error('Space claim no longer exists');
 if(c){
  const local=new THREE.Vector3(...vector(probe.point,'probe')).sub(new THREE.Vector3(...c.center)).applyMatrix4(frame(c).invert());
  // Existing regions expose their six principal boundaries. Choose that local
  // side before commitment; never reclassify it during the gesture.
  const weights=local.toArray().map((v,i)=>v/c.radii[i]),index=weights.map(Math.abs).indexOf(Math.max(...weights.map(Math.abs)));
  normal=new THREE.Vector3();normal.setComponent(index,Math.sign(weights[index])||1);normal.applyMatrix4(frame(c));
 }else normal=new THREE.Vector3(...vector(probe.normal??probe.axis,'surface normal'));
 if(normal.lengthSq()<1e-12)throw Error('A nonzero local direction is required');
 return normal.normalize().toArray().map(x=>Math.abs(x)<1e-12?0:x);
}
export function nextSpaceClaimId(value){const ids=new Set(value.claims.map(c=>c.id));let i=1;while(ids.has(`region:${i}`))i++;return `region:${i}`;}
export function closestSpaceClaim(value,point){return checkedSpace(value).claims.map(c=>({id:c.id,distance:Math.abs(compiledClaim(c)(...point))})).sort((a,b)=>a.distance-b.distance)[0].id;}
export function transformSpaceClaim(value,parentWorld){
 const p=checkedSpace(value.space),c=p.claims.find(c=>c.id===value.claim),pose=checkedPose(value),anchor=checkedPose(value.anchor);
 if(!c||!parentWorld?.isMatrix4||Math.abs(parentWorld.determinant())<1e-12||anchor.scale.some(x=>Math.abs(x)<1e-12))throw Error('An existing region and invertible construction frame are required');
 if(['position','rotation','scale'].every(k=>pose[k].every((x,i)=>x===anchor[k][i])))return p;
 const matrix=s=>new THREE.Matrix4().compose(new THREE.Vector3(...s.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)),new THREE.Vector3(...s.scale));
 const delta=parentWorld.clone().invert().multiply(matrix(pose)).multiply(matrix(anchor).invert()).multiply(parentWorld),local=delta.clone().multiply(matrix({position:c.center,rotation:c.rotation,scale:c.radii}));
 const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();local.decompose(position,rotation,scale);
 const reconstructed=new THREE.Matrix4().compose(position,rotation,scale),magnitude=Math.max(1,...local.elements.map(Math.abs));
 if(local.elements.some((x,i)=>Math.abs(x-reconstructed.elements[i])>1e-8*magnitude))throw Error('This region edit would introduce shear; use Local axes or uniform construction scale');
 const bandNormal=new THREE.Vector3(...c.bandNormal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(delta));c.bandHalfWidth/=bandNormal.length();c.bandNormal=bandNormal.normalize().toArray();
 const euler=new THREE.Euler().setFromQuaternion(rotation);c.center=position.toArray();c.rotation=[euler.x,euler.y,euler.z];c.radii=scale.toArray();return checkedSpace(p);
}
export function pullSpace(value,probe,amount,role){
 const p=checkedSpace(value);if(!Number.isFinite(amount)||!['empty','occupy'].includes(role))throw Error('Finite displacement and an explicit disposition required');
 const point=vector(probe.point,'probe'),axis=new THREE.Vector3(...vector(probe.axis,'locked direction')).normalize();
 if(axis.lengthSq()<.5)throw Error('Nonzero locked direction required');
 if(amount===0)return p;
 const c=p.claims.find(c=>c.id===probe.claim);
 if(probe.claim&&!c)throw Error('Space claim no longer exists');
 if(c){
  const localAxis=axis.clone().applyMatrix4(frame(c).invert()),index=localAxis.toArray().map(Math.abs).indexOf(Math.max(...localAxis.toArray().map(Math.abs)));
  if(Math.abs(localAxis.getComponent(index))<.999999)throw Error('Claim resizing requires its previewed principal direction');
  c.radii[index]+=amount/2;c.center=c.center.map((v,i)=>v+axis.getComponent(i)*amount/2);
 }else{
  const id=probe.id??nextSpaceClaimId(p);if(p.claims.some(c=>c.id===id))throw Error('New region identity already exists');
  const effectiveRole=amount>0?role:role==='empty'?'occupy':'empty',direction=axis.clone().multiplyScalar(Math.sign(amount));
  const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction));
  const radius=probe.radius??.42;if(!Number.isFinite(radius)||radius<=.04)throw Error('Region reach must exceed four centimetres');
  p.claims.push({id,role:effectiveRole,center:point.map((v,i)=>v+axis.getComponent(i)*amount/2),radii:[radius,Math.abs(amount)/2+.19,radius],rotation:[rotation.x,rotation.y,rotation.z],rim:effectiveRole==='empty',bandNormal:probe.bandNormal??[0,0,1],bandHalfWidth:radius});
 }
 return checkedSpace(p);
}
export function spaceBounds(value){
 const p=checkedSpace(value),box=new THREE.Box3();
 for(const c of p.claims){
  if(c.role==='empty'&&!c.rim)continue;
  const r=c.radii.map(x=>x+(c.rim ? .3 : 0)),rotation=frame(c),extent=[0,1,2].map(i=>Math.hypot(...r.map((v,j)=>v*rotation.elements[j*4+i])));
  box.expandByPoint(new THREE.Vector3(...c.center.map((v,i)=>v-extent[i])));box.expandByPoint(new THREE.Vector3(...c.center.map((v,i)=>v+extent[i])));
 }
 if(box.isEmpty())throw Error('A space needs at least one material-bearing claim');
 const size=box.getSize(new THREE.Vector3());box.expandByVector(size.multiplyScalar(4/(p.resolution-8)).addScalar(.22));return box;
}
export function rebuildSpace(root,value,context=null){
 const p=checkedSpace(value);context??=root.userData.spaceNeighborhood??{boxes:[],unavailable:p.neighbors.map(id=>({id,reason:'unresolved construction neighbor'}))};
 root.userData.stockroomSpace=p;root.userData.spaceNeighborhood=context;
 const unresolved=!!context.unavailable?.length;
 if(unresolved&&resources.has(root)){
  const mesh=resources.get(root).mesh;if(mesh.visible){mesh.visible=false;root.userData.spaceRevision=(root.userData.spaceRevision??0)+1;}return root;
 }
 // Construct the hidden mesh/material before native admission even when a
 // neighbor loads later; never display the unconstrained intermediate shape.
 const distance=compileSpace(p,unresolved?{boxes:[]}:context),bounds=spaceBounds(p),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 let resource=resources.get(root);
 if(!resource||resource.resolution!==p.resolution){
  const material=resource?.mesh.material??new THREE.MeshStandardMaterial({color:0x96999b,roughness:.86,metalness:0});
  // Five triangles per processed cell is the extractor's complete capacity,
  // rather than its default silent 10K polygon truncation.
  const extractor=new MarchingCubes(p.resolution,material,false,false,5*(p.resolution-3)**3),mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);
  mesh.name='Concrete boundary';mesh.castShadow=mesh.receiveShadow=true;mesh.isolation=0;mesh.userData.spaceSurface=true;
  extractor.isolation=0;
  if(resource){resource.mesh.removeFromParent();resource.mesh.geometry.dispose();resource.extractor.geometry.dispose();}
  root.add(mesh);resource={mesh,extractor,resolution:p.resolution};resources.set(root,resource);
 }
 const {mesh,extractor}=resource,n=p.resolution;mesh.visible=!unresolved;extractor.normal_cache.fill(0);
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)extractor.field[x+n*(y+n*z)]=-distance(bounds.min.x+size.x*x/n,bounds.min.y+size.y*y/n,bounds.min.z+size.z*z/n);
 extractor.update();let geometry=mesh.geometry;
 if(geometry.attributes.position?.count===extractor.count){
  geometry.boundsTree=null;
  for(const [name,array]of [['position',extractor.positionArray],['normal',extractor.normalArray]]){const attribute=geometry.attributes[name];attribute.array.set(array.subarray(0,extractor.count*3));attribute.needsUpdate=true;}
 }else{
  geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(extractor.positionArray.slice(0,extractor.count*3),3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(extractor.normalArray.slice(0,extractor.count*3),3));const old=mesh.geometry;mesh.geometry=geometry;old.dispose();
 }
 geometry.setDrawRange(0,extractor.count);geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.count=extractor.count;mesh.position.copy(center);mesh.scale.copy(size).multiplyScalar(.5);root.userData.spaceRevision=(root.userData.spaceRevision??0)+1;
 root.userData.stockroomSpace=p;root.name='Concrete place';root.updateMatrixWorld(true);return root;
}
export const createSpace=value=>rebuildSpace(new THREE.Group(),value??defaultSpace());
export const spaceRecordDomain=Object.freeze({type:'pbr',source:SPACE_SOURCE,
 check:r=>({...r,space:checkedSpace(r.space)}),fields:r=>({space:checkedSpace(r.space)}),recognize:root=>!!root?.userData?.stockroomSpace,
 capture:entry=>({source:SPACE_SOURCE,space:checkedSpace(entry.object.userData.stockroomSpace)}),
 reloadable:r=>{checkedSpace(r.space);spaceBounds(r.space);return true;},load:(r,loaders,options)=>loaders.constructed(createSpace(r.space),r,options),
});
