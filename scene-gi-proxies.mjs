// GI proxy handles for TRELLIS-derived scene objects. Each handle points at a stored low tier of the object's
// hero mesh (prepared at Generate time and served by /api/mesh-lods). The tier is loaded outside the frame loop,
// checked against its sha, and kept out of the scene graph: bounds, framing, save, wireframe and poly edit never
// see it. The handle also gives the placement that puts the proxy exactly where the object draws. A surfel asset
// reaches its hero's tiers through the generation record's meshSha256, and its handle also points at its own
// coarse surfel levels. Which representation a pass uses, and when, is the GI renderer's decision; this module
// only resolves, loads and places.
const GENERATED='generated-meshes';
export const DEFAULT_GI_PROXY_SELECTION=Object.freeze({faces:1000});

const shaOf=source=>{
  if(typeof source!=='string')return null;
  try{const u=new URL(source,'http://kaminos.local');if(u.pathname!=='/api/read'||u.searchParams.get('root')!==GENERATED)return null;
    const m=/^([a-f0-9]{64})\.glb$/.exec(u.searchParams.get('path')??'');return m?m[1]:null;}catch{return null;}
};
const surfelRootIn=root=>{let found=null;root.traverse(o=>{if(!found&&o.isTrellisSurfelRoot)found=o;});return found;};
const digestHex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const disposeTree=root=>root?.traverse(m=>{if(m.isMesh){m.geometry?.dispose();for(const a of Array.isArray(m.material)?m.material:[m.material])a?.dispose?.();}});

export function createGiProxyRegistry({THREE,fetchJson=async url=>{const r=await fetch(url);const j=await r.json();if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);return j;},
  fetchBytes=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.arrayBuffer();},parseGlb,digest=digestHex}){
  const handles=new Map(),versions=new Map();
  function describe(root){
    const object=root.userData?.kaminosSceneObject,assetSha=shaOf(object?.source),surfels=surfelRootIn(root);
    if(!assetSha)return {state:'not-generated',reason:'not a stored generated mesh'};
    if(surfels){
      const levels=surfels.surfelOptions?.levels??[1];
      const heroSha=object.generation?.meshSha256??null;
      return {representation:'surfels',assetSha,heroSha,surfels:{root:surfels,levels:[...levels],coarsest:Math.max(...levels)},
        ...(heroSha?{}:{state:'no-tiers',reason:'a surfels-only asset has no hero mesh to take tiers from'})};
    }
    return {representation:'mesh',assetSha,heroSha:assetSha};
  }
  async function resolve(root,selection){
    const version=(versions.get(root)??0)+1;versions.set(root,version);
    const base={...describe(root),requested:{...selection},effective:null,levels:[],error:null,frame:'trellis-source',proxyRoot:null,
      placement:scene=>new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(root.updateWorldMatrix(true,false)??root.matrixWorld)};
    const settle=handle=>{
      if(versions.get(root)!==version){disposeTree(handle.proxyRoot);return {...handle,proxyRoot:null,superseded:true};}
      const previous=handles.get(root);if(previous&&previous!==handle&&previous.proxyRoot!==handle.proxyRoot)disposeTree(previous.proxyRoot);
      handles.set(root,handle);return handle;};
    if(base.state)return settle(base);
    handles.set(root,{...base,state:'resolving'});
    try{
      const query=new URLSearchParams({source:base.heroSha});
      if(selection.faces!=null)query.set('faces',String(selection.faces));
      if(selection.maxError!=null){query.set('maxError',String(selection.maxError));query.set('stat',selection.stat??'p95');}
      const set=await fetchJson(`/api/mesh-lods?${query}`);
      const levels=(set.levels??[]).map(l=>({sha:l.sha256,faces:l.faces,closed:l.closed??null}));
      if(!set.choice)return settle({...base,levels,state:'no-tiers',reason:'no stored tiers for this hero'});
      const choice=set.choice,bytes=await fetchBytes(choice.source);
      if(await digest(bytes)!==choice.sha256)throw Error('GI proxy content does not match its sha');
      const proxyRoot=await parseGlb(bytes);proxyRoot.matrixAutoUpdate=false;proxyRoot.updateMatrix?.();
      return settle({...base,levels,state:'loaded',proxyRoot,
        effective:{sha:choice.sha256,faces:choice.faces,withinBudget:set.withinBudget??null},
        error:choice.error?{reference:choice.error.reference,units:'fraction of the hero bounding-box diagonal',relative:choice.error.relative}:null});
    }catch(error){return settle({...base,state:'failed',failure:String(error?.message||error)});}
  }
  return {
    attach(root,selection=DEFAULT_GI_PROXY_SELECTION){return resolve(root,selection);},
    select(root,selection){return resolve(root,selection);},
    get:root=>handles.get(root)??null,
    list:()=>[...handles.entries()].map(([root,h])=>({root,...h})),
    release(root){versions.set(root,(versions.get(root)??0)+1);disposeTree(handles.get(root)?.proxyRoot);handles.delete(root);versions.delete(root);},
  };
}
