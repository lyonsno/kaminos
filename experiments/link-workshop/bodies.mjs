import * as T from '../../lib/three.core.js';
import {checkedMechanism,frames} from './model.mjs';

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
export function travelEnvelope(m,a,b,tolerance=1e-3){
 checkedMechanism(m);if(![a,b].every(i=>Number.isInteger(i)&&m.nodes[i])||!Number.isFinite(tolerance)||tolerance<=0)throw Error('Valid attachments and positive travel tolerance required');
 const speeds=[];let speed=0;
 m.nodes.forEach((n,i)=>{if(n.parent===null)speeds[i]={angular:0,linear:0};else{const p=speeds[n.parent],angular=p.angular+Math.abs(n.angles[1]-n.angles[0]);speeds[i]={angular,linear:p.linear+n.length*angular};}});
 speed=speeds[a].linear+speeds[b].linear;if(!Number.isFinite(speed))throw Error('Authored motion exceeds numeric travel range');
 const distance=t=>{const f=frames(m,t),p=f[a].point,q=f[b].point;return Math.hypot(q[0]-p[0],q[1]-p[1]);};
 let lo=Infinity,hi=0;const leaves=[],pending=[[0,1]];
 while(pending.length){const [l,r]=pending.pop(),mid=(l+r)/2,d=distance(mid),error=speed*(r-l)/2;lo=Math.min(lo,d);hi=Math.max(hi,d);
  if(error<=tolerance || (d-error>=lo-tolerance&&d+error<=hi+tolerance))leaves.push([Math.max(0,d-error),d+error]);
  else pending.push([l,mid],[mid,r]);
 }
 return {min:leaves.reduce((v,x)=>Math.min(v,x[0]),Infinity),max:leaves.reduce((v,x)=>Math.max(v,x[1]),0),tolerance};
}

export function bodyLayout(recipe){
 const used=recipe.nodes.map(()=>new Set()),layers=[];
 recipe.nodes.forEach((n,i)=>{if(n.parent===null){layers[i]=0;used[i].add(0);}else{let slot=0;while(used[n.parent].has(slot))slot++;used[n.parent].add(slot);used[i].add(slot);layers[i]=slot*pitch;}});
 const pistonZ=layers.reduce((a,b)=>Math.max(a,b),0)+pitch;
 const joints=recipe.nodes.map((n,i)=>{const z=[layers[i],...recipe.nodes.flatMap((c,j)=>c.parent===i?[layers[j]]:[]),...recipe.pistons.flatMap((p,j)=>(p.a===i||p.b===i)?[pistonZ+j*pitch]:[])];return {low:Math.min(...z)-thickness/2,high:Math.max(...z)+thickness/2};});
 return {layers,pistonZ,joints};
}

export function constructBodies(value){
 const recipe=checkedMechanism(value),defs=[],{layers,pistonZ,joints}=bodyLayout(recipe);
 const holes=recipe.nodes.map((n,i)=>Math.min(bore,...recipe.nodes.flatMap((c,j)=>(j===i||c.parent===i)&&c.parent!==null?[c.length/6]:[])));
 const add=(id,kind,parameters,build,pose)=>{const object=new T.Group();object.name=id;object.userData.assemblyBody={id,kind,parameters,frame:'local XY links, local Z hinges, local X piston travel'};build(object);defs.push({id,kind,geometryKey:JSON.stringify([kind,parameters]),object,pose});};
 recipe.nodes.forEach((n,i)=>{
  if(n.parent===null)add(`anchor:${i}`,'anchor',[.5,.5,.18],g=>box(g,[.5,.5,.18],[0,0,-.16],0x374653),f=>({position:[...f[i].point,0],angle:0}));
  else add(`link:${i}`,'link',[n.length,thickness,eye,holes[n.parent],holes[i]],g=>plate(g,n.length,[holes[n.parent],holes[i]]),f=>({position:[...f[n.parent].point,layers[i]],angle:f[i].angle}));
  const {low,high}=joints[i];
  add(`pin:${i}`,'pin',[low,high,holes[i]],g=>{cylinder(g,holes[i]*.94,high-low,[0,0,(high+low)/2],0xc9a875);for(const z of [low-.025,high+.025])cylinder(g,.105,.05,[0,0,z],0xc9a875);},f=>({position:[...f[i].point,0],angle:f[i].angle}));
 });
 const travels=recipe.pistons.map((p,j)=>{
  const range=travelEnvelope(recipe,p.a,p.b),barrel=Math.max(.04,range.min*.85),rod=Math.max(.04,range.max-barrel+.08),z=pistonZ+j*pitch;
  const angle=f=>Math.atan2(f[p.b].point[1]-f[p.a].point[1],f[p.b].point[0]-f[p.a].point[0]);
  add(`piston:${j}:barrel`,'barrel',[barrel,holes[p.a]],g=>{cylinder(g,.11,barrel,[barrel/2,0,0],0x374653,'x',.049);cylinder(g,.13,thickness,[0,0,0],0xc9a875,'z',holes[p.a]);},f=>({position:[...f[p.a].point,z],angle:angle(f)}));
  add(`piston:${j}:rod`,'rod',[rod,holes[p.b]],g=>{cylinder(g,.045,rod,[-rod/2,0,0],0xcdd7de,'x');cylinder(g,.13,thickness,[0,0,0],0xc9a875,'z',holes[p.b]);},f=>({position:[...f[p.b].point,z],angle:angle(f)}));
  return {...p,...range,barrel,rod};
 });
 return {recipe,defs,travels};
}
export function createBodyView(root){
 let construction=null,key=null;const bodies=new Map(),replacements=new Set();
 function update(m,t){
  const next=JSON.stringify([m.nodes,m.pistons]);
  if(next!==key){
   const fresh=constructBodies(m),old=new Map(bodies);bodies.clear();
   for(const def of fresh.defs){const prior=old.get(def.id);if(prior&&prior.geometryKey===def.geometryKey){release(def.object);def.object=prior.object;old.delete(def.id);}else{root.add(def.object);replacements.delete(def.id);}bodies.set(def.id,def);}
   for(const d of old.values()){release(d.object);if(!bodies.has(d.id))replacements.delete(d.id);}construction=fresh;key=next;
  }
  const f=frames(m,t);for(const b of bodies.values()){const pose=b.pose(f);b.object.position.set(...pose.position);b.object.rotation.set(0,0,pose.angle);b.object.scale.set(1,1,1);}
  root.updateMatrixWorld(true);
 }
 function manifest(){return {schema:'kaminos.assembly-bodies.v1',bodies:[...bodies.values()].map(b=>({id:b.id,kind:b.kind,geometryKey:b.geometryKey,frame:'body-local; rigid pose only',position:b.object.position.toArray(),quaternion:b.object.quaternion.toArray()})),replacements:replacements.size,travel:construction?.travels??[],warnings:(construction?.travels??[]).flatMap((p,i)=>p.rod>p.min? [`Piston ${i+1}: requested travel puts the rod through the rear of the barrel at retraction.`]:[])};}
 function exportBodies(){return {schema:'kaminos.assembly-geometry.v1',bodies:[...bodies.values()].map(b=>{const clone=b.object.clone(true);clone.position.set(0,0,0);clone.quaternion.identity();clone.scale.set(1,1,1);clone.updateMatrix();return {id:b.id,geometryKey:b.geometryKey,object:clone.toJSON()};})};}
 function importBodies(packet){
  if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!packet.bodies.length)throw Error('Choose an assembly geometry package');
  const staged=[],seen=new Set();try{for(const item of packet.bodies){const b=bodies.get(item.id);if(!b||b.geometryKey!==item.geometryKey||seen.has(item.id))throw Error('Body identity or geometry does not match this recipe');seen.add(item.id);const object=new T.ObjectLoader().parse(item.object);staged.push({b,object});let vertices=0;object.traverse(o=>{if(o.isMesh){const p=o.geometry?.attributes?.position;if(!p)throw Error('Missing mesh positions');for(const x of p.array)if(!Number.isFinite(x))throw Error('Nonfinite mesh positions');vertices+=p.count;}});if(!vertices)throw Error('Empty body geometry');if(object.position.length()>1e-8||object.quaternion.angleTo(new T.Quaternion())>1e-8||object.scale.distanceTo(new T.Vector3(1,1,1))>1e-8)throw Error('Returned body must use its exported local frame');}
  }catch(e){for(const s of staged)release(s.object);throw e;}
  for(const {b,object}of staged){object.position.copy(b.object.position);object.quaternion.copy(b.object.quaternion);release(b.object);b.object=object;root.add(object);replacements.add(b.id);}root.updateMatrixWorld(true);return manifest();
 }
 return {update,manifest,exportBodies,importBodies,replacementState(){const p=exportBodies();p.bodies=p.bodies.filter(b=>replacements.has(b.id));return p;},dispose(){for(const b of bodies.values())release(b.object);bodies.clear();}};
}
