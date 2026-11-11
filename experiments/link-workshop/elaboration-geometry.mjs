import * as T from '../../lib/three.core.js';
import {constructBodies,bodyLayout} from './bodies.mjs';
import {disposeGeometry} from './surface.mjs';
const mat=(color,metalness=.7)=>new T.MeshStandardMaterial({color,metalness,roughness:.38});
function box(g,size,p,material,name){const o=new T.Mesh(new T.BoxGeometry(...size),material);o.name=name;o.position.fromArray(p);o.castShadow=o.receiveShadow=true;g.add(o);return o;}
function pin(g,r,length,p,material,name){const geo=new T.CylinderGeometry(r,r,length,20);geo.rotateX(Math.PI/2);const o=new T.Mesh(geo,material);o.name=name;o.position.fromArray(p);o.castShadow=o.receiveShadow=true;g.add(o);return o;}
export function elaborationGeometry(recipe,source=null,{fixture=false}={}){
 const built=constructBodies(recipe),layout=bodyLayout(recipe),prior=new Map(source?.bodies?.map(x=>[x.id,x])??[]),objects=new Map(),loader=new T.ObjectLoader(),iron=mat(0x334f61),brass=mat(0xc49e62),refractory=mat(0xd8cbb5,0);
 try{
  for(const d of built.defs){const old=prior.get(d.id),isBody=/^(anchor|link):/.test(d.id);let g=old&&(old.geometryKey===d.geometryKey||isBody)?loader.parse(old.object):d.object;
   for(const child of [...g.children])if(child.userData.elaborationSupport){g.remove(child);disposeGeometry(child);}
   if(fixture&&d.id==='link:1'){box(g,[recipe.nodes[1].length,.12,.65],[recipe.nodes[1].length/2,.11,-.17],iron,'Opening panel skin');box(g,[recipe.nodes[1].length-.12,.035,.53],[recipe.nodes[1].length/2,.03,-.17],refractory,'Panel lining');}
   if(fixture&&d.id==='anchor:0'){box(g,[.16,2.1,.22],[-1.3,-.7,-.15],iron,'Fixed frame');box(g,[1.45,.14,.22],[-.65,0,-.15],iron,'Hinge crossmember');box(g,[1.8,.14,1.1],[-.65,-1.65,-.15],iron,'Workbench foot');pin(g,.09,.8,[0,0,0],brass,'Main hinge axle');}
   g.name=recipe.nodes[+d.id.split(':')[1]]?.label??g.name;objects.set(d.id,g);
  }
  for(const [i,p] of recipe.pistons.entries())for(const end of ['a','b']){const id=p[end],n=recipe.nodes[id],g=objects.get(`${n.parent===null?'anchor':'link'}:${id}`),at=p[end+'Offset']??[n.parent===null?0:n.length,0],z=layout.pistonLayers[i]-layout.layers[id],sx=n.parent===null?0:Math.max(0,Math.min(n.length,at[0]));
   const brace=box(g,[Math.hypot(at[0]-sx,at[1])+.12,.11,.11],[(at[0]+sx)/2,at[1]/2,0],brass,'Mount support');brace.rotation.z=Math.atan2(at[1],at[0]-sx);brace.userData.elaborationSupport=true;
   const axial=pin(g,.055,Math.abs(z)+.18,[...at,z/2],brass,'Axial mounting pin');axial.userData.elaborationSupport=true;
   const eye=pin(g,.12,.10,[...at,z],brass,'Actuator seat');eye.userData.elaborationSupport=true;
  }
  return {schema:'kaminos.assembly-geometry.v1',bodies:built.defs.map(d=>{const object=objects.get(d.id);object.updateMatrixWorld(true);return {id:d.id,geometryKey:d.geometryKey,object:object.toJSON()};})};
 }finally{const roots=new Set([...built.defs.map(d=>d.object),...objects.values()]);for(const g of roots)disposeGeometry(g);}
}
