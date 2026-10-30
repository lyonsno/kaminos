import {Mesh,BufferGeometry,BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute,DoubleSide} from './lib/three.core.js';
import {MeshPhysicalNodeMaterial} from './lib/three.webgpu.js';
import {attribute,vec4,vec3,normalView} from './lib/three.tsl.js';

// Exact raw topology and aligned material rows; no remeshing or texture bake.
export function createRawFieldMesh(data,indices,meta){
 if(meta.stride!==12||data.length!==meta.count*12||!data.every(Number.isFinite)||!indices.length||indices.length!==meta.triangles?.count*3||!indices.every(i=>i<meta.count))throw Error('Invalid raw mesh fields');
 const geometry=new BufferGeometry(),buffer=new InterleavedBuffer(data,12);
 for(const [name,size,offset] of [['position',3,0],['normal',3,3],['rawMetallic',1,9],['rawRoughness',1,10],['rawOpacity',1,11]])geometry.setAttribute(name,new InterleavedBufferAttribute(buffer,size,offset));
 const colors=new Float32Array(meta.count*3);
 for(let i=0;i<meta.count;i++)for(let c=0;c<3;c++){const s=Math.max(0,Math.min(1,data[i*12+6+c]));colors[i*3+c]=s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}
 geometry.setAttribute('rawColor',new BufferAttribute(colors,3));geometry.setIndex(new BufferAttribute(indices,1));
 geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const material=new MeshPhysicalNodeMaterial({side:DoubleSide}),root=new Mesh(geometry,material);root.name='Unsimplified TRELLIS triangles';
 let state={mode:'glass',ior:1.45,thickness:.06};
 function apply(){
  const plain=state.mode==='plain';
  material.colorNode=vec4(plain?vec3(.5):attribute('rawColor','vec3'),1);
  material.metalnessNode=plain?null:attribute('rawMetallic','float').clamp(0,1);material.metalness=0;
  material.roughnessNode=plain?null:attribute('rawRoughness','float').clamp(0,1);material.roughness=.8;
  const alpha=attribute('rawOpacity','float').clamp(0,1);
  material.transmission=state.mode==='glass'?1:0;material.transmissionNode=material.transmission?alpha.oneMinus():null;
  material.alphaHash=state.mode==='opacity';material.opacityNode=material.alphaHash?alpha:null;
  // Keep the standard output path so the Workbench MRT attachments are written.
  material.lights=state.mode!=='normals';
  if(!material.lights)material.colorNode=vec4(normalView.mul(.5).add(.5),1);
  material.ior=state.ior;material.thickness=state.thickness;material.needsUpdate=true;
 }
 apply();return {root,read:()=>({...state,route:'unsimplified-raw-triangles',vertices:meta.count,triangles:indices.length/3}),set(patch){
  const next={...state,...patch};if(!['glass','opaque','opacity','plain','normals'].includes(next.mode)||!Number.isFinite(next.ior)||next.ior<1||next.ior>2.5||!Number.isFinite(next.thickness)||next.thickness<0||next.thickness>1)throw Error('Invalid raw mesh view');
  state=next;apply();return this.read();
 },dispose(){geometry.dispose();material.dispose();}};
}
