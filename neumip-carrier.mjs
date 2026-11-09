import {Mesh,MeshStandardMaterial,PlaneGeometry,SphereGeometry} from './lib/three.webgpu.js';
export const NEUMIP_CARRIER_SOURCE='kaminos:neumip-carrier';
export function checkedNeumipCarrier(value){
 if(!value||!['folded','sphere'].includes(value.surface))throw Error('Choose folded or sphere for the neural carrier');
 return {surface:value.surface};
}
export function createNeumipCarrierGeometry(value){
 const {surface}=checkedNeumipCarrier(value);
 if(surface==='sphere'){const g=new SphereGeometry(1,64,48);g.computeTangents();return g;}
 const g=new PlaneGeometry(2.6,2.6,96,96),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,.18*Math.sin(6*x+1.2*y)+.12*Math.cos(3*y-2*x));}
 g.computeVertexNormals();g.computeTangents();return g;
}
export function createNeumipCarrier(value){
 const mesh=new Mesh(createNeumipCarrierGeometry(value),new MeshStandardMaterial());
 mesh.name='Neural surface';mesh.castShadow=true;mesh.receiveShadow=true;
 return mesh;
}
export const neumipCarrierRecordDomain={type:'pbr',source:NEUMIP_CARRIER_SOURCE,
 check:r=>({...r,neuralCarrier:checkedNeumipCarrier(r.neuralCarrier)}),
 fields:r=>({neuralCarrier:checkedNeumipCarrier(r.neuralCarrier)}),
 capture:entry=>({neuralCarrier:checkedNeumipCarrier(entry.object.userData.kaminosSceneObject.neuralCarrier)}),
 reloadable:r=>{checkedNeumipCarrier(r.neuralCarrier);return true;},
 load:(r,loaders,options)=>loaders.constructed(createNeumipCarrier(r.neuralCarrier),r,options)};
