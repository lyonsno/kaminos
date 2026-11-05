import * as T from '../../lib/three.core.js';
export const hingeFamilies={clevis:'Fork · hub · pin',knuckle:'Interleaved knuckles',flange:'Flange pivot'};
export function checkedHardware(value={family:'clevis',size:1}){
 if(!value||!hingeFamilies[value.family]||!Number.isFinite(value.size)||value.size<=0)throw Error('Choose a hinge family and positive size');
 const v=structuredClone(value);if(v.parts){const ids=Object.keys(v.parts);if(ids.some(id=>!['fixed','moving','pin'].includes(id)))throw Error('Unknown hinge part slot');for(const id of ids){if(!v.parts[id]?.object)throw Error('Hinge return requires serialized part geometry');if(!['Group','Mesh','Object3D'].includes(v.parts[id].object.type))throw Error('Invalid hinge part');}}
 return v;
}
export function disposePart(o){const gs=new Set(),ms=new Set();o.traverse(m=>{if(m.geometry)gs.add(m.geometry);for(const x of Array.isArray(m.material)?m.material:[m.material])if(x)ms.add(x);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());o.removeFromParent();}
export function buildHingeParts(value){
 const h=checkedHardware(value),parts=['fixed','moving','pin'].map(id=>{const g=new T.Group();g.name=hingeFamilies[h.family]+' · '+id;g.userData.hingePart={id,family:h.family,role:id==='moving'?'driven':'fixed',key:JSON.stringify([h.family,h.size]),axis:[0,0,1]};return g;});
 const [fixed,moving,pin]=parts,s=h.size;
 const box=(p,size,at,color)=>{const m=new T.Mesh(new T.BoxGeometry(...size.map(x=>x*s)),new T.MeshStandardMaterial({color,metalness:.65,roughness:.32}));m.position.set(...at.map(x=>x*s));m.castShadow=m.receiveShadow=true;p.add(m);};
 const ring=(p,r,depth,z,color,inner=.065)=>{const shape=new T.Shape();shape.absarc(0,0,r*s,0,Math.PI*2,false);if(inner){const hole=new T.Path();hole.absarc(0,0,inner*s,0,Math.PI*2,true);shape.holes.push(hole);}const g=new T.ExtrudeGeometry(shape,{depth:depth*s,bevelEnabled:false,curveSegments:32});g.translate(0,0,(z-depth/2)*s);const m=new T.Mesh(g,new T.MeshStandardMaterial({color,metalness:.7,roughness:.28}));m.castShadow=m.receiveShadow=true;p.add(m);};
 if(h.family==='clevis'){
  for(const z of [-.22,.22]){ring(fixed,.19,.12,z,0x7595a0);box(fixed,[.42,.32,.12],[-.29,0,z],0x7595a0);}
  box(fixed,[.12,.32,.56],[-.55,0,0],0x7595a0);ring(moving,.17,.28,0,0xc69e60);box(moving,[.5,.22,.28],[.35,0,0],0xc69e60);
 }else if(h.family==='knuckle'){
  for(let k=0;k<5;k++){const p=k%2?moving:fixed,z=(k-2)*.14;ring(p,.14,.132,z,k%2?0xc69e60:0x7595a0);box(p,[.2,.16,.132],[k%2?.16:-.16,0,z],k%2?0xc69e60:0x7595a0);}
  box(fixed,[.42,.08,.7],[-.4,.04,0],0x7595a0);box(moving,[.42,.08,.7],[.4,.04,0],0xc69e60);
 }else{
  ring(fixed,.38,.12,-.16,0x7595a0);ring(fixed,.14,.15,-.025,0x7595a0);ring(moving,.3,.12,.14,0xc69e60);box(moving,[.52,.2,.12],[.46,0,.14],0xc69e60);
  for(let k=0;k<4;k++){const b=new T.Group();b.position.set(.29*s*Math.cos(k*Math.PI/2),.29*s*Math.sin(k*Math.PI/2),0);fixed.add(b);ring(b,.035,.03,-.235,0xdce2e5,0);}
 }
 const length=h.family==='knuckle'?.8:h.family==='clevis'?.72:.5;ring(pin,.06,length,0,0xdce2e5,0);ring(pin,.095,.045,-length/2,0xdce2e5,0);
 for(const [i,id]of ['fixed','moving','pin'].entries())if(h.parts?.[id]){const original=parts[i],replacement=new T.Group();replacement.add(new T.ObjectLoader().parse(h.parts[id]));replacement.name=original.name;replacement.userData.hingePart=original.userData.hingePart;disposePart(original);parts[i]=replacement;}
 return parts;
}
export function exportHinge(value){const h=checkedHardware(value),parts=buildHingeParts({...h,parts:undefined});try{return {schema:'kaminos.hinge-parts.v1',hardware:{family:h.family,size:h.size},key:JSON.stringify([h.family,h.size]),joint:{origin:[0,0,0],axis:[0,0,1]},parts:parts.map(p=>({id:p.userData.hingePart.id,role:p.userData.hingePart.role,object:p.toJSON(),frame:{position:[0,0,0],rotation:[0,0,0]},bore:{axis:[0,0,1],radius:.065*h.size}}))};}finally{parts.forEach(disposePart);}}
export function importHinge(value,packet){const h=checkedHardware(value);if(packet?.schema!=='kaminos.hinge-parts.v1'||packet.key!==JSON.stringify([h.family,h.size]))throw Error('Return belongs to different hinge dimensions or family');if(!Array.isArray(packet.parts)||packet.parts.length!==3||new Set(packet.parts.map(p=>p.id)).size!==3)throw Error('Return all three distinct hinge parts');for(const p of packet.parts){const object=new T.ObjectLoader().parse(p.object);let meshes=0;object.traverse(o=>{if(o.isMesh&&o.geometry?.attributes.position?.count)meshes++;});disposePart(object);if(!meshes)throw Error('Returned part is empty');}return checkedHardware({...h,appearanceId:T.MathUtils.generateUUID(),parts:Object.fromEntries(packet.parts.map(p=>[p.id,p.object]))});}
