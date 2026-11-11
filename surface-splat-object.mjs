import {Group,Mesh} from './lib/three.core.js';
import {createDeferredSurfaceSplats,checkedSurfaceSplatOptics} from './deferred-surface-splats.mjs';
export const SURFACE_SPLAT_EXTENSION='KAMINOS_surface_splats';
export {isSurfaceSplatResolve} from './surface-splat-support.mjs';

class SurfaceSplatObject extends Group{
 constructor(){super();this.isSurfaceSplatObject=true;this.splats=null;}
 mount(source,payload,state){
  state=checkedSurfaceSplatOptics(state);
  source.traverse(mesh=>{if(mesh.isMesh&&(mesh.isInstancedMesh||mesh.isSkinnedMesh||mesh.morphTargetInfluences?.some(Boolean)))throw Error('Surface splat proxy requires rigid triangles');});
  this.splats=createDeferredSurfaceSplats(payload.data,payload.meta,payload.footprints,payload.depthTolerance);
  if(state)this.splats.set(state);
  this.sourceProxy=source;this.payload=payload;this.proxy=source.clone(true);this.proxyMaterials=[];
  this.proxy.traverse(mesh=>{if(!mesh.isMesh)return;
   const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material],hidden=originals.map(m=>{const copy=m.clone();copy.visible=false;return copy;});
   this.proxyMaterials.push({mesh,original:mesh.material,hidden});mesh.material=Array.isArray(mesh.material)?hidden:hidden[0];
   mesh.raycast=()=>{};
  });
  this.splats.root.userData.kaminosBeautyLodProxy=true;
  this.splats.root.userData.kaminosSurfaceSplatResolve=true;
  this.splats.root.traverse(mesh=>{if(mesh.isMesh)mesh.raycast=()=>{};});
  this.userData.raycastsAsWhole=true;this.add(this.proxy,this.splats.root);return this;
 }
 copy(source,recursive=true){
  super.copy(source,false);this.mount(source.sourceProxy,source.payload,source.splats.read());
  this.proxy.traverse(node=>{if(node.geometry)node.geometry=node.geometry.clone();});
  // Loader/editor shadow flags are applied to the mounted proxy, after the
  // detached template was read. Carry those effective flags into each copy.
  const originals=[];source.proxy.traverse(n=>{if(n.isMesh)originals.push(n);});let index=0;
  this.proxy.traverse(n=>{if(n.isMesh){const original=originals[index++];n.castShadow=original.castShadow;n.receiveShadow=original.receiveShadow;}});
  if(recursive)for(const child of source.children)if(child!==source.proxy&&child!==source.splats.root)this.add(child.clone());return this;
 }
 raycast(raycaster,hits){
  this.proxy?.traverse(mesh=>{if(!mesh.isMesh)return;for(let p=mesh;p;p=p.parent)if(!p.visible)return;
   const local=[];Mesh.prototype.raycast.call(mesh,raycaster,local);for(const hit of local)hits.push({...hit,object:this});
  });
 }
 dispose(){
  if(!this.splats)return;
  this.remove(this.splats.root);this.splats.dispose();this.splats=null;
  for(const {mesh,original,hidden}of this.proxyMaterials){mesh.material=original;for(const m of hidden)m.dispose();}
 }
}
export function createSurfaceSplatObject(proxy,payload,state){return new SurfaceSplatObject().mount(proxy,payload,state);}

// The standard glTF mesh remains a portable geometry fallback and is the
// collision/picking shape. Only this plugin replaces its beauty rendering.
export function surfaceSplatsGLTFPlugin(parser){return {
 name:SURFACE_SPLAT_EXTENSION,
 afterRoot(gltf){
  // Early hybrid exports used the beauty-LOD helper flag for visible, non-solid
  // body siblings. At import these are authored geometry, not runtime helpers.
  for(const scene of new Set(gltf.scenes??[gltf.scene]))scene.traverse(node=>{
   if(!node.isSurfaceSplatObject)return;
   for(const sibling of node.parent?.children??[])if(sibling!==node&&sibling.userData.kaminosBeautyLodProxy&&!sibling.userData.kaminosSurfaceSplatResolve){
    delete sibling.userData.kaminosBeautyLodProxy;sibling.userData.kaminosNonSolidVisual=true;
   }
  });
 },
 createNodeMesh(index){
  const node=parser.json.nodes[index],ext=node.extensions?.[SURFACE_SPLAT_EXTENSION];if(!ext)return null;
  if(ext.version!==1||!Number.isInteger(node.mesh)||!Number.isSafeInteger(ext.count)||ext.count<1||!Number.isFinite(ext.radius)||!(ext.radius>0))throw Error('Invalid surface splat GLB');
  const views=[ext.data,ext.footprints,...(ext.depthTolerance===undefined?[]:[ext.depthTolerance])];
  if(!views.every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Invalid surface splat buffer views');
  return Promise.all([parser.getDependency('mesh',node.mesh),...views.map(i=>parser.getDependency('bufferView',i))]).then(([proxy,data,footprints,tolerance])=>
   createSurfaceSplatObject(proxy,{data:new Float32Array(data),footprints:new Float32Array(footprints),...(tolerance?{depthTolerance:new Float32Array(tolerance)}:{}),meta:{count:ext.count,sourceCount:ext.sourceCount??ext.count,stride:12,radius:ext.radius,...(ext.adaptive?{adaptive:ext.adaptive}:{})}},ext.optics));
 }
};}
