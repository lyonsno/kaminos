import * as T from '../../lib/three.core.js';
import {checkedMechanism,frames,pistonMountPoint} from './model.mjs';

// Construction is derived from an authored forest, never from an arm template.
// Each body has immutable local geometry and a rigid placement at each pose.
const pitch=.22,thickness=.14,eye=.15,bore=.065;
const material=(color)=>new T.MeshStandardMaterial({color,metalness:.72,roughness:.3});
function mesh(parent,g,color){const m=new T.Mesh(g,material(color));m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
function box(parent,size,at,color){const m=mesh(parent,new T.BoxGeometry(...size),color);m.position.set(...at);return m;}
function cylinder(parent,r,length,at,color,axis='z',inner=0){
 let g;
 if(inner){const shape=new T.Shape();shape.absarc(0,0,r,0,Math.PI*2,false);const hole=new T.Path();hole.absarc(0,0,inner,0,Math.PI*2,true);shape.holes.push(hole);g=new T.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:24});g.translate(0,0,-length/2);}
 else{g=new T.CylinderGeometry(r,r,length,32);g.rotateX(Math.PI/2);}
 if(axis==='x')g.rotateY(Math.PI/2);
 const m=mesh(parent,g,color);m.position.set(...at);return m;
}
function plate(parent,length,holes){
 // Rounded link with actual through-bores at both attachment centers.
 const s=new T.Shape();s.moveTo(0,-eye);s.lineTo(length,-eye);s.absarc(length,0,eye,-Math.PI/2,Math.PI/2,false);s.lineTo(0,eye);s.absarc(0,0,eye,Math.PI/2,3*Math.PI/2,false);
 for(const [i,x] of [0,length].entries()){const h=new T.Path();h.absarc(x,0,holes[i],0,Math.PI*2,true);s.holes.push(h);}
 const g=new T.ExtrudeGeometry(s,{depth:thickness,bevelEnabled:false,curveSegments:24});g.translate(0,0,-thickness/2);mesh(parent,g,0x408b98);
}
function release(root){const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();root.removeFromParent();}

// Lipschitz enclosure over the WHOLE authored interpolation, including interior
// extrema. Refinement stops at a length tolerance, not at a preset sample count.
export function travelEnvelope(m,a,b,tolerance=1e-3,piston=null){
 checkedMechanism(m);if(![a,b].every(i=>Number.isInteger(i)&&m.nodes[i])||!Number.isFinite(tolerance)||tolerance<=0)throw Error('Valid attachments and positive travel tolerance required');
 const speeds=[];let speed=0;
 m.nodes.forEach((n,i)=>{if(n.parent===null)speeds[i]={angular:0,linear:0};else{const p=speeds[n.parent],angular=p.angular+Math.abs(n.angles[1]-n.angles[0]);speeds[i]={angular,linear:p.linear+n.length*angular};}});
 const entry=piston??m.pistons.find(p=>p.a===a&&p.b===b),mountSpeed=(id,offset)=>!offset?speeds[id].linear:m.nodes[id].parent===null?0:speeds[m.nodes[id].parent].linear+Math.hypot(...offset)*speeds[id].angular;
 speed=mountSpeed(a,entry?.aOffset)+mountSpeed(b,entry?.bOffset);if(!Number.isFinite(speed))throw Error('Authored motion exceeds numeric travel range');
 const distance=t=>{const f=frames(m,t),p=pistonMountPoint(m,f,a,entry?.aOffset),q=pistonMountPoint(m,f,b,entry?.bOffset);return Math.hypot(q[0]-p[0],q[1]-p[1]);};
 let lo=Infinity,hi=0;const leaves=[],pending=[[0,1]];
 while(pending.length){const [l,r]=pending.pop(),mid=(l+r)/2,d=distance(mid),error=speed*(r-l)/2;lo=Math.min(lo,d);hi=Math.max(hi,d);
  if(error<=tolerance || (d-error>=lo-tolerance&&d+error<=hi+tolerance))leaves.push([Math.max(0,d-error),d+error]);
  else pending.push([l,mid],[mid,r]);
 }
 return {min:leaves.reduce((v,x)=>Math.min(v,x[0]),Infinity),max:leaves.reduce((v,x)=>Math.max(v,x[1]),0),tolerance};
}

export function bodyLayout(recipe){
 const used=recipe.nodes.map(()=>new Set()),layers=[];
 recipe.nodes.forEach((n,i)=>{if(n.parent===null){layers[i]=0;used[i].add(0);}else{let slot=0;while(used[n.parent].has(slot))slot++;used[n.parent].add(slot);used[i].add(slot);layers[i]=n.layer??slot*pitch;}});
 const pistonZ=layers.reduce((a,b)=>Math.max(a,b),0)+pitch;
 const joints=recipe.nodes.map((n,i)=>{const z=[layers[i],...recipe.nodes.flatMap((c,j)=>c.parent===i?[layers[j]]:[]),...recipe.pistons.flatMap((p,j)=>((p.a===i&&!p.aOffset)||(p.b===i&&!p.bOffset))?[p.z??pistonZ+j*pitch]:[])];return {low:Math.min(...z)-thickness/2,high:Math.max(...z)+thickness/2};});
 return {layers,pistonZ,pistonLayers:recipe.pistons.map((p,j)=>p.z??pistonZ+j*pitch),joints};
}

export function constructBodies(value,reuse=new Map()){
 const recipe=checkedMechanism(value),defs=[],{layers,pistonLayers,joints}=bodyLayout(recipe);
 const holes=recipe.nodes.map((n,i)=>Math.min(bore,...recipe.nodes.flatMap((c,j)=>(j===i||c.parent===i)&&c.parent!==null?[c.length/6]:[])));
 const add=(id,kind,parameters,build,pose,geometryKey=JSON.stringify([kind,parameters]))=>{const prior=reuse.get(id);let object=prior?.geometryKey===geometryKey?prior.object:null;if(!object){object=new T.Group();object.name=id;object.userData.assemblyBody={id,kind,parameters,frame:'local XY links, local Z hinges, local X piston travel'};build(object);}defs.push({id,kind,geometryKey,object,pose});};
 recipe.nodes.forEach((n,i)=>{
  const kind=n.parent===null?'anchor':'link',parameters=n.parent===null?[.5,.5,.18]:[n.length,thickness,eye,holes[n.parent],holes[i]],hinges=recipe.pistons.filter(p=>p.hinge&&(p.a===i||p.b===i)),baseKey=JSON.stringify([kind,parameters]),geometryKey=hinges.length?JSON.stringify([baseKey,hinges.map(({mechanics,hydraulics,...shape})=>shape)]):baseKey;
  const baseZ=n.parent===null?0:layers[i];
  add(`${kind}:${i}`,kind,parameters,object=>{
   if(n.parent===null)box(object,[.5,.5,.18],[0,0,-.16],0x374653);else plate(object,n.length,[holes[n.parent],holes[i]]);
  for(const [j,p]of recipe.pistons.entries())for(const end of ['a','b'])if(p.hinge&&p[end]===i){const at=p[end+'Offset'],rx=Math.max(0,Math.min(n.length??0,at[0])),z=pistonLayers[j]-baseZ,seat=p[end+'BaseZ']??0;
   const shape=new T.Shape();shape.moveTo(rx-.09,0);shape.lineTo(at[0],at[1]);shape.lineTo(rx+.09,0);shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false});geo.translate(0,0,-.06);const horn=mesh(object,geo,0xc9a875);horn.position.z=seat;horn.name='Hinge horn';horn.userData.surfaceDrive=true;
   if(p[end+'Seat']){const from=new T.Vector3(...p[end+'Seat']),to=new T.Vector3(rx,0,seat),direction=to.clone().sub(from),length=direction.length();if(length>1e-6){const support=mesh(object,new T.CylinderGeometry(.065,.065,length+.12,16),0xc9a875);support.position.copy(from).add(to).multiplyScalar(.5);support.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize());support.name='Panel-to-horn support';support.userData.surfaceDrive=true;}}

   const pin=cylinder(object,.055,Math.abs(z-seat)+.18,[...at,(z+seat)/2],0xc9a875);pin.name='Actuator mount pin';pin.userData.surfaceDrive=true;
  }
  },n.parent===null?f=>({position:[...f[i].point,0],angle:0}):f=>({position:[...f[n.parent].point,layers[i]],angle:f[i].angle}),geometryKey);
  const {low,high}=joints[i];
  add(`pin:${i}`,'pin',[low,high,holes[i]],g=>{cylinder(g,holes[i]*.94,high-low,[0,0,(high+low)/2],0xc9a875);for(const z of [low-.025,high+.025])cylinder(g,.105,.05,[0,0,z],0xc9a875);},f=>({position:[...f[i].point,0],angle:f[i].angle}));
 });
 const travels=recipe.pistons.map((p,j)=>{
  const fixed=p.mechanics,range=fixed?{min:fixed.minLength,max:fixed.maxLength,tolerance:0}:travelEnvelope(recipe,p.a,p.b,1e-3,p),barrel=fixed?.barrelLength??Math.max(.04,range.min*.85),rod=fixed?.rodLength??Math.max(.04,range.max-barrel+.08),z=pistonLayers[j];
  const a=f=>pistonMountPoint(recipe,f,p.a,p.aOffset),b=f=>pistonMountPoint(recipe,f,p.b,p.bOffset),angle=f=>Math.atan2(b(f)[1]-a(f)[1],b(f)[0]-a(f)[0]);
  add(`piston:${j}:barrel`,'barrel',[barrel,holes[p.a]],g=>{const m=cylinder(g,.11,barrel,[barrel/2,0,0],0x374653,'x',.049);m.userData.baseColor=0x374653;cylinder(g,.13,thickness,[0,0,0],0xc9a875,'z',holes[p.a]);},f=>({position:[...a(f),z],angle:angle(f)}));
  add(`piston:${j}:rod`,'rod',[rod,holes[p.b]],g=>{const m=cylinder(g,.045,rod,[-rod/2,0,0],0xcdd7de,'x');m.userData.baseColor=0xcdd7de;cylinder(g,.13,thickness,[0,0,0],0xc9a875,'z',holes[p.b]);},f=>({position:[...b(f),z],angle:angle(f)}));
  return {...p,...range,barrel,rod};
 });
 for(const d of defs){const m=/^piston:(\d+):/.exec(d.id);if(m)d.object.traverse(o=>{if(o.isMesh)o.userData.piston={kind:'pistons',index:+m[1]};});}
 return {recipe,defs,travels};
}
export function exportBodyGeometry(value){
 const recipe=checkedMechanism(value),root=new T.Group(),view=createBodyView(root);
 try{view.update(recipe,0);return {...view.exportBodies(),key:JSON.stringify([recipe.nodes,recipe.pistons])};}
 finally{view.dispose();}
}
export function checkedBodyGeometry(value,geometry){
 if(geometry===undefined||geometry===null)return undefined;
 if(geometry?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(geometry.bodies))throw Error('Choose an assembly geometry package');
 if(!geometry.bodies.length)return undefined;
 const recipe=checkedMechanism(value),root=new T.Group(),view=createBodyView(root);
 try{view.update(recipe,0);view.importBodies(geometry);return structuredClone(geometry);}
 finally{view.dispose();}
}
export function remapBodyGeometry(before,after,geometry,{removedNode=null,removedPiston=null}={}){
 if(!geometry?.bodies?.length)return {schema:'kaminos.assembly-geometry.v1',bodies:[]};
 const nodeMap=new Map(),pistonMap=new Map();
 if(Number.isInteger(removedNode)){
  const drop=new Set([removedNode]);let changed=true;
  while(changed){changed=false;before.nodes.forEach((n,i)=>{if(!drop.has(i)&&drop.has(n.parent)){drop.add(i);changed=true;}});}
  let nextI=0;before.nodes.forEach((_,i)=>{if(!drop.has(i))nodeMap.set(i,nextI++);});
  let nextJ=0;before.pistons.forEach((p,j)=>{if(!drop.has(p.a)&&!drop.has(p.b))pistonMap.set(j,nextJ++);});
 }else{
  before.nodes.forEach((_,i)=>nodeMap.set(i,i));
  let nextJ=0;before.pistons.forEach((_,j)=>{if(j!==removedPiston)pistonMap.set(j,nextJ++);});
 }
 const fresh=constructBodies(after);for(const d of fresh.defs)release(d.object);
 const byId=new Map(fresh.defs.map(d=>[d.id,d])),bodies=[];
 for(const item of geometry.bodies){
  let nextId=null;
  const nm=/^(anchor|link|pin):(\d+)$/.exec(item.id),pm=/^piston:(\d+):(barrel|rod)$/.exec(item.id);
  if(nm&&nodeMap.has(+nm[2]))nextId=`${nm[1]}:${nodeMap.get(+nm[2])}`;
  else if(pm&&pistonMap.has(+pm[1]))nextId=`piston:${pistonMap.get(+pm[1])}:${pm[2]}`;
  const def=nextId?byId.get(nextId):null;
  if(def)bodies.push({...structuredClone(item),id:nextId,geometryKey:def.geometryKey});
 }
 return {schema:'kaminos.assembly-geometry.v1',bodies};
}
export function createBodyView(root){
 let construction=null,key=null,lastArgs;const bodies=new Map(),replacements=new Set();
 function update(m,t,selectedPiston=null){
  lastArgs=[m,t,selectedPiston];
  const next=JSON.stringify([m.nodes,m.pistons]);
  if(next!==key){
   const fresh=constructBodies(m,bodies),old=new Map(bodies);bodies.clear();
   for(const def of fresh.defs){const prior=old.get(def.id);if(prior&&prior.object===def.object){old.delete(def.id);}else{root.add(def.object);replacements.delete(def.id);}bodies.set(def.id,def);}
   for(const d of old.values()){release(d.object);if(!bodies.has(d.id))replacements.delete(d.id);}construction=fresh;key=next;
  }
  const f=frames(m,t);for(const b of bodies.values()){
   const pose=b.pose(f);b.object.position.set(...pose.position);b.object.rotation.set(0,0,pose.angle);b.object.scale.set(1,1,1);
   if(!replacements.has(b.id)){const pm=/^piston:(\d+):/.exec(b.id);if(pm){const active=selectedPiston?.kind==='pistons'&&selectedPiston.index===+pm[1];b.object.traverse(o=>{if(o.isMesh&&o.userData.baseColor!==undefined)o.material.color.setHex(active?0xf2b84b:o.userData.baseColor);});}}
  }
  root.updateMatrixWorld(true);
 }
 function clearReplacements(ids){
  const drop=new Set(ids.filter(id=>replacements.has(id)));if(!drop.size)return;
  const keep=new Map([...bodies].filter(([id])=>!drop.has(id))),fresh=constructBodies(lastArgs[0],keep);
  for(const def of fresh.defs){if(drop.has(def.id)){release(bodies.get(def.id).object);root.add(def.object);replacements.delete(def.id);}bodies.set(def.id,def);}
  construction=fresh;update(...lastArgs);
 }
 function manifest(){return {schema:'kaminos.assembly-bodies.v1',bodies:[...bodies.values()].map(b=>({id:b.id,kind:b.kind,geometryKey:b.geometryKey,replacement:replacements.has(b.id),frame:'body-local; rigid pose only',position:b.object.position.toArray(),quaternion:b.object.quaternion.toArray()})),replacements:replacements.size,travel:construction?.travels??[],warnings:(construction?.travels??[]).flatMap((p,i)=>p.rod>p.min? [`Piston ${i+1}: requested travel puts the rod through the rear of the barrel at retraction.`]:[])};}
 function exportBodies(ids=null){return {schema:'kaminos.assembly-geometry.v1',bodies:[...bodies.values()].filter(b=>!ids||ids.has(b.id)).map(b=>{const clone=b.object.clone(true);clone.position.set(0,0,0);clone.quaternion.identity();clone.scale.set(1,1,1);clone.updateMatrix();return {id:b.id,geometryKey:b.geometryKey,object:clone.toJSON()};})};}
 function importBodies(packet){
  if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!packet.bodies.length)throw Error('Choose an assembly geometry package');
  const staged=[],seen=new Set();try{for(const item of packet.bodies){const b=bodies.get(item.id);if(!b||b.geometryKey!==item.geometryKey||seen.has(item.id))throw Error('Body identity or geometry does not match this recipe');seen.add(item.id);const object=new T.ObjectLoader().parse(item.object);staged.push({b,object});if(!object.matrixAutoUpdate||!object.matrixWorldAutoUpdate)throw Error('Returned root matrix must follow the body frame');let vertices=0;object.traverse(o=>{if(o.isMesh){const p=o.geometry?.attributes?.position;if(!p)throw Error('Missing mesh positions');for(const x of p.array)if(!Number.isFinite(x))throw Error('Nonfinite mesh positions');vertices+=p.count;}});if(!vertices)throw Error('Empty body geometry');if(object.position.length()>1e-8||object.quaternion.angleTo(new T.Quaternion())>1e-8||object.scale.distanceTo(new T.Vector3(1,1,1))>1e-8)throw Error('Returned body must use its exported local frame');}
  }catch(e){for(const s of staged)release(s.object);throw e;}
  for(const {b,object}of staged){const pm=/^piston:(\d+):/.exec(b.id);if(pm)object.traverse(o=>{if(o.isMesh)o.userData.piston={kind:'pistons',index:+pm[1]};});object.position.copy(b.object.position);object.quaternion.copy(b.object.quaternion);release(b.object);b.object=object;root.add(object);replacements.add(b.id);}root.updateMatrixWorld(true);return manifest();
 }
 function bodyMeshes(id=null,names=null){const out=[];for(const b of bodies.values())if(!id||b.id===id)b.object.traverse(o=>{if(o.isMesh&&(!names||names.includes(o.name)))out.push(o);});return out;}
 function pistonMeshes(){const out=[];for(const b of bodies.values())if(/^piston:\d+:/.test(b.id))b.object.traverse(o=>{if(o.isMesh)out.push(o);});return out;}
 function bodySelection(mesh){for(const b of bodies.values()){let o=mesh;while(o){if(o===b.object){const part=mesh.userData.copyPart;return part?{id:b.id,names:bodyMeshes(b.id).filter(m=>m.userData.copyPart===part).map(m=>m.name)}:{id:b.id};}o=o.parent;}}throw Error('Choose an assembly body');}
 return {update,manifest,exportBodies,importBodies,clearReplacements,bodyMeshes,pistonMeshes,bodySelection,replacementState(){return exportBodies(replacements);},dispose(){for(const b of bodies.values())release(b.object);bodies.clear();}};
}
