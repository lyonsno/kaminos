import {Group,InstancedMesh,CircleGeometry,InstancedBufferAttribute,Matrix4,Quaternion,Vector3,DoubleSide} from './lib/three.core.js';
import {MeshPhysicalNodeMaterial} from './lib/three.webgpu.js';
import {attribute,vec4} from './lib/three.tsl.js';
import {createSurfelSurface} from './surfel-surface-reconstruction.mjs';

export function createSurfelGlass(data,meta){
 if(meta.stride!==12||!Number.isInteger(meta.count)||meta.count<1||data.length!==meta.count*12||!data.every(Number.isFinite)||!(meta.radius>0))throw Error('Invalid surfel field payload');
 const root=new Group();root.name='Raw TRELLIS bottle surfels';
 const populations=[[],[]];for(let i=0;i<meta.count;i++)populations[data[i*12+11]<.98?1:0].push(i);
 const materials=[];let state={mode:'glass',ior:1.45,thickness:.06,reconstruction:true};
 for(let p=0;p<2;p++){
  const ids=populations[p];if(!ids.length)continue;
  const geometry=new CircleGeometry(meta.radius,8),material=new MeshPhysicalNodeMaterial({side:DoubleSide});
  const rgb=new Float32Array(ids.length*3),alpha=new Float32Array(ids.length),metal=new Float32Array(ids.length),rough=new Float32Array(ids.length);
  const mesh=new InstancedMesh(geometry,material,ids.length),matrix=new Matrix4(),rotation=new Quaternion(),normal=new Vector3(),position=new Vector3(),z=new Vector3(0,0,1),one=new Vector3(1,1,1);
  ids.forEach((id,j)=>{
   const k=id*12;position.fromArray(data,k);normal.fromArray(data,k+3);
   if(normal.lengthSq()<1e-12)throw Error('Invalid surfel normal');
   rotation.setFromUnitVectors(z,normal.normalize());matrix.compose(position,rotation,one);mesh.setMatrixAt(j,matrix);
   for(let c=0;c<3;c++){const s=Math.min(1,Math.max(0,data[k+6+c]));rgb[j*3+c]=s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}
   alpha[j]=Math.min(1,Math.max(0,data[k+11]));metal[j]=Math.min(1,Math.max(0,data[k+9]));rough[j]=Math.min(1,Math.max(0,data[k+10]));
  });
  geometry.setAttribute('surfelColor',new InstancedBufferAttribute(rgb,3));
  for(const [name,array] of [['surfelOpacity',alpha],['surfelMetallic',metal],['surfelRoughness',rough]])geometry.setAttribute(name,new InstancedBufferAttribute(array,1));
  material.colorNode=vec4(attribute('surfelColor','vec3'),1);
  material.metalnessNode=attribute('surfelMetallic','float');material.roughnessNode=attribute('surfelRoughness','float');
  mesh.userData.transmissive=p===1;mesh.userData.sourceRows=ids;
  mesh.computeBoundingBox();mesh.computeBoundingSphere();root.add(mesh);materials.push({material,transmissive:p===1});
 }
 const surface=createSurfelSurface(root.children,meta.radius);
 let footprint=1;
 for(const mesh of root.children)mesh.onBeforeRender=(...args)=>{if(state.reconstruction)surface.prepare(...args);};
 function apply(){
  const nextFootprint=state.reconstruction?1.5:1;
  if(nextFootprint!==footprint){for(const mesh of root.children){mesh.geometry.scale(nextFootprint/footprint,nextFootprint/footprint,1);mesh.computeBoundingBox();mesh.computeBoundingSphere();}footprint=nextFootprint;surface.invalidate();}
  for(const {material,transmissive} of materials){
  material.colorNode=state.reconstruction?surface.color:vec4(attribute('surfelColor','vec3'),1);
  material.normalNode=state.reconstruction?surface.normal:null;
  material.metalnessNode=state.reconstruction?surface.metallic:attribute('surfelMetallic','float');
  material.roughnessNode=state.reconstruction?surface.roughness:attribute('surfelRoughness','float');
  const opacity=state.reconstruction?surface.opacity:attribute('surfelOpacity','float');
  material.transmission=state.mode==='glass'&&transmissive?1:0;
  material.transmissionNode=material.transmission?opacity.oneMinus():null;
  material.opacityNode=state.mode==='opacity'?opacity:null;
  material.alphaHash=state.mode==='opacity';material.ior=state.ior;material.thickness=state.thickness;material.needsUpdate=true;
 }}apply();
 return {root,inspectSurface:(x,y)=>surface.inspect(x,y),read:()=>({...state,count:meta.count,route:'oriented-raw-field-surfels',radius:meta.radius,footprintScale:footprint,surface:surface.read()}),set(patch){
  const next={...state,...patch};if(!['glass','opaque','opacity'].includes(next.mode)||!Number.isFinite(next.ior)||next.ior<1||next.ior>2.5||!Number.isFinite(next.thickness)||next.thickness<0||next.thickness>1)throw Error('Invalid surfel optics');
  if(typeof next.reconstruction!=='boolean')throw Error('Invalid surface reconstruction');
  state=next;apply();return this.read();
 },dispose(){surface.dispose();for(const mesh of root.children){mesh.geometry.dispose();mesh.material.dispose();}}};
}
