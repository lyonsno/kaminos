import * as T from '../../lib/three.core.js';
import {constructBodies} from './bodies.mjs';

// A provisional, scripted carrier for conditioned appearance generation.
// Motion stays in the ordinary workshop recipe; every surface belongs to a body.
export function furnaceAssembly(){
 const recipe={schema:'kaminos.links.v1',nodes:[
  {parent:null,point:[0,3.6]},
  {parent:0,length:.85,angles:[-Math.PI/2,-Math.PI/9]},
  {parent:null,point:[-.7,1.2]},
 ],pistons:[{a:2,b:1}],period:5};
 const {defs}=constructBodies(recipe);
 const names={'anchor:0':'Stationary furnace housing','link:1':'Door and rigid operating lever','pin:0':'Fixed hinge axle','anchor:2':'Fixed cylinder bracket','pin:1':'Door lever pin','pin:2':'Cylinder mounting pin','piston:0:barrel':'Cylinder barrel','piston:0:rod':'Piston rod'};
 const material=(c,metalness=.6)=>new T.MeshStandardMaterial({color:c,metalness,roughness:.42});
 const iron=material(0x3c4750),bronze=material(0xb28a52),lining=material(0xd9c6a1,0),steel=material(0xa7b4bd);
 function box(g,size,at,mat,name){const o=new T.Mesh(new T.BoxGeometry(...size),mat);o.name=name;o.position.set(...at);o.castShadow=o.receiveShadow=true;g.add(o);return o;}
 function axle(g,r,length,at,mat,name,inner=0){
  let geo;if(inner){const s=new T.Shape();s.absarc(0,0,r,0,Math.PI*2,false);const h=new T.Path();h.absarc(0,0,inner,0,Math.PI*2,true);s.holes.push(h);geo=new T.ExtrudeGeometry(s,{depth:length,bevelEnabled:false,curveSegments:24});geo.translate(0,0,-length/2);}else{geo=new T.CylinderGeometry(r,r,length,32);geo.rotateX(Math.PI/2);}
  const o=new T.Mesh(geo,mat);o.name=name;o.position.set(...at);o.castShadow=o.receiveShadow=true;g.add(o);return o;
 }
 const replace=id=>{const d=defs.find(b=>b.id===id);d.object.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});d.object.clear();return d.object;};
 // Housing body origin is the fixed door hinge. It has a real open chamber.
 const house=replace('anchor:0'),world=new T.Group();world.position.y=-3.6;house.add(world);
 box(world,[2.6,.22,2.6],[-1.3,.66,-1.3],iron,'Floor shell');
 box(world,[2.6,.22,2.6],[-1.3,3.38,-1.3],iron,'Roof shell');
 box(world,[.2,2.5,2.6],[-2.5,2.02,-1.3],iron,'Back shell');
 for(const z of [-2.5,-.1]){
  box(world,[2.4,2.5,.2],[-1.2,2.02,z],iron,'Side shell');
  box(world,[2.18,2.35,.12],[-1.15,2.02,z+(z<-1?.16:-.16)],lining,'Refractory side');
  axle(world,.17,.18,[0,3.6,z],bronze,'Fixed hinge bearing',.085);
  box(world,[.28,.35,.2],[-.06,3.38,z],iron,'Bearing pedestal');
 }
 box(world,[.12,2.35,2.1],[-2.34,2.02,-1.3],lining,'Refractory back');
 box(world,[2.18,.12,2.1],[-1.15,.83,-1.3],lining,'Refractory hearth');
 box(world,[2.18,.12,2.1],[-1.15,3.21,-1.3],lining,'Refractory roof');
 for(const x of [-2.2,-.35])for(const z of [-2.22,-.38]){
  box(world,[.24,.55,.24],[x,.275,z],iron,'Foot');
  box(world,[.48,.08,.46],[x,.04,z],iron,'Foot plate');
 }
 // Link local X points from hinge to piston pin. Door shares that rigid frame.
 const door=defs.find(b=>b.id==='link:1').object;
 door.children.forEach(o=>{if(o.material){o.material.dispose();o.material=bronze;}});
 box(door,[2.78,.16,2.36],[1.39,.16,-1.52],iron,'Door shell');
 box(door,[2.48,.06,2.10],[1.40,.05,-1.52],lining,'Door refractory face');
 for(const z of [-2.56,-.48])box(door,[2.6,.07,.09],[1.40,.275,z],bronze,'Door stiffener');
 axle(door,.145,2.15,[0,0,-1.52],bronze,'Moving hinge sleeve',.085);
 box(door,[.24,.22,2.36],[.16,.12,-1.52],iron,'Door hinge attachment');
 const shaft=replace('pin:0');axle(shaft,.075,3.14,[0,0,-1.24],steel,'Hinge axle');
 for(const z of [-2.84,.36])axle(shaft,.12,.06,[0,0,z],bronze,'Axle cap');
 const mount=replace('anchor:2');box(mount,[.52,.34,.62],[0,0,.12],iron,'Cylinder mounting lug');
 for(const d of defs){d.object.name=names[d.id]??d.id;d.object.position.set(0,0,0);d.object.quaternion.identity();d.object.updateMatrixWorld(true);}
 const geometry={schema:'kaminos.assembly-geometry.v1',bodies:defs.map(d=>({id:d.id,geometryKey:d.geometryKey,object:d.object.toJSON()}))};
 // Release temporary geometry after serializing; materials can be shared.
 const gs=new Set(),ms=new Set();for(const d of defs)d.object.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();
 return {recipe,geometry};
}
