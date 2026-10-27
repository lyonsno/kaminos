import * as THREE from '../../lib/three.core.js';
import {createPosedSkeleton} from './posed-skeleton.experiment.mjs';

export async function createConcavityStudy({host,inputs,record}){
 const response=await fetch(inputs.diagnostic,{cache:'no-store'});if(!response.ok)throw Error('Concavity diagnostic HTTP '+response.status);
 const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==inputs.diagnostic_sha256)throw Error('Concavity diagnostic digest mismatch');
 const values=new Float32Array(bytes);if(values.length%6||!values.every(Number.isFinite))throw Error('Invalid concavity diagnostic fields');
 let skin,mode='surface',refresh=()=>{};
 const originalOpen=host.scene.open.bind(host.scene);
 const scene={...host.scene,async open(){const session=await originalOpen(),attach=session.attach.bind(session);return {...session,async attach(root,options){root.traverse(o=>{if(o.isMesh&&o.userData.kaminosDynamicGeometry)skin=o;});return attach(root,options);}};}};
 const posed=await createPosedSkeleton({host:{...host,scene},inputs,record});
 if(!skin||skin.geometry.attributes.position.count!==values.length/6){await posed.dispose();throw Error('Diagnostic vertex identity differs from live skin');}
 const modes=['surface','originalForelimbShare','concavity','transferredToChest'];
 const overlay=({field='surface'}={})=>{
  if(!modes.includes(field))throw Error('Unknown diagnostic field');mode=field;
  if(field==='surface'){skin.material.vertexColors=false;skin.material.color.set(0xd6b17c);}else{
   const colors=new Float32Array(values.length/2),index={concavity:0,originalForelimbShare:1,transferredToChest:3}[field];
   for(let v=0;v<values.length/6;v++){const raw=values[v*6+index],t=field==='concavity'?raw/(1+raw):Math.max(0,Math.min(1,raw));new THREE.Color().setRGB(.12+.88*t,.22+.28*t,.72-.65*t).toArray(colors,v*3);}
   skin.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));skin.material.vertexColors=true;skin.material.color.set(0xffffff);
  }
  skin.material.needsUpdate=true;host.scene.redraw?.();refresh();return {field:mode,diagnosticSha256:digest,vertices:values.length/6};
 };
 if(inputs.view_field)overlay({field:inputs.view_field});
 return {...posed,read:()=>({...posed.read(),diagnostic:{field:mode,sha256:digest,vertices:values.length/6}}),operations:{...posed.operations,diagnostic:overlay},mount(args){posed.mount(args);const d=args.document,legend=d.createElement('p');legend.textContent='Rest-surface diagnostic · blue low, orange high. Concavity is inferred from smoothed rest normals; it is not an authored boundary.';args.root.append(legend);const buttons=[];
  for(const [field,label] of [['surface','Surface'],['originalForelimbShare','Original limb influence'],['concavity','Rest concavity'],['transferredToChest','Transfer to chest']]){const b=d.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>args.invoke('diagnostic',{field});args.root.append(b);buttons.push([b,field]);}
  refresh=()=>{for(const [b,f]of buttons)b.setAttribute('aria-pressed',String(f===mode));};refresh();},dispose:posed.dispose};
}
export default {id:'accb/shoulder-concavity',title:'Creature · shoulder attachment study',create:createConcavityStudy};
