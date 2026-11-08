import * as THREE from './lib/three.core.js';
export const DOCK_SOURCE='kaminos:stockroom-dock-v1';
export const defaultDock=()=>({schema:'kaminos.stockroom-dock.v1',width:6,depth:3,height:1.2,boardDirection:'x',bayLength:2,stairs:true,stairWidth:1.1,stairRun:1.8,landingHeight:.07,memberOffsets:{}});
export function checkedDock(value){
 if(value?.schema!=='kaminos.stockroom-dock.v1')throw Error('Unsupported dock recipe');
 const p={};for(const key of Object.keys(defaultDock()))p[key]=value[key];
 for(const key of ['width','depth','height','bayLength','stairWidth','stairRun','landingHeight'])if(!Number.isFinite(p[key]))throw Error(`Finite dock ${key} required`);
 if(p.width<.7||p.depth<.7||p.height<.55||p.bayLength<.3)throw Error('Dock must accommodate boards, bearing beams and posts');
 if(!['x','z'].includes(p.boardDirection)||typeof p.stairs!=='boolean')throw Error('Explicit board direction and stair choice required');
 if(p.stairWidth<.5||p.stairWidth>p.depth||p.stairRun<.3||p.landingHeight<0||p.landingHeight>=p.height-.1)throw Error('Stair width, run and landing must fit below the dock');
 if(!p.memberOffsets||typeof p.memberOffsets!=='object'||Array.isArray(p.memberOffsets))throw Error('Dock member offsets must be an object');
 const offsets={};for(const [id,offset]of Object.entries(p.memberOffsets)){
  if(!id||!offset||!['position','rotation','scale'].every(key=>Array.isArray(offset[key])&&offset[key].length===3&&offset[key].every(Number.isFinite))||offset.scale.some(v=>v<=0))throw Error('Dock member offset needs a finite pose and positive scale');
  offsets[id]=Object.fromEntries(['position','rotation','scale'].map(key=>[key,[...offset[key]]]));
 }p.memberOffsets=offsets;
 return p;
}
export function dockMembers(value){
 const p=checkedDock(value),out=[];
 const add=(id,role,size,position,rotation=[0,0,0])=>out.push({id,role,size,position,rotation});
 const boards=(role,along,span,across,y,cx=0,cz=0)=>{
  const count=Math.ceil(across/.24),width=(across-(count-1)*.008)/count;
  for(let i=0;i<count;i++){const offset=-across/2+width/2+i*(width+.008);
   add(`${role}:${i}`,role,along==='x'?[span,.07,width]:[width,.07,span],[cx+(along==='z'?offset:0),y-.035,cz+(along==='x'?offset:0)]);
  }
 };
 boards('deck',p.boardDirection,p.boardDirection==='x'?p.width:p.depth,p.boardDirection==='x'?p.depth:p.width,p.height);
 const xCount=Math.ceil((p.width-.24)/p.bayLength),zCount=Math.ceil((p.depth-.24)/p.bayLength);
 const xs=Array.from({length:xCount+1},(_,i)=>-.5*p.width+.12+i*(p.width-.24)/xCount);
 const zs=Array.from({length:zCount+1},(_,i)=>-.5*p.depth+.12+i*(p.depth-.24)/zCount);
 const along=p.boardDirection==='x',span=along?p.width:p.depth,count=Math.ceil((span-.16)/.55);
 for(let i=0;i<=count;i++){
  const v=-span/2+.08+i*(span-.16)/count;
  add(`joist:${i}`,'joist',along?[.1,.18,p.depth]:[p.width,.18,.1],[along?v:0,p.height-.16,along?0:v]);
 }
 for(const [i,v]of(along?zs:xs).entries())add(`beam:${i}`,'beam',along?[p.width,.22,.16]:[.16,.22,p.depth],[along?0:v,p.height-.36,along?v:0]);
 for(const [i,x]of xs.entries())for(const [j,z]of zs.entries())add(`post:${i}:${j}`,'post',[.17,p.height-.47,.17],[x,(p.height-.47)/2,z]);
 for(const [i,z]of[-p.depth/2+.04,p.depth/2-.04].entries())add(`fascia:z:${i}`,'fascia',[p.width,.22,.08],[0,p.height-.13,z]);
 for(const [i,x]of[-p.width/2+.04,p.width/2-.04].entries())add(`fascia:x:${i}`,'fascia',[.08,.22,p.depth-.16],[x,p.height-.13,0]);
 if(p.stairs){
  const n=Math.max(2,Math.ceil((p.height-p.landingHeight)/.18)),rise=(p.height-p.landingHeight)/n,run=p.stairRun/(n-1);
  for(let i=0;i<n-1;i++)add(`tread:${i}`,'tread',[run,.07,p.stairWidth],[p.width/2+(i+.5)*run,p.height-(i+1)*rise-.035,0]);
  const dx=p.stairRun,top=p.height-rise-.1,bottom=p.landingHeight+.08,dy=bottom-top,length=Math.hypot(dx,dy);
  for(const [i,z]of[-p.stairWidth/2+.07,p.stairWidth/2-.07].entries())add(`stringer:${i}`,'stringer',[length,.16,.1],[p.width/2+dx/2,(top+bottom)/2,z],[0,0,Math.atan2(dy,dx)]);
  add('landing:0','landing',[.7,.07,p.stairWidth],[p.width/2+p.stairRun+.35,p.landingHeight-.035,0]);
 }
 return out;
}
export function rebuildDock(root,value){
 const p=checkedDock(value),members=dockMembers(p),old=new Map(root.children.map(o=>[o.name,o]));
 if(!root.userData.dockResources){
  const colors=[0x9b9c91,0xa8a598,0x8e938c,0xb0ada0];
  root.userData.dockResources={geometry:new THREE.BoxGeometry(1,1,1),materials:colors.map(color=>new THREE.MeshStandardMaterial({color,roughness:.82})),frame:new THREE.MeshStandardMaterial({color:0x676e67,roughness:.88})};
 }
 const resources=root.userData.dockResources;
 for(const [i,m]of members.entries()){
  let mesh=old.get(m.id);old.delete(m.id);
  if(!mesh){mesh=new THREE.Mesh(resources.geometry,['deck','tread','landing'].includes(m.role)?resources.materials[i%4]:resources.frame);root.add(mesh);}
  const offset=p.memberOffsets[m.id];
  mesh.name=m.id;mesh.userData.dockMember={id:m.id,role:m.role};mesh.position.fromArray(m.position.map((v,i)=>v+(offset?.position[i]??0)));mesh.rotation.set(...m.rotation.map((v,i)=>v+(offset?.rotation[i]??0)));mesh.scale.fromArray(m.size.map((v,i)=>v*(offset?.scale[i]??1)));mesh.castShadow=mesh.receiveShadow=true;
 }
 for(const mesh of old.values())mesh.removeFromParent();
 root.userData.stockroomDock=structuredClone(p);root.name='Dock';root.updateMatrixWorld(true);return root;
}
export const createDock=value=>rebuildDock(new THREE.Group(),value??defaultDock());
export const dockRecordDomain=Object.freeze({
 type:'pbr',source:DOCK_SOURCE,
 check:record=>({...record,dock:checkedDock(record.dock)}),
 fields:record=>({dock:checkedDock(record.dock)}),
 recognize:root=>!!root?.userData?.stockroomDock,
 capture:entry=>({source:DOCK_SOURCE,dock:checkedDock(entry.object.userData.stockroomDock)}),
 reloadable:record=>{checkedDock(record.dock);return true;},
 load:(record,loaders,options)=>loaders.constructed(createDock(record.dock),record,options),
});
