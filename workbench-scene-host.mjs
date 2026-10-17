import {createOwnerSceneSession} from './owner-scene-session.mjs';

// This clock is driven by the application's existing frame loop. Each new
// subscription starts at zero elapsed time, including a producer's resume.
export function createWorkbenchFrameService({onError=error=>console.error(error)}={}) {
 const listeners=new Set();
 return Object.freeze({
  onFrame(callback){
   if(typeof callback!=='function')throw TypeError('Frame callback must be callable');
   const listener={callback,last:null};listeners.add(listener);
   return ()=>listeners.delete(listener);
  },
  tick(timestampMs){
   if(!Number.isFinite(timestampMs))throw Error('Frame timestamp must be finite milliseconds');
   for(const listener of [...listeners]){
    if(!listeners.has(listener))continue;
    const deltaSeconds=listener.last===null?0:Math.max(0,(timestampMs-listener.last)/1000);
    listener.last=timestampMs;
    try{listener.callback({timestampMs,deltaSeconds});}
    catch(error){listeners.delete(listener);try{onError(error);}catch(reportError){console.error('Scene frame failure reporting failed',reportError);}}
   }
  },
  state:()=>({activeSubscriptions:listeners.size}),
 });
}

function resources(root){
 const geometry=new Set(),material=new Set(),texture=new Set(),skeleton=new Set();
 root.traverse(node=>{
  if(node.geometry)geometry.add(node.geometry);
  if(node.skeleton)skeleton.add(node.skeleton);
  for(const mat of (Array.isArray(node.material)?node.material:[node.material]).filter(Boolean)){
   material.add(mat);
   for(const value of Object.values(mat))if(value?.isTexture)texture.add(value);
   for(const uniform of Object.values(mat.uniforms||{}))if(uniform?.value?.isTexture)texture.add(uniform.value);
  }
 });
 return {geometry,material,texture,skeleton};
}

// Application removal has already detached root. Other registrations, retained
// Undo roots and the scene's environment remain resource consumers.
export function disposeOwnedSceneTree(root,remainingRoots,borrowedTextures=[]) {
 const own=resources(root),retained={geometry:new Set(),material:new Set(),texture:new Set(borrowedTextures.filter(Boolean)),skeleton:new Set()};
 for(const other of remainingRoots){if(!other||other===root)continue;const refs=resources(other);for(const kind of Object.keys(retained))for(const value of refs[kind])retained[kind].add(value);}
 for(const kind of ['skeleton','geometry','material','texture'])for(const value of own[kind])if(!retained[kind].has(value))value.dispose?.();
}

function vector(value,name){
 if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw Error(`Scene view ${name} requires three finite values`);
 return [...value];
}

export function createWorkbenchSceneHost({scene,camera,controls,loadAsset,registerObject,findObject,removeObject,redraw,onFrame}) {
 const readView=()=>({schema:'kaminos.workbench-scene-view.v0',position:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),fov:camera.fov,zoom:camera.zoom,near:camera.near,far:camera.far});
 const setView=view=>{
  const next={...readView(),...view};
  for(const name of ['position','target','up'])next[name]=vector(next[name],name);
  if(Math.hypot(...next.up)===0||next.position.every((x,i)=>x===next.target[i])||!Number.isFinite(next.fov)||next.fov<=0||next.fov>=180||!Number.isFinite(next.zoom)||next.zoom<=0||!Number.isFinite(next.near)||next.near<=0||!Number.isFinite(next.far)||next.far<=next.near)throw Error('Invalid scene view projection or orientation');
  // Clear pending orbit/pan damping before restoring a retained view. Otherwise
  // the next update can move a correctly restored camera using an old gesture.
  const damping=controls.enableDamping;controls.enableDamping=false;
  try{
   controls.update();camera.position.fromArray(next.position);controls.target.fromArray(next.target);camera.up.fromArray(next.up);
   for(const name of ['fov','zoom','near','far'])camera[name]=next[name];
   camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld(true);redraw();
  }finally{controls.enableDamping=damping;}
  return readView();
 };
 return Object.freeze({open:()=>createOwnerSceneSession({
  async loadAsset(input,context){
   const options=typeof input==='string'?{url:input}:input;
   if(!options||typeof options.url!=='string'||!options.url.trim())throw Error('Scene asset requires a URL');
   if(options.metadata?.id!==undefined)throw Error('An owned asset receives a new scene registration; borrow existing roots with attach');
   const arrival=options.arrival!==undefined?options.arrival:options.normalize===true?'append':null;
   const asset=await loadAsset(options.url,{normalize:false,...options,arrival,isCurrent:context.isCurrent});
   return {...asset,owned:true};
  },
  attach(root,options,context){
   if(!root?.isObject3D)throw Error('Scene attachment requires an actual Three object');
   if(!context.isCurrent())throw Error('Scene session is disposed');
   const existing=findObject(root);
   if(!options.owned){if(!existing)throw Error('Borrowed root needs an existing scene registration');return {id:existing.id,root,owned:false,clips:options.clips||[],source:existing.source};}
   if(existing||root.parent)throw Error('Owned attachment cannot acquire an existing registration or parent');
   if(options.metadata?.id!==undefined)throw Error('Owned attachment receives a new scene registration');
   scene.add(root);
   if(options.presentation===true){redraw();return {id:'@presentation:'+root.uuid,root,owned:true,presentation:true,clips:[],source:options.metadata?.source??null};}
   try{const row=registerObject(root,{type:'experiment',...(options.metadata||{})});redraw();return {id:row.id,root,owned:true,clips:options.clips||[],source:row.source};}
   catch(error){scene.remove(root);throw error;}
  },
  remove:handle=>{if(!handle.presentation)return removeObject(handle);handle.root.removeFromParent();disposeOwnedSceneTree(handle.root,[scene],[scene.environment,scene.background]);redraw();},readView,setView,redraw,onFrame,
 })});
}
