import {Mesh, FrontSide} from './lib/three.core.js';
import {MeshStandardNodeMaterial, MeshPhysicalNodeMaterial} from './lib/three.webgpu.js';
import {texture, vec4, normalView} from './lib/three.tsl.js';

// An explicit material interpretation, not additional TRELLIS predictions.
// Screen-space refraction sees opaque scene surfaces, not other glass layers.
function settings(value) {
  if(!['opaque','opacity','glass','plain','normals'].includes(value.mode))throw Error('Unknown glass view');
  for(const [key,min,max] of [['ior',1,2.5],['thickness',0,1]]) {
    if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw Error(`Invalid ${key}`);
  }
  return value;
}
function copySurface(source,target) {
  for(const name of ['map','normalMap','roughnessMap','metalnessMap','roughness','metalness','side']) target[name]=source[name];
  target.color.copy(source.color);target.normalScale.copy(source.normalScale);
  target.emissive.copy(source.emissive);target.emissiveMap=source.emissiveMap;
  target.emissiveIntensity=source.emissiveIntensity;
  return target;
}
export function createGeneratedGlass(root, initial={}) {
  let state=settings({mode:'glass',ior:1.45,thickness:.06,...initial}), disposed=false;
  const meshes=[];
  root.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  if(!meshes.length||meshes.some(m=>Array.isArray(m.material)||!m.material?.map||!m.material.isMeshStandardMaterial)) {
    throw Error('Glass study requires single PBR materials with a base-color texture');
  }
  const entries=meshes.map(mesh=>{
    const source=mesh.material;
    const rgba=texture(source.map),alpha=rgba.a.clamp(0,1);
    const solid=copySurface(source,new MeshStandardNodeMaterial());
    const plain=new MeshStandardNodeMaterial({color:0xbcbcbc,roughness:.8,side:source.side});
    const normals=new MeshStandardNodeMaterial({side:source.side});normals.lights=false;normals.colorNode=vec4(normalView.mul(.5).add(.5),1);
    solid.maskNode=alpha.greaterThanEqual(.98);
    const hashed=copySurface(source,new MeshStandardNodeMaterial());
    hashed.alphaHash=true;hashed.transparent=false;hashed.depthWrite=true;
    const glass=copySurface(source,new MeshPhysicalNodeMaterial());
    glass.maskNode=alpha.lessThan(.98);
    // Source RGB remains the tint; opacity is consumed once, as transmission.
    glass.colorNode=vec4(rgba.rgb.mul(source.color),1);
    glass.transmissionNode=alpha.oneMinus();glass.transmission=1;
    glass.side=FrontSide;glass.transparent=false;glass.depthWrite=true;
    const shell=new Mesh(mesh.geometry,glass);shell.name='Generated glass (authored optics)';
    mesh.add(shell);
    return {mesh,source,solid,hashed,glass,shell,plain,normals};
  });
  function apply(){for(const e of entries){
    e.mesh.material=state.mode==='plain'?e.plain:state.mode==='normals'?e.normals:state.mode==='opaque'?e.source:state.mode==='opacity'?e.hashed:e.solid;
    e.shell.visible=state.mode==='glass';e.glass.ior=state.ior;e.glass.thickness=state.thickness;
  }}
  apply();
  return {
    read:()=>({...state,meshCount:entries.length,route:'screen-space-transmission',opaqueCutoff:.98}),
    set(patch){if(disposed)throw Error('Glass study disposed');state=settings({...state,...patch});apply();return this.read();},
    dispose(){if(disposed)return;disposed=true;for(const e of entries){
      e.mesh.material=e.source;e.mesh.remove(e.shell);e.solid.dispose();e.hashed.dispose();e.glass.dispose();e.plain.dispose();e.normals.dispose();
    }},
  };
}
