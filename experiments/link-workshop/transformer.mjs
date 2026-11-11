import * as T from '../../lib/three.core.js';
import {checkedMechanism,frames,pistonMountPoint} from './model.mjs';
import {constructBodies} from './bodies.mjs';
import {captureCounterbalance} from './body-dynamics.mjs';
import {furnaceAssembly} from './furnace.mjs';
import {disposeGeometry} from './surface.mjs';

// An editable apparatus sketch, using the ordinary recipe/body return contract.
// All motion is parallel-axis; the sampled stroke sizing is provisional and
// does not establish swept mesh clearance. Play compares authored A/B poses.
export function transformerKiln(){
 const rad=d=>d*Math.PI/180,recipe={schema:'kaminos.links.v1',period:8,nodes:[],pistons:[],mechanics:{enabled:true,model:'bodies',hydraulicsEnabled:true,settleAfterRelease:true,gravity:[0,-9.81],stepSeconds:1/120,jointDamping:.5}},parts=[],banks=[];
 const addBank=(name,point,lengths,a,b,layer,kind,width)=>{
  const anchor=recipe.nodes.length;recipe.nodes.push({parent:null,point,label:name+' fixed bearing'});const ids=[];
  lengths.forEach((length,i)=>{const id=recipe.nodes.length;recipe.nodes.push({parent:i?ids[i-1]:anchor,length,angles:[rad(a[i]),rad(b[i])],layer,label:`${name} · ${i+1}`,bodyDynamics:{mass:kind==='hatch'?2:kind==='tray'?1.5:.35}});ids.push(id);parts.push({id,kind,width,layer,length});});banks.push({name,anchor,ids,layer});return ids;
 };
 addBank('Crown-folding hatch',[0,3.6],Array(4).fill(.695),[-90,0,0,0],[15,135,30,0],.22,'hatch',2.36);
 addBank('Crucible jaw',[0,.72],[.6,.5,.5,.5],[90,-120,120,-120],[-12,12,0,0],.28,'tray',2.1);
 for(let i=0;i<4;i++)addBank(`Refractory gill ${i+1}`,[-.22-i*.55,3.15],Array(4).fill(.53),[-90,0,0,0],[-205+i*35,15,10,-15],.42+i*.12,'gill',.27);
 for(let i=0;i<4;i++)addBank(`Crown armor ${i+1}`,[-.18-i*.61,3.52],[.63],[180],[108+i*4],.10,'crown',2.55);
 for(let i=0;i<8;i++)addBank(`Rear damper ${i+1}`,[-2.64,1.03+i*.285],[.265],[90],[180],.13,'damper',2.25);
 for(let i=0;i<4;i++)addBank(`Deploying brace ${i+1}`,[i%2?-.35:-2.17,.75],[.75],[i%2?-45:-135],[-90],i<2?.52:-3.12,'brace',.18);
 // One connected island: internal hinge cylinders plus a visible outboard
 // sequence coupling the roots. Common static housing alone would not join it.
 let previous=null;
 for(const bank of banks){for(const [j,id]of bank.ids.entries()){
  const n=recipe.nodes[id],a=j?n.parent:previous??bank.anchor;
  const aOffset=j?[recipe.nodes[a].length-.6,-.3]:previous?[recipe.nodes[a].length*.65,-.15]:[-.4,-.26];
  recipe.pistons.push({a,b:id,aOffset,bOffset:[.08,.12],z:.98,hinge:j>0});
 }previous=bank.ids[0];}
 // Fixed hardware once, from the complete authored-cycle sample set. It stays
 // fixed during subsequent posing; the preset makes no continuous-CCD claim.
 const poses=Array.from({length:161},(_,k)=>frames(recipe,k/160));
 const range=p=>{let min=Infinity,max=0;for(const f of poses){const a=pistonMountPoint(recipe,f,p.a,p.aOffset),b=pistonMountPoint(recipe,f,p.b,p.bOffset),d=Math.hypot(a[0]-b[0],a[1]-b[1]);min=Math.min(min,d);max=Math.max(max,d);}return {min,max};};
 recipe.pistons.forEach((p,i)=>{
  let sizes=range(p);
  if(sizes.min<.04||sizes.max+.035>sizes.min*1.72){
   const original=[...p.aOffset],options=[[0,-.6],[0,.6],[-.6,0],[.6,0],[0,-1],[0,1],[-1,0],[1,0]];
   const candidates=options.map(d=>{const offset=original.map((x,k)=>x+d[k]),r=range({...p,aOffset:offset});return {offset,...r};}).filter(r=>r.min>.04&&r.max+.035<=r.min*1.72).sort((a,b)=>Math.hypot(...a.offset)-Math.hypot(...b.offset));
   if(!candidates.length)throw Error(`Sketch cylinder ${i+1} needs a different mount arrangement`);p.aOffset=candidates[0].offset;sizes=candidates[0];
  }
  const {min,max}=sizes,barrel=min*.72,rod=Math.max(min*.72,max-barrel+.035);p.mechanics={mode:'free',barrelLength:barrel,rodLength:rod,minLength:Math.max(barrel,rod),maxLength:barrel+rod,restLength:max,stiffness:0,damping:2,stopStiffness:1e6};
 });
 let m=checkedMechanism(recipe);m=captureCounterbalance(m,{fraction:1,period:1.35,dampingRatio:.18});
 const {defs}=constructBodies(m),map=new Map(defs.map(d=>[d.id,d]));
 const iron=new T.MeshStandardMaterial({color:0x344650,metalness:.68,roughness:.4}),bronze=new T.MeshStandardMaterial({color:0xb99b65,metalness:.72,roughness:.32}),lining=new T.MeshStandardMaterial({color:0xd9c9a8,roughness:.8}),dark=new T.MeshStandardMaterial({color:0x1c2b33,metalness:.7,roughness:.38});
 const box=(g,size,pos,mat,name)=>{const o=new T.Mesh(new T.BoxGeometry(...size),mat);o.name=name;o.position.set(...pos);o.castShadow=o.receiveShadow=true;g.add(o);return o;};
 const pin=(g,r,length,pos,mat,name)=>{const geo=new T.CylinderGeometry(r,r,length,16);geo.rotateX(Math.PI/2);const o=new T.Mesh(geo,mat);o.name=name;o.position.set(...pos);o.castShadow=o.receiveShadow=true;g.add(o);return o;};
 const replace=id=>{const g=map.get(id).object;disposeGeometry(g);g.clear();return g;};
 const house=replace('anchor:0'),original=furnaceAssembly().geometry.bodies.find(b=>b.id==='anchor:0'),shell=new T.ObjectLoader().parse(original.object);house.add(...[...shell.children]);house.name='Kiln housing · retained chamber';
 for(const bank of banks.slice(1)){const g=replace(`anchor:${bank.anchor}`);g.name=bank.name+' fixed bearing';const z=bank.layer;box(g,[.18,.20,.18],[0,0,z],iron,'Bearing pedestal');pin(g,.105,.28,[0,0,z],bronze,'Fixed bearing');}
 for(const part of parts){const g=map.get(`link:${part.id}`).object;g.name=m.nodes[part.id].label;
  // Retain the constructed rigid rail/horns; add the body-local authored skin.
  const {length:L,kind,width:w,layer}=part,z=kind==='brace'?0:-1.3-layer;
  if(['hatch','tray','crown'].includes(kind)){
   box(g,[L-.025,.14,w],[L/2,.14,z],iron,kind==='tray'?'Jaw tray shell':'Armor plate');
   box(g,[L-.08,.055,w-.12],[L/2,.035,z],lining,'Refractory face');
   for(const edge of [-w/2+.07,w/2-.07])box(g,[L-.04,.065,.07],[L/2,.25,z+edge],bronze,'Armor spine');
   pin(g,.065,w+.12,[0,0,z],bronze,'Panel hinge axle');
  }else if(kind==='gill'){
   for(const face of [.08,-2.92-layer]){box(g,[L-.03,.12,w],[L/2,.12,face],iron,'Segmented gill shell');box(g,[L-.08,.05,w-.05],[L/2,.02,face],lining,'Gill refractory');}
  }else if(kind==='damper')box(g,[L-.02,.065,w],[L/2,.10,z],dark,'Rear draft leaf');
  else{box(g,[L,.16,.16],[L/2,0,0],iron,'Brace leg');box(g,[.09,.42,.30],[L,0,0],bronze,'Ground shoe');}
 }
 // Explicit mount pins connect each outboard cylinder eye back to its body.
 for(const p of m.pistons)for(const end of ['a','b']){const id=p[end],n=m.nodes[id],g=map.get(`${n.parent===null?'anchor':'link'}:${id}`).object,base=n.parent===null?0:n.layer,at=p[end+'Offset'],far=p.z-base;const seatX=n.parent===null?0:Math.max(0,Math.min(n.length,at[0])),delta=new T.Vector3(at[0]-seatX,at[1],0),beam=box(g,[delta.length()+.12,.10,.11],[(seatX+at[0])/2,at[1]/2,0],bronze,'Seat support');beam.rotation.z=Math.atan2(delta.y,delta.x);pin(g,.045,Math.abs(far)+.13,[...at,far/2],bronze,'Cylinder stand-off pin');box(g,[.16,.20,.10],[...at,0],bronze,'Cylinder seat');}
 const geometry={schema:'kaminos.assembly-geometry.v1',bodies:defs.map(d=>({id:d.id,geometryKey:d.geometryKey,object:d.object.toJSON()}))};defs.forEach(d=>disposeGeometry(d.object));
 return {recipe:m,geometry,groups:banks.map(b=>({label:b.name,joints:b.ids})),provenance:{kind:'provisional scripted apparatus',movingBodies:parts.length,cylinders:m.pistons.length,strokeSizing:'161 authored-cycle samples; swept mesh clearance unverified',motion:'parallel-axis planar bodies; authored A/B Play, coupled mechanical G'}};
}
