import * as THREE from './lib/three.webgpu.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {annularBurnerCasterKey,createAnnularBurnerCaster} from './annular-burner.mjs';
import {allocateShadowCasterLods,applyRootVertexWarpToRung} from './scene-lod-budget.mjs';
import {residentLightCoverage} from './scene-resident-coverage.mjs';
import {borrowSceneCaptureVisibility} from './scene-capture-visibility.mjs';
// Explicit provisional Stunt Doubles mapping, 2026-10-17T14:43:30Z; no measured-error selection.
export const KILN_CASTER_SOURCE='f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b';
export const KILN_CASTERS=Object.freeze({'5k':'1050a1d34389366eac0161ea002176fece47c7eeaac53a7795bae63ed4807456','10k':'11319add7e7593d80f33ec9c25b6f43c531122d423b9a25ef06b86b71b2d7470'});
export function validateCasterLevel(v){if(!['original',...Object.keys(KILN_CASTERS)].includes(v))throw Error('unknown fire shadow caster level');return v;}
export async function loadFireCaster(level){
  validateCasterLevel(level);const hash=KILN_CASTERS[level];
  const response=await fetch(`/api/read?root=generated-meshes&path=${hash}.glb`);
  if(!response.ok)throw Error(`fire caster ${level} unavailable: HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==hash)throw Error('fire caster content identity mismatch');
  // Depth only: preserve geometry/node matrices; do not decode unused PBR images.
  const loader=new GLTFLoader().register(parser=>({name:'KaminosDepthOnlyCaster',beforeRoot(){for(const mesh of parser.json.meshes??[])for(const p of mesh.primitives)delete p.material;}}));
  const {scene}=await loader.parseAsync(bytes,'');scene.traverse(m=>{if(m.isMesh)m.castShadow=true;});return scene;
}
const release=root=>root.traverse(m=>{if(m.isMesh){m.geometry.dispose();for(const a of Array.isArray(m.material)?m.material:[m.material])a.dispose();}});
const matches=root=>{const s=root.userData?.kaminosSceneObject?.source;if(typeof s!=='string')return false;const u=new URL(s,'http://kaminos.local');return u.pathname==='/api/read'&&u.searchParams.get('root')==='generated-meshes'&&u.searchParams.get('path')===`${KILN_CASTER_SOURCE}.glb`;};
const isSurfelMesh=m=>{let p=m;while(p){if(p.isTrellisSurfelRoot)return true;p=p.parent;}return false;};
const burnerRecipeOf=r=>r.userData?.kaminosAnnularBurnerRecipe??(r.userData?.kaminosSceneObject?.geometry?.kind==='annular'?r.userData.kaminosSceneObject.geometry.parameters:null);
const cloneBorrowedProxy=node=>{
  const copy=node.isMesh?new THREE.Mesh(node.geometry,node.material):new THREE.Group();
  copy.position.copy(node.position);copy.quaternion.copy(node.quaternion);copy.scale.copy(node.scale);
  copy.matrix.copy(node.matrix);copy.matrixAutoUpdate=node.matrixAutoUpdate;
  copy.visible=node.visible;copy.castShadow=node.castShadow;copy.receiveShadow=node.receiveShadow;
  for(const child of node.children)copy.add(cloneBorrowedProxy(child));
  return copy;
};
export function createFireShadowCasters({scene,load=loadFireCaster,giProxies=null,enabled=true,shadowFaceBudget=50000,maxSolidAngleError=0.015,flameBox:initialFlameBox={min:[-0.5,0,-0.5],max:[0.5,1,0.5]}}){
  let level='original',requested='original',generation=0,disposed=false,error=null,active=false,consumerRelease=null;
  const budgetConfig={shadowFaceBudget,maxSolidAngleError,flameBox:initialFlameBox};
  const shadowActiveTiers=new WeakMap(),pendingShadowSelections=new WeakMap(),localBoxCache=new WeakMap(),inFlightSelections=new Set();
  let lastShadowBudget=null;
  const localBoxOf=proxyRoot=>{
    if(localBoxCache.has(proxyRoot))return localBoxCache.get(proxyRoot);
    proxyRoot.updateWorldMatrix?.(true,true);
    const inv=new THREE.Matrix4().copy(proxyRoot.matrixWorld).invert(),b=new THREE.Box3(),sb=new THREE.Box3(),sm=new THREE.Matrix4();
    proxyRoot.traverse(m=>{
      if(!m.isMesh||!m.geometry)return;
      if(!m.geometry.boundingBox)m.geometry.computeBoundingBox?.();
      if(m.geometry.boundingBox){sm.copy(inv).multiply(m.matrixWorld);sb.copy(m.geometry.boundingBox).applyMatrix4(sm);b.union(sb);}
    });
    if(b.isEmpty())b.set(new THREE.Vector3(-0.5,-0.5,-0.5),new THREE.Vector3(0.5,0.5,0.5));
    localBoxCache.set(proxyRoot,b);return b;
  };
  const rootLocalBoxOf=root=>{
    const inv=new THREE.Matrix4().copy(root.matrixWorld).invert(),b=new THREE.Box3(),ub=new THREE.Box3(),sb=new THREE.Box3(),sm=new THREE.Matrix4();
    for(const ch of root.children){
      if(!ch.visible||ch.userData?.kaminosRepetitionCopy||ch.userData?.kaminosBeautyLodProxy||ch.userData?.kaminosEditorHelper||ch.userData?.kaminosEditorOnly)continue;
      ch.traverse(m=>{
        if(!m.isMesh||!m.geometry)return;
        if(!m.geometry.boundingBox)m.geometry.computeBoundingBox?.();
        if(m.geometry.boundingBox){sm.copy(inv).multiply(m.matrixWorld);sb.copy(m.geometry.boundingBox).applyMatrix4(sm);b.union(sb);}
        const rb=m.geometry.userData?.kaminosWarpBase?.rootBounds;
        if(rb?.min&&rb?.max){ub.expandByPoint(new THREE.Vector3(...rb.min));ub.expandByPoint(new THREE.Vector3(...rb.max));}
      });
    }
    if(b.isEmpty())b.set(new THREE.Vector3(-0.5,-0.5,-0.5),new THREE.Vector3(0.5,0.5,0.5));
    if(!ub.isEmpty()&&root.userData&&!root.userData.kaminosUnwarpedRootBox)root.userData.kaminosUnwarpedRootBox={min:ub.min.toArray(),max:ub.max.toArray()};
    return b;
  };
  const proxies=()=>giProxies??globalThis.window?.kaminosGiProxies??null;
  const syncConsumer=on=>{if(on&&!disposed){if(!consumerRelease)consumerRelease=proxies()?.registerConsumer?.('fire-shadow-casters')??null;}else{consumerRelease?.();consumerRelease=null;}};
  syncConsumer(enabled);
  const assets=new Map(),instances=new Map(),fingerprints=new WeakMap(),bufferIds=new WeakMap(),state={targets:0,originalTriangles:0,captureTriangles:0,errorMeasured:false};
  let nextBufferId=0;
  const bufferKey=a=>{if(!a)return null;if(!bufferIds.has(a))bufferIds.set(a,++nextBufferId);return [bufferIds.get(a),a.version,a.count];};
  const disposeInstance=inst=>{if(!inst)return;inst.wrapper.removeFromParent();inst.ownGeometry?.dispose();inst.proxy.traverse(m=>{if(m.isMesh){if(m.userData?.kaminosOwnsWarpedGeometry)m.geometry.dispose();m.material.dispose();}});};
  const clear=()=>{for(const inst of instances.values())disposeInstance(inst);instances.clear();};
  const collectAndAllocate=({smokeVisibility=false,flameBox=null}={})=>{
    if(flameBox?.min&&flameBox?.max)budgetConfig.flameBox=flameBox;
    scene.updateMatrixWorld(true);
    const candidates=[],reg=proxies();
    const visit=node=>{
      if(!node.visible)return;
      let hasResident=false;node.traverse(m=>{if(m.isMesh&&residentLightCoverage(m))hasResident=true;});
      if(hasResident)return;
      if(!smokeVisibility&&level!=='original'&&matches(node)){candidates.push({root:node,kind:'explicit-kiln'});return;}
      const handle=reg?.handleFor?.(node)??reg?.get?.(node);
      if((handle?.state==='loaded'||handle?.state==='resolving')&&handle.proxyRoot){candidates.push({root:node,kind:'gi-proxy',handle});return;}
      const recipe=burnerRecipeOf(node);
      if(recipe){candidates.push({root:node,kind:'annular-burner',recipe});return;}
      for(const child of node.children)visit(child);
    };
    visit(scene);
    const shadowCandidates=[];
    const copyMat=new THREE.Matrix4();
    for(const c of candidates){
      if(c.kind!=='gi-proxy'||!c.handle?.levels?.length)continue;
      const lb=typeof c.root.userData?.kaminosVertexWarp==='function'?rootLocalBoxOf(c.root):localBoxOf(c.handle.proxyRoot);
      const repSources=c.root.children.filter(ch=>ch.visible&&ch.userData?.kaminosRepetitionCopy===true);
      const instanceBoxes=[new THREE.Box3().copy(lb).applyMatrix4(c.root.matrixWorld)];
      for(const rep of repSources){copyMat.multiplyMatrices(c.root.matrixWorld,rep.matrix);instanceBoxes.push(new THREE.Box3().copy(lb).applyMatrix4(copyMat));}
      shadowCandidates.push({
        id:c.root.userData?.kaminosSceneObject?.id??c.root.uuid,
        root:c.root,
        handle:c.handle,
        levels:c.handle.levels,
        instanceBoxes,
        instanceCount:instanceBoxes.length,
        activeTier:shadowActiveTiers.get(c.root)??c.handle.effective?.sha??null,
      });
    }
    if(shadowCandidates.length){
      lastShadowBudget=allocateShadowCasterLods(shadowCandidates,{
        flameBox:budgetConfig.flameBox,
        shadowFaceBudget:budgetConfig.shadowFaceBudget,
        maxSolidAngleError:budgetConfig.maxSolidAngleError,
      });
      for(const sc of shadowCandidates){
        const alloc=lastShadowBudget.allocations[sc.id];
        if(!alloc)continue;
        shadowActiveTiers.set(sc.root,alloc.tier);
        const pendingFaces=pendingShadowSelections.get(sc.root);
        if(alloc.faces&&sc.handle.effective?.sha!==alloc.tier&&pendingFaces!==alloc.faces&&typeof reg?.select==='function'){
          pendingShadowSelections.set(sc.root,alloc.faces);
          const task=Promise.resolve(reg.select(sc.root,{faces:alloc.faces})).finally(()=>{
            if(pendingShadowSelections.get(sc.root)===alloc.faces)pendingShadowSelections.delete(sc.root);
            inFlightSelections.delete(task);
          });
          inFlightSelections.add(task);
        }
      }
    }
    return candidates;
  };
  return {
    setEnabled(v){if(disposed)throw Error('fire caster consumer disposed');syncConsumer(!!v);},
    setShadowBudget(patch={}){
      if(patch.shadowFaceBudget===Infinity||(Number.isFinite(patch.shadowFaceBudget)&&patch.shadowFaceBudget>0))budgetConfig.shadowFaceBudget=patch.shadowFaceBudget;
      if(Number.isFinite(patch.maxSolidAngleError)&&patch.maxSolidAngleError>0)budgetConfig.maxSolidAngleError=patch.maxSolidAngleError;
      if(patch.flameBox?.min&&patch.flameBox?.max)budgetConfig.flameBox=patch.flameBox;
      return {...budgetConfig};
    },
    whenShadowBudgetSettled:async()=>{while(inFlightSelections.size)await Promise.all([...inFlightSelections]);},
    async prepareCapture({flameBox=null}={}){
      if(disposed)throw Error('fire caster consumer disposed');
      await proxies()?.whenIdle?.();
      if(disposed)return null;
      const beautyRestores=[borrowSceneCaptureVisibility(scene)];
      scene.traverse(n=>{if(typeof n.userData?.kaminosBeautyLodRestore==='function')beautyRestores.push(n.userData.kaminosBeautyLodRestore());});
      try{collectAndAllocate({smokeVisibility:false,flameBox});}
      finally{for(let i=beautyRestores.length-1;i>=0;i--)beautyRestores[i]?.();}
      await this.whenShadowBudgetSettled();
      await proxies()?.whenIdle?.();
      return lastShadowBudget;
    },
    async setLevel(v){
      validateCasterLevel(v);if(disposed)throw Error('fire caster consumer disposed');const version=++generation;requested=v;error=null;
      if(v==='original'){level=v;clear();Object.assign(state,{targets:0,originalTriangles:0,captureTriangles:0,errorMeasured:false});return;}
      try{if(!assets.has(v)){const asset=await load(v);if(disposed||version!==generation){release(asset);return;}assets.set(v,asset);}if(version===generation){level=v;clear();Object.assign(state,{targets:0,originalTriangles:0,captureTriangles:0,errorMeasured:false});}}
      catch(e){if(version===generation)error=String(e.message);throw e;}
    },
    withCapture(fn,{smokeVisibility=false,flameBox=null}={}){
      if(disposed)throw Error('fire caster consumer disposed');if(active)return fn();
      const beautyRestores=[borrowSceneCaptureVisibility(scene)];
      scene.traverse(n=>{if(typeof n.userData?.kaminosBeautyLodRestore==='function')beautyRestores.push(n.userData.kaminosBeautyLodRestore());});
      try{
      const candidates=collectAndAllocate({smokeVisibility,flameBox});
      if(!smokeVisibility)Object.assign(state,{targets:0,originalTriangles:0,captureTriangles:0,errorMeasured:false});
      const seenRoots=new Set();
      if(!candidates.length){
        if(!smokeVisibility)for(const [k,inst]of instances){disposeInstance(inst);instances.delete(k);}
        return fn();
      }
      const hidden=[];
      try{active=true;for(const {root,kind,handle,recipe}of candidates){
        const meshes=[];root.traverseVisible(m=>{if(m.isMesh&&m.castShadow)meshes.push(m);});if(!meshes.length)continue;
        if(meshes.some(m=>m.isSkinnedMesh||(!isSurfelMesh(m)&&m.isInstancedMesh)||m.morphTargetInfluences?.length))throw Error('fire caster substitution requires static geometry');
        if(!root.matrixWorld.elements.every(Number.isFinite)||root.matrixWorld.determinant()===0)throw Error('fire caster requires a finite invertible source transform');
        if(meshes.some(m=>(Array.isArray(m.material)?m.material:[m.material]).some(a=>a.transparent||a.opacity<1||a.alphaTest>0||a.displacementMap)))throw Error('fire-shadow-unsupported-caster: reduced source must remain opaque and undisplaced');
        if(kind==='explicit-kiln'){
          const key=JSON.stringify(meshes.map(m=>[m.uuid,m.geometry.uuid,bufferKey(m.geometry.attributes.position),bufferKey(m.geometry.index),m.matrix.elements]));
          if(!fingerprints.has(root))fingerprints.set(root,key);if(fingerprints.get(root)!==key)throw Error('fire caster source geometry changed; choose original');
        }
        const sides=new Set(meshes.flatMap(m=>(Array.isArray(m.material)?m.material:[m.material]).map(m=>m.side)));if(sides.size!==1)throw Error('fire caster source has mixed sidedness');
        let instance=instances.get(root);
        if(kind==='explicit-kiln'){
          const key=`explicit:${level}`;
          if(instance?.key!==key){disposeInstance(instance);const wrapper=new THREE.Group(),proxy=assets.get(level).clone(true);proxy.traverse(m=>{if(m.isMesh)m.material=m.material.clone();});wrapper.matrixAutoUpdate=false;wrapper.add(proxy);instance={wrapper,proxy,repCopies:[],key,measured:false};instances.set(root,instance);}
        }else if(kind==='gi-proxy'){
          const warpFn=typeof root.userData?.kaminosVertexWarp==='function'?root.userData.kaminosVertexWarp:null;
          const warpRev=root.userData?.kaminosVertexWarpRevision??0;
          const warpBounds=root.userData?.kaminosVertexWarpBounds??root.userData?.kaminosUnwarpedRootBox??null;
          if(instance?.sourceAsset!==handle.proxyRoot){
            disposeInstance(instance);
            const wrapper=new THREE.Group(),proxy=handle.proxyRoot.clone(true);
            proxy.traverse(m=>{if(m.isMesh){m.castShadow=true;if(warpFn){m.geometry=m.geometry.clone();m.userData.kaminosOwnsWarpedGeometry=true;}m.material=(Array.isArray(m.material)?m.material[0]:m.material)?.clone()??new THREE.MeshBasicMaterial();}});
            if(warpFn)applyRootVertexWarpToRung(THREE,proxy,warpFn,{bounds:warpBounds});
            wrapper.matrixAutoUpdate=false;wrapper.add(proxy);
            instance={wrapper,proxy,repCopies:[],sourceAsset:handle.proxyRoot,key:'gi-proxy',measured:!!handle.error,warpFn,warpRev};
            instances.set(root,instance);
          }else{
            instance.measured=!!handle.error;
            if(instance.warpFn!==warpFn||instance.warpRev!==warpRev){
              let clonedNewGeom=false;
              if(warpFn)instance.proxy.traverse(m=>{if(m.isMesh&&!m.userData?.kaminosOwnsWarpedGeometry){m.geometry=m.geometry.clone();m.userData.kaminosOwnsWarpedGeometry=true;clonedNewGeom=true;}});
              applyRootVertexWarpToRung(THREE,instance.proxy,warpFn,{bounds:warpBounds});
              if(clonedNewGeom)while(instance.repCopies.length)instance.repCopies.pop().removeFromParent();
              instance.warpFn=warpFn;instance.warpRev=warpRev;
            }
          }
        }else if(kind==='annular-burner'){
          const key=annularBurnerCasterKey(recipe);
          if(instance?.key!==key){
            disposeInstance(instance);
            const caster=createAnnularBurnerCaster(THREE,mergeGeometries,recipe),wrapper=new THREE.Group(),proxy=new THREE.Mesh(caster.geometry,new THREE.MeshStandardMaterial());
            proxy.castShadow=true;wrapper.matrixAutoUpdate=false;wrapper.add(proxy);
            instance={wrapper,proxy,repCopies:[],key,ownGeometry:caster.geometry,measured:true};
            instances.set(root,instance);
          }
        }
        seenRoots.add(root);
        const {wrapper,proxy,repCopies}=instance;
        const repSources=root.children.filter(c=>c.visible&&c.userData?.kaminosRepetitionCopy===true);
        while(repCopies.length>repSources.length)repCopies.pop().removeFromParent();
        while(repCopies.length<repSources.length){const holder=new THREE.Group();holder.matrixAutoUpdate=false;holder.add(cloneBorrowedProxy(proxy));repCopies.push(holder);wrapper.add(holder);}
        for(let i=0;i<repSources.length;i++){repCopies[i].matrix.copy(repSources[i].matrix);repCopies[i].matrixWorldNeedsUpdate=true;}
        if(kind==='gi-proxy'&&typeof handle.placement==='function')wrapper.matrix.copy(handle.placement(scene));
        else wrapper.matrix.copy(scene.matrixWorld).invert().multiply(root.matrixWorld);
        let capTris=0;
        wrapper.traverse(m=>{if(m.isMesh){m.material.side=[...sides][0];capTris+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;}});
        if(!smokeVisibility){
          state.captureTriangles+=capTris;
          state.originalTriangles+=meshes.reduce((n,m)=>n+((m.geometry.index?.count??m.geometry.attributes.position.count)/3)*(m.isInstancedMesh?m.count:1),0);
          if(instance.measured)state.errorMeasured=true;
          state.targets++;
        }
        hidden.push([root,root.visible]);root.visible=false;scene.add(wrapper);
      }
      if(!smokeVisibility)for(const [k,inst]of instances)if(!seenRoots.has(k)){disposeInstance(inst);instances.delete(k);}
      return fn();}finally{for(const [root,visible]of hidden)root.visible=visible;for(const {wrapper}of instances.values())wrapper.removeFromParent();active=false;}
      }finally{for(let i=beautyRestores.length-1;i>=0;i--)beautyRestores[i]?.();}
    },
    debugState:()=>({level,requested,error,...state,asset:KILN_CASTERS[level]??null,source:KILN_CASTER_SOURCE,scope:'point-shadow-captures-only',shadowBudget:lastShadowBudget}),
    dispose(){if(disposed)return;disposed=true;syncConsumer(false);generation++;clear();for(const a of assets.values())release(a);assets.clear();},
  };
}
