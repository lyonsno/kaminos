import {flameSourceInputs} from './scene-fire-domain.mjs';
import {Euler,Matrix4,Quaternion,Vector3} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';

export const BURNER_RECIPE_SCHEMA='kaminos.burner-recipe.v1';
export function defaultBurnerRecipe(designId,sourceSettings={}) {
 return checkedBurnerRecipe({schema:BURNER_RECIPE_SCHEMA,designId,on:true,opening:1,feed:.18,fuel:.7,heat:2,aim:0,sourceSettings});
}
export function checkedBurnerRecipe(value) {
 if(value?.schema!==BURNER_RECIPE_SCHEMA||!['crown-ring','seam-rail'].includes(value.designId))throw Error('Unsupported burner recipe');
 const r=structuredClone(value);
 if(typeof r.on!=='boolean')throw Error('Burner on/off must be Boolean');
 for(const [key,lo,hi] of [['opening',0,1],['feed',0,1],['fuel',0,1],['heat',0,2],['aim',-80,80]])if(!Number.isFinite(r[key])||r[key]<lo||r[key]>hi)throw Error(`Burner ${key} must be between ${lo} and ${hi}`);
 if(!r.sourceSettings||typeof r.sourceSettings!=='object'||Array.isArray(r.sourceSettings))throw Error('Burner requires source settings');
 flameSourceInputs([{id:'burner-template',type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},emission:{domainId:'flame-field',settings:r.sourceSettings}}]);
 return r;
}
const setting=(id,value)=>({id,type:typeof value==='string'?'select-one':'range',value,rawValue:String(value)});
// Outlet coordinates come from the retained design GLBs, in their original metre frame.
// The body's root pose includes the ordinary GLB arrival normalization.
export function compileBurnerSources(recipe,transform) {
 const r=checkedBurnerRecipe(recipe),pose=checkedPose(transform),s=pose.scale[0];
 if(pose.scale.some(n=>Math.abs(n-s)>1e-10*Math.max(1,Math.abs(s)))||s<0)throw Error('Burners require uniform positive scale');
 const rotation=new Quaternion().setFromEuler(new Euler(...pose.rotation));
 const matrix=new Matrix4().compose(new Vector3(...pose.position),rotation,new Vector3(...pose.scale));
 const count=r.designId==='crown-ring'?12:1;
 return Array.from({length:count},(_,index)=>{
  const a=index*Math.PI*2/count,tilt=r.aim*Math.PI/180;
  const centre=r.designId==='crown-ring'?[Math.sin(a)*.135,.157,Math.cos(a)*.135]:[0,.124,0];
  const direction=r.designId==='crown-ring'?new Vector3(Math.sin(a)*Math.sin(tilt),Math.cos(tilt),Math.cos(a)*Math.sin(tilt)):new Vector3(0,Math.cos(tilt),Math.sin(tilt));
  // A fixed local X along Seam's long lip preserves roll through arbitrary body rotation.
  const outletRotation=r.designId==='seam-rail'?new Quaternion().setFromEuler(new Euler(tilt,0,0)):new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction);
  const q=rotation.clone().multiply(outletRotation),radius=r.designId==='crown-ring'?.006*r.opening:Math.hypot(.29,.009*r.opening);
  const settings=structuredClone(r.sourceSettings);
  for(const [id,value] of Object.entries({'volume-emitter-source-law':'immersed-source','volume-emitter-aperture-pattern':'shape','volume-immersed-radius':radius,'volume-immersed-speed':r.feed,'volume-immersed-fuel':r.fuel,'volume-immersed-temperature':r.heat,'volume-immersed-back-wall':0}))settings[id]=setting(id,value);
  return {index,transform:{position:new Vector3(...centre).applyMatrix4(matrix).toArray(),rotation:new Euler().setFromQuaternion(q).toArray().slice(0,3),scale:[s,s,s]},
   emissionEnabled:r.on&&r.opening>0,
   emission:{domainId:'flame-field',settings,burnerPort:{designId:r.designId,index},...(r.designId==='seam-rail'?{aperture:{kind:'rectangle',halfLength:.29/radius,halfWidth:.009*r.opening/radius}}:{})}};
 });
}
export function burnerBodyFor(scene,id) {
 if(id?.startsWith('@group:')){const group=scene.groups.find(g=>g.id===id.slice(7));return scene.objects.find(e=>e.burner&&group?.objectIds.includes(e.id))??null;}
 const entry=scene.objects.find(e=>e.id===id);if(entry?.burner)return entry;
 if(entry?.emission?.burnerPort){const group=scene.groups.find(g=>g.objectIds.includes(id));return scene.objects.find(e=>e.burner&&group?.objectIds.includes(e.id))??null;}
 return null;
}
// Derived source records remain ordinary scene members. Group membership is the binding,
// so duplication needs no private ID remapper and every source retains normal visibility.
export function synchronizeBurnerSources(scene,{pose,write}) {
 for(const group of scene.groups){
  const bodies=scene.objects.filter(e=>e.burner&&group.objectIds.includes(e.id));if(bodies.length!==1)continue;
  const body=bodies[0],compiled=compileBurnerSources(body.burner,pose(body));
  for(const entry of scene.objects){if(!group.objectIds.includes(entry.id)||!entry.emission?.burnerPort)continue;
   const port=compiled[entry.emission.burnerPort.index];
   if(!port||entry.emission.burnerPort.designId!==body.burner.designId)throw Error('Burner outlet binding differs from its body');
   write(entry,port);
  }
 }
}
