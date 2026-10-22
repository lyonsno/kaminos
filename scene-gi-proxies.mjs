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
// Geometry, materials and every texture a material holds (material disposal leaves its textures allocated),
// each disposed once however many meshes or material slots share it.
const disposeTree=root=>{if(!root)return;const seen=new Set(),once=r=>{if(r&&!seen.has(r)){seen.add(r);r.dispose?.();}};
  root.traverse(m=>{if(!m.isMesh)return;once(m.geometry);
    for(const a of Array.isArray(m.material)?m.material:[m.material]){if(!a||seen.has(a))continue;for(const v of Object.values(a))if(v?.isTexture)once(v);once(a);}});};

export function createGiProxyRegistry({THREE,fetchJson=async url=>{const r=await fetch(url);const j=await r.json();if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);return j;},
  fetchBytes=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.arrayBuffer();},parseGlb,digest=digestHex}){
  // versions come from one sequence that never restarts, so a request from before a release, a clear or a newer
  // selection can never pass as current; owned is the proxy each root holds, apart from the handle snapshots.
  const handles=new Map(),versions=new Map(),owned=new Map();let sequence=0;
  // GI passes that read these proxies declare themselves; with none, a proxy setting changes nothing on screen.
  const consumers=new Map();let consumerSeq=0;
  // Forgetting a root's version is enough: any later request for it takes a larger one, and an earlier one never matches.
  const drop=root=>{disposeTree(owned.get(root));owned.delete(root);handles.delete(root);versions.delete(root);};
  function describe(root){
    const object=root.userData?.kaminosSceneObject,assetSha=shaOf(object?.source),surfels=surfelRootIn(root);
    if(!assetSha)return {state:'not-generated',reason:'not a stored generated mesh'};
    if(surfels){
      const levels=surfels.surfelOptions?.levels??[1];
      // Tiers come from the hero mesh when there is one; a surfels-only asset's tiers are keyed to its own sha
      // (built from the raw decode, their error measured against it).
      const heroSha=object.generation?.meshSha256??null;
      return {representation:'surfels',assetSha,heroSha,tierSource:heroSha??assetSha,surfels:{root:surfels,levels:[...levels],coarsest:Math.max(...levels)}};
    }
    return {representation:'mesh',assetSha,heroSha:assetSha,tierSource:assetSha};
  }
  async function resolve(root,selection){
    const version=++sequence;versions.set(root,version);
    const base={...describe(root),requested:{...selection},effective:null,levels:[],error:null,frame:'trellis-source',proxyRoot:null,
      placement:scene=>new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(root.updateWorldMatrix(true,false)??root.matrixWorld)};
    const settle=handle=>{
      if(versions.get(root)!==version){disposeTree(handle.proxyRoot);return {...handle,proxyRoot:null,superseded:true};}
      if(owned.get(root)!==handle.proxyRoot){disposeTree(owned.get(root));if(handle.proxyRoot)owned.set(root,handle.proxyRoot);else owned.delete(root);}
      handles.set(root,handle);return handle;};
    if(base.state)return settle(base);
    handles.set(root,{...(handles.get(root)??base),state:'resolving'});
    try{
      const query=new URLSearchParams({source:base.tierSource});
      if(selection.faces!=null)query.set('faces',String(selection.faces));
      if(selection.maxError!=null){query.set('maxError',String(selection.maxError));query.set('stat',selection.stat??'p95');}
      const set=await fetchJson(`/api/mesh-lods?${query}`);
      const levels=(set.levels??[]).map(l=>({sha:l.sha256,faces:l.faces,closed:l.closed??null}));
      if(!set.choice)return settle({...base,levels,state:'no-tiers',reason:base.heroSha?'no stored tiers for this hero mesh':'no stored tiers for this surfel asset yet'});
      const choice=set.choice,bytes=await fetchBytes(choice.source);
      if(await digest(bytes)!==choice.sha256)throw Error('GI proxy content does not match its sha');
      const proxyRoot=await parseGlb(bytes);proxyRoot.matrixAutoUpdate=false;proxyRoot.updateMatrix?.();
      return settle({...base,levels,state:'loaded',proxyRoot,
        effective:{sha:choice.sha256,faces:choice.faces,withinBudget:set.withinBudget??null},
        error:choice.error?{reference:choice.error.reference,units:`fraction of the ${choice.error.reference?.kind==='raw-decode'?'raw decode':'hero'} bounding-box diagonal`,relative:choice.error.relative}:null});
    }catch(error){return settle({...base,state:'failed',failure:String(error?.message||error)});}
  }
  return {
    attach(root,selection=DEFAULT_GI_PROXY_SELECTION){return resolve(root,selection);},
    select(root,selection){return resolve(root,selection);},
    get:root=>handles.get(root)??null,
    list:()=>[...handles.entries()].map(([root,h])=>({root,...h})),
    release(root){drop(root);},
    registerConsumer(name){if(typeof name!=='string'||!name)throw Error('A GI proxy consumer needs a name');const key=++consumerSeq;consumers.set(key,name);return ()=>{consumers.delete(key);};},
    consumers:()=>[...consumers.values()],
    // GI proxy turned off for this object (its render settings): no proxy held, and the handle says so.
    disable(root){drop(root);handles.set(root,{...describe(root),state:'disabled',proxyRoot:null,effective:null,levels:[],error:null});},
    // A cleared or reopened scene: every proxy goes, and results still in flight are not published.
    clear(){for(const root of new Set([...handles.keys(),...owned.keys(),...versions.keys()]))drop(root);},
  };
}
