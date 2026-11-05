import {FIRE_DOMAIN_ID,FIRE_DOMAIN_TYPE} from './scene-fire-domain.mjs';
import {allocateColliderLods,applyRootVertexWarpToRung,bakeRungMeshesToRootSpace,selectColliderTier,voxelSolidError} from './scene-lod-budget.mjs';
import {readTrianglePrimitives} from './poly-glb-io.mjs';

export function parseUntexturedColliderGlb(THREE,bytes) {
  const root=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial();
  for(const prim of readTrianglePrimitives(bytes)){
    const geom=new THREE.BufferGeometry();
    geom.setAttribute('position',new THREE.BufferAttribute(prim.positions,3));
    if(prim.normals)geom.setAttribute('normal',new THREE.BufferAttribute(prim.normals,3));
    if(prim.indices)geom.setIndex(new THREE.BufferAttribute(prim.indices,1));
    geom.computeBoundingBox?.();
    geom.computeBoundingSphere?.();
    const matrices=prim.worldMatrices?.length?prim.worldMatrices:[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]];
    for(const mArr of matrices){
      const mesh=new THREE.Mesh(matrices.length>1?geom.clone():geom,mat);
      mesh.matrix.fromArray(mArr);
      mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
      mesh.matrixWorld.copy(mesh.matrix);
      root.add(mesh);
    }
  }
  return root;
}

export const SCENE_COLLIDER_SOURCE_ID='authored-fire-solids';
export const canCollideWithFire=record=>['glb','pbr','procedural-mesh'].includes(record?.type);
export function checkedObjectCollision(record,value=record?.collision) {
  if(value==null)return null;
  if(!canCollideWithFire(record))throw Error('Fire collision requires a mesh object');
  if(value.domainId!==FIRE_DOMAIN_ID || typeof value.enabled!=='boolean')throw Error('Invalid object collision membership');
  return {...structuredClone(value),domainId:FIRE_DOMAIN_ID,enabled:value.enabled};
}
export function checkSceneCollisionReferences(records,{implicitFireDomain=false}={}) {
  const domains=new Set(records.filter(record=>record.type===FIRE_DOMAIN_TYPE).map(record=>record.id));
  if(implicitFireDomain)domains.add(FIRE_DOMAIN_ID);
  for(const record of records)if(record.collision && !domains.has(checkedObjectCollision(record).domainId))throw Error('Object collision references a missing fire domain');
}

const digestHex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

function eligibleMesh(mesh) {
  if(!mesh.isMesh)return false;
  for(let node=mesh;node;node=node.parent)if(!node.visible || node.userData?.kaminosBeautyLodProxy || node.userData?.kaminosEditorHelper || node.userData?.kaminosEditorOnly)return false;
  return true;
}

function intrinsicHeroMesh(mesh,root) {
  if(!mesh.isMesh)return false;
  for(let node=mesh;node;node=node.parent){
    if(node.userData?.kaminosBeautyLodProxy || node.userData?.kaminosEditorHelper || node.userData?.kaminosEditorOnly)return false;
    if(node!==root && node.userData?.kaminosRepetitionCopy)return false;
  }
  return true;
}

function primaryHeroMesh(mesh,root) {
  return eligibleMesh(mesh) && intrinsicHeroMesh(mesh,root);
}

function hasVisibleHeroMesh(root) {
  let found=false;
  root.traverse(m=>{if(!found&&primaryHeroMesh(m,root))found=true;});
  return found;
}

function meshTriangleCount(mesh) {
  const geom=mesh?.geometry;
  const pos=geom?.getAttribute?.('position');
  if(!pos)return 0;
  const idx=geom.getIndex?.();
  return Math.floor((idx?idx.count:pos.count)/3);
}

function cloneColliderRung(THREE,node,fallbackMaterial=null) {
  const mat=fallbackMaterial??new THREE.MeshBasicMaterial();
  let copy;
  if(node.isMesh){
    const geom=node.geometry.clone();
    const base=node.geometry.userData?.kaminosWarpBase;
    const origPos=base?.origMeshPos??(ArrayBuffer.isView(base)?base:null);
    if(origPos){
      const posAttr=geom.getAttribute?.('position');
      if(posAttr?.array?.length===origPos.length){
        posAttr.array.set(origPos);
        posAttr.needsUpdate=true;
      }
      const normAttr=geom.getAttribute?.('normal');
      if(normAttr?.array&&base.origMeshNorm?.length===normAttr.array.length){
        normAttr.array.set(base.origMeshNorm);
        normAttr.needsUpdate=true;
      }
      const tanAttr=geom.getAttribute?.('tangent');
      if(tanAttr?.array&&base.origMeshTan?.length===tanAttr.array.length){
        tanAttr.array.set(base.origMeshTan);
        tanAttr.needsUpdate=true;
      }
    }
    geom.userData={};
    copy=new THREE.Mesh(geom,node.material??mat);
  }else{
    copy=new THREE.Group();
  }
  copy.position.copy(node.position);
  copy.quaternion.copy(node.quaternion);
  copy.scale.copy(node.scale);
  copy.matrix.copy(node.matrix);
  copy.matrixAutoUpdate=node.matrixAutoUpdate;
  copy.visible=node.visible;
  for(const child of node.children??[])copy.add(cloneColliderRung(THREE,child,mat));
  return copy;
}

function disposeColliderRung(root) {
  if(!root)return;
  const seen=new Set();
  root.traverse?.(m=>{
    if(m.isMesh&&m.geometry&&!seen.has(m.geometry)){
      seen.add(m.geometry);
      m.geometry.dispose?.();
    }
  });
}

function inspectColliderHeroRoot(THREE,root) {
  root.updateWorldMatrix?.(true,true);
  const invRoot=new THREE.Matrix4().copy(root.matrixWorld).invert();
  const localBox=new THREE.Box3();
  const unwarpedBox=new THREE.Box3();
  const scratchBox=new THREE.Box3();
  const scratchMat=new THREE.Matrix4();
  let heroFaces=0;
  let primaryMaterial=null;
  root.traverse(m=>{
    if(!intrinsicHeroMesh(m,root))return;
    if(!primaryMaterial&&m.material)primaryMaterial=m.material;
    heroFaces+=meshTriangleCount(m);
    const geom=m.geometry;
    if(geom){
      if(!geom.boundingBox)geom.computeBoundingBox?.();
      if(geom.boundingBox){
        scratchMat.copy(invRoot).multiply(m.matrixWorld);
        scratchBox.copy(geom.boundingBox).applyMatrix4(scratchMat);
        localBox.union(scratchBox);
      }
      const rb=geom.userData?.kaminosWarpBase?.rootBounds;
      if(rb?.min&&rb?.max){
        unwarpedBox.expandByPoint(new THREE.Vector3(...rb.min));
        unwarpedBox.expandByPoint(new THREE.Vector3(...rb.max));
      }
    }
  });
  if(localBox.isEmpty()){
    localBox.set(new THREE.Vector3(-0.5,-0.5,-0.5),new THREE.Vector3(0.5,0.5,0.5));
  }
  const explicitBounds=root.userData?.kaminosVertexWarpBounds??root.userData?.kaminosUnwarpedRootBox??null;
  const unwarpedBounds=explicitBounds??(!unwarpedBox.isEmpty()?{min:unwarpedBox.min.toArray(),max:unwarpedBox.max.toArray()}:(!root.userData?.kaminosVertexWarp?{min:localBox.min.toArray(),max:localBox.max.toArray()}:null));
  const geomStretch=Math.max(1,Number(root.userData?.kaminosVertexWarpMaxStretch)||1);
  return {heroFaces:Math.max(1,heroFaces),localBox,unwarpedBounds,geomStretch,primaryMaterial};
}

// Stable per-object groups supply world triangles without reparenting authored
// objects or copying geometry buffers. The engine caches each object's mask.
export function createSceneColliderCollection(THREE,{
  giProxies=null,
  beautyLods=null,
  fetchBytes=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.arrayBuffer();},
  parseGlb=bytes=>parseUntexturedColliderGlb(THREE,bytes),
  digest=digestHex,
  enabled=true,
  grid=64,
  domainScale=1,
  voxelSize=null,
  maxVoxelError=0.85,
  colliderFaceBudget=50000,
  requireClosed=true,
  stat='p95',
  tailWeight=0.5,
  creviceAllowance=0.005,
  hysteresis=0.15,
  onRungReady=null,
}={}) {
  const object=new THREE.Group(),wrappers=new Map(),groups=new Map(),entries=new Map(),pendingLoads=new Set();
  object.name='Authored fire obstacles';
  const config={enabled:Boolean(enabled),grid,domainScale,voxelSize,maxVoxelError,colliderFaceBudget,requireClosed,stat,tailWeight,creviceAllowance,hysteresis};
  let memberIds=[],lastTriangleCount=0,lastHeroTriangleCount=0,lastLodBudget=null;
  const resolveGiProxies=()=>typeof giProxies==='function'?giProxies():giProxies;
  const resolveBeautyLods=()=>typeof beautyLods==='function'?beautyLods():beautyLods;

  function releaseEntry(root) {
    const entry=entries.get(root);
    if(!entry)return;
    entry.generation++;
    for(const rung of entry.rungs.values())disposeColliderRung(rung.root);
    entry.rungs.clear();
    entry.inFlight.clear();
    entries.delete(root);
  }

  const ashGroups=new Map(),ashWrappers=new Map();

  function clear() {
    object.clear();
    wrappers.clear();
    groups.clear();
    ashWrappers.clear();
    ashGroups.clear();
    memberIds=[];
    lastTriangleCount=0;
    lastHeroTriangleCount=0;
    lastLodBudget=null;
    for(const root of [...entries.keys()])releaseEntry(root);
  }

  function installRungRoot(entry,sha,faces,rawRoot) {
    const rungRoot=cloneColliderRung(THREE,rawRoot,entry.primaryMaterial);
    rungRoot.matrixAutoUpdate=false;
    rungRoot.matrix.identity();
    rungRoot.matrixWorld.identity();
    bakeRungMeshesToRootSpace(THREE,rungRoot);
    if(typeof entry.warpFn==='function'){
      const warpRes=applyRootVertexWarpToRung(THREE,rungRoot,entry.warpFn,{bounds:entry.unwarpedBounds});
      if(warpRes.maxStretch>entry.geomStretch){
        entry.geomStretch=warpRes.maxStretch;
        entry.voxelTier='hero';
        entry.activeTier='hero';
      }
    }
    const record={sha,faces,root:rungRoot,warpFn:entry.warpFn,warpRevision:entry.warpRevision};
    entry.rungs.set(sha,record);
    return record;
  }

  function ensureRungLoaded(root,entry,levelObj) {
    const sha=levelObj?.sha??levelObj?.sha256;
    if(!sha||entry.rungs.has(sha)||entry.inFlight.has(sha)||typeof parseGlb!=='function')return;
    const url=levelObj.source??`/api/read?root=generated-meshes&path=${sha}.glb`;
    const gen=entry.generation;
    entry.inFlight.add(sha);
    const task=(async()=>{
      try{
        const bytes=await fetchBytes(url);
        if(entries.get(root)!==entry||entry.generation!==gen)return;
        if(await digest(bytes)!==sha)throw Error('Collider LOD rung content does not match its sha');
        const parsed=await parseGlb(bytes);
        if(entries.get(root)!==entry||entry.generation!==gen){disposeColliderRung(parsed);return;}
        installRungRoot(entry,sha,levelObj.faces,parsed);
        disposeColliderRung(parsed);
        if(entry.activeTier===sha)entry.displayedTier=sha;
        onRungReady?.(root,sha);
      }catch{
        // Keep hero or previously resident rung on load error
      }finally{
        entry.inFlight.delete(sha);
        pendingLoads.delete(task);
      }
    })();
    pendingLoads.add(task);
  }

  function syncResidentRungsFromPeers(root,entry,handle,beautyCtrl) {
    const effSha=handle?.effective?.sha??handle?.effective?.sha256;
    if(effSha&&handle?.proxyRoot&&!entry.rungs.has(effSha)){
      const levelObj=handle.levels?.find?.(l=>(l.sha??l.sha256)===effSha);
      installRungRoot(entry,effSha,levelObj?.faces??handle.effective?.faces??0,handle.proxyRoot);
    }
    const residentBeauty=beautyCtrl?.listResidentRungs?.(root)??[];
    for(const br of residentBeauty){
      if(br?.sha&&br?.root&&!entry.rungs.has(br.sha)){
        const levelObj=handle?.levels?.find?.(l=>(l.sha??l.sha256)===br.sha);
        installRungRoot(entry,br.sha,br.faces??levelObj?.faces??0,br.root);
      }
    }
  }

  function ensureEntryForRoot(root,id) {
    let entry=entries.get(root);
    const curWarpFn=typeof root.userData?.kaminosVertexWarp==='function'?root.userData.kaminosVertexWarp:null;
    const curWarpRev=root.userData?.kaminosVertexWarpRevision??0;
    if(!entry){
      const info=inspectColliderHeroRoot(THREE,root);
      entry={
        id,
        ...info,
        rungs:new Map(),
        inFlight:new Set(),
        activeTier:'hero',
        voxelTier:'hero',
        displayedTier:'hero',
        generation:1,
        warpFn:curWarpFn,
        warpRevision:curWarpRev,
      };
      entries.set(root,entry);
    }else{
      if(id)entry.id=id;
      if(entry.warpFn!==curWarpFn||entry.warpRevision!==curWarpRev){
        entry.warpFn=curWarpFn;
        entry.warpRevision=curWarpRev;
        const info=inspectColliderHeroRoot(THREE,root);
        entry.heroFaces=info.heroFaces;
        entry.localBox=info.localBox;
        entry.unwarpedBounds=info.unwarpedBounds;
        entry.geomStretch=info.geomStretch;
        entry.primaryMaterial=info.primaryMaterial;
        entry.voxelTier='hero';
        entry.activeTier='hero';
        for(const rungRecord of entry.rungs.values()){
          const warpRes=applyRootVertexWarpToRung(THREE,rungRecord.root,curWarpFn,{bounds:entry.unwarpedBounds});
          if(warpRes.maxStretch>entry.geomStretch)entry.geomStretch=warpRes.maxStretch;
          rungRecord.warpFn=curWarpFn;
          rungRecord.warpRevision=curWarpRev;
        }
      }
    }
    return entry;
  }

  function update(records,frameOptions={}) {
    const meshes=new Map();
    memberIds=[];
    lastTriangleCount=0;
    lastHeroTriangleCount=0;
    const seenLodRoots=new Set();
    const lodCandidates=[];
    const copyWorldMat=new THREE.Matrix4();
    const reg=resolveGiProxies();
    const beauty=resolveBeautyLods();

    // First pass: inspect collision-enabled objects under restored beauty state and prepare LOD candidates
    const activeRecords=[];
    for(const record of records) {
      if(!checkedObjectCollision(record)?.enabled)continue;
      const restoreBeauty=record.object.userData?.kaminosBeautyLodRestore?.();
      try {
        record.object.updateWorldMatrix(true,true);
        const handle=(config.enabled&&reg)?(reg.handleFor?.(record.object)??reg.get?.(record.object)??null):null;
        const hasLods=Boolean(handle?.levels?.length&&handle.representation!=='surfels');
        if(hasLods){
          seenLodRoots.add(record.object);
          ensureEntryForRoot(record.object,record.id);
        }
        if(!hasVisibleHeroMesh(record.object))continue;
        if(hasLods){
          const entry=entries.get(record.object);
          const repSources=record.object.children.filter(c=>c.visible&&c.userData?.kaminosRepetitionCopy===true);
          const instanceBoxes=[new THREE.Box3().copy(entry.localBox).applyMatrix4(record.object.matrixWorld)];
          for(const rep of repSources){
            copyWorldMat.multiplyMatrices(record.object.matrixWorld,rep.matrix);
            instanceBoxes.push(new THREE.Box3().copy(entry.localBox).applyMatrix4(copyWorldMat));
          }
          const min=instanceBoxes[0].min,max=instanceBoxes[0].max;
          const worldDiag=Math.hypot(max.x-min.x,max.y-min.y,max.z-min.z)||1;
          lodCandidates.push({
            id:record.id,
            record,
            root:record.object,
            entry,
            handle,
            repSources,
            heroFaces:entry.heroFaces,
            levels:handle.levels,
            instanceBoxes:instanceBoxes.map(b=>({min:[b.min.x,b.min.y,b.min.z],max:[b.max.x,b.max.y,b.max.z]})),
            instanceCount:instanceBoxes.length,
            worldDiag,
            geomStretch:entry.geomStretch,
            activeTier:entry.activeTier,
            voxelTier:entry.voxelTier,
          });
          activeRecords.push({record,lodCandidate:lodCandidates.at(-1)});
        }else{
          activeRecords.push({record,lodCandidate:null});
        }
      } finally {
        restoreBeauty?.();
      }
    }

    for(const root of [...entries.keys()])if(!seenLodRoots.has(root))releaseEntry(root);

    if(lodCandidates.length){
      const effectiveOpts={...config,...frameOptions};
      lastLodBudget=allocateColliderLods(lodCandidates,effectiveOpts);
      const objectStates=[];
      for(const c of lodCandidates){
        const alloc=lastLodBudget.allocations[c.id];
        const targetTier=alloc.tier;
        c.entry.voxelTier=alloc.voxelTier??targetTier;
        c.entry.activeTier=targetTier;
        if(targetTier==='hero'){
          c.entry.displayedTier='hero';
        }else if(c.entry.rungs.has(targetTier)){
          c.entry.displayedTier=targetTier;
        }else if(c.handle.effective?.sha===targetTier&&c.handle.proxyRoot){
          const levelObj=c.handle.levels.find(l=>(l.sha??l.sha256)===targetTier);
          installRungRoot(c.entry,targetTier,levelObj?.faces??alloc.faces,c.handle.proxyRoot);
          c.entry.displayedTier=targetTier;
        }else{
          const beautyExact=beauty?.getResidentRung?.(c.root,targetTier);
          const beautyExactRoot=beautyExact?.root??(beautyExact?.isObject3D?beautyExact:null);
          if(beautyExactRoot){
            installRungRoot(c.entry,targetTier,beautyExact?.faces??alloc.faces,beautyExactRoot);
            c.entry.displayedTier=targetTier;
          }else{
            const levelObj=c.handle.levels.find(l=>(l.sha??l.sha256)===targetTier);
            if(levelObj)ensureRungLoaded(c.root,c.entry,levelObj);
            if(c.entry.displayedTier==='hero'||!c.entry.rungs.has(c.entry.displayedTier)){
              // If beautyLods or giProxies has a resident rung within voxel tolerance, borrow it while targetTier loads
              const residentBeauty=(beauty?.listResidentRungs?.(c.root)??[]).sort((a,b)=>(b.faces??0)-(a.faces??0));
              let borrowed=false;
              for(const br of residentBeauty){
                const lvl=c.handle.levels.find(l=>(l.sha??l.sha256)===br.sha);
                if(lvl&&(!effectiveOpts.requireClosed||lvl.closed!==false)){
                  const vErr=voxelSolidError(lvl,{worldDiag:c.worldDiag,voxelSize:lastLodBudget.voxelSize,grid:effectiveOpts.grid,domainScale:effectiveOpts.domainScale,geomStretch:c.geomStretch,stat:effectiveOpts.stat,tailWeight:effectiveOpts.tailWeight,creviceAllowance:effectiveOpts.creviceAllowance});
                  if(vErr<=effectiveOpts.maxVoxelError){
                    installRungRoot(c.entry,br.sha,br.faces??lvl.faces,br.root);
                    c.entry.displayedTier=br.sha;
                    borrowed=true;
                    break;
                  }
                }
              }
              if(!borrowed&&c.entry.displayedTier!=='hero'&&!c.entry.rungs.has(c.entry.displayedTier)){
                c.entry.displayedTier='hero';
              }
            }
          }
        }
        const displayedFaces=c.entry.displayedTier==='hero'
          ?c.entry.heroFaces
          :(c.entry.rungs.get(c.entry.displayedTier)?.faces??c.entry.heroFaces);
        objectStates.push({
          id:c.id,
          targetTier,
          displayedTier:c.entry.displayedTier,
          faces:displayedFaces,
          targetFaces:alloc.faces,
          totalFaces:c.instanceCount*displayedFaces,
          instanceCount:c.instanceCount,
          voxelError:alloc.voxelError,
          demotedByBudget:alloc.demotedByBudget,
        });
      }
      lastLodBudget={...lastLodBudget,objects:objectStates};
    }else{
      lastLodBudget=reg?{enabled:config.enabled,allocations:{},totalFaces:0,heroFacesTotal:0,colliderFaceBudget:config.colliderFaceBudget,maxVoxelError:config.maxVoxelError,withinBudget:true,objects:[]}:null;
    }

    // Second pass: populate world-space collider wrapper meshes (stunt-double rung or hero)
    const instMat=new THREE.Matrix4();
    for(const {record,lodCandidate} of activeRecords){
      const restoreBeauty=record.object.userData?.kaminosBeautyLodRestore?.();
      try {
        record.object.updateWorldMatrix(true,true);
        let heroTrisForRecord=0;
        record.object.traverse(mesh=>{if(eligibleMesh(mesh))heroTrisForRecord+=meshTriangleCount(mesh);});
        lastHeroTriangleCount+=heroTrisForRecord;

        const entry=lodCandidate?.entry;
        const rungRecord=(entry&&entry.displayedTier!=='hero')?entry.rungs.get(entry.displayedTier):null;
        if(rungRecord){
          rungRecord.root.updateWorldMatrix(true,true);
          const rungMeshes=[];
          rungRecord.root.traverse(rm=>{if(rm.isMesh&&rm.geometry)rungMeshes.push(rm);});
          if(rungMeshes.length){
            const repSources=lodCandidate.repSources;
            const totalInstances=1+repSources.length;
            for(let instIdx=0;instIdx<totalInstances;instIdx++){
              if(instIdx===0)instMat.copy(record.object.matrixWorld);
              else instMat.multiplyMatrices(record.object.matrixWorld,repSources[instIdx-1].matrix);
              for(let meshIdx=0;meshIdx<rungMeshes.length;meshIdx++){
                const rm=rungMeshes[meshIdx];
                const worldMat=new THREE.Matrix4().multiplyMatrices(instMat,rm.matrixWorld);
                const wrapperKey=`${record.id}:slot:${meshIdx}:inst:${instIdx}`;
                meshes.set(wrapperKey,{
                  geometry:rm.geometry,
                  material:rm.material,
                  matrixWorld:worldMat,
                  recordId:record.id,
                });
                lastTriangleCount+=meshTriangleCount(rm);
              }
            }
            memberIds.push(record.id);
            continue;
          }
        }
        let included=false;
        record.object.traverse(mesh=>{
          if(eligibleMesh(mesh)){
            meshes.set(mesh.uuid,{
              geometry:mesh.geometry,
              material:mesh.material,
              matrixWorld:mesh.matrixWorld,
              recordId:record.id,
            });
            lastTriangleCount+=meshTriangleCount(mesh);
            included=true;
          }
        });
        if(included)memberIds.push(record.id);
      } finally {
        restoreBeauty?.();
      }
    }

    for(const [id,wrapper] of wrappers)if(!meshes.has(id)){wrapper.removeFromParent();wrappers.delete(id);}
    for(const [id,{geometry,material,matrixWorld,recordId}] of [...meshes].sort(([a],[b])=>a.localeCompare(b))) {
      let group=groups.get(recordId);if(!group){group=new THREE.Group();group.name=recordId;groups.set(recordId,group);object.add(group);}
      let wrapper=wrappers.get(id);
      if(!wrapper){wrapper=new THREE.Mesh(geometry,material);wrapper.matrixAutoUpdate=false;wrappers.set(id,wrapper);}
      if(wrapper.parent!==group)group.add(wrapper);
      wrapper.geometry=geometry;wrapper.material=material;wrapper.matrix.copy(matrixWorld);wrapper.matrixWorld.copy(matrixWorld);
    }
    memberIds.sort();
    for(const [id,group] of groups)if(!memberIds.includes(id)){group.removeFromParent();groups.delete(id);}
    return object.children.length?{requested:true,id:SCENE_COLLIDER_SOURCE_ID,object,objects:memberIds.map(id=>({id,object:groups.get(id)})),memberIds:[...memberIds]}:null;
  }

  function resolveObstacle(recordOrRoot,frameOptions={}) {
    const root=recordOrRoot?.object??recordOrRoot;
    const id=recordOrRoot?.id??root?.uuid??'obstacle';
    if(!root?.isObject3D)return null;
    const restoreBeauty=root.userData?.kaminosBeautyLodRestore?.();
    try{
      root.updateWorldMatrix(true,true);
      const reg=resolveGiProxies();
      const beauty=resolveBeautyLods();
      const handle=(config.enabled&&reg)?(reg.handleFor?.(root)??reg.get?.(root)??null):null;
      const hasLods=Boolean(handle?.levels?.length&&handle.representation!=='surfels');
      const entry=hasLods?ensureEntryForRoot(root,id):null;
      if(!hasVisibleHeroMesh(root))return null;
      if(!hasLods)return root;

      const effectiveOpts={...config,...frameOptions};
      const wBox=new THREE.Box3().copy(entry.localBox).applyMatrix4(root.matrixWorld);
      const worldDiag=Math.hypot(wBox.max.x-wBox.min.x,wBox.max.y-wBox.min.y,wBox.max.z-wBox.min.z)||1;
      const chosen=selectColliderTier(handle.levels,{
        ...effectiveOpts,
        worldDiag,
        heroFaces:entry.heroFaces,
        geomStretch:entry.geomStretch,
        currentTier:'hero',
      });
      const targetTier=chosen.tier;
      let displayedTier='hero';
      if(targetTier!=='hero'){
        if(entry.rungs.has(targetTier)){
          displayedTier=targetTier;
        }else if(handle.effective?.sha===targetTier&&handle.proxyRoot){
          const levelObj=handle.levels.find(l=>(l.sha??l.sha256)===targetTier);
          installRungRoot(entry,targetTier,levelObj?.faces??chosen.faces,handle.proxyRoot);
          displayedTier=targetTier;
        }else{
          const beautyExact=beauty?.getResidentRung?.(root,targetTier);
          const beautyExactRoot=beautyExact?.root??(beautyExact?.isObject3D?beautyExact:null);
          if(beautyExactRoot){
            installRungRoot(entry,targetTier,beautyExact?.faces??chosen.faces,beautyExactRoot);
            displayedTier=targetTier;
          }else{
            const levelObj=handle.levels.find(l=>(l.sha??l.sha256)===targetTier);
            if(levelObj)ensureRungLoaded(root,entry,levelObj);
            const residentBeauty=(beauty?.listResidentRungs?.(root)??[]).sort((a,b)=>(b.faces??0)-(a.faces??0));
            for(const br of residentBeauty){
              const lvl=handle.levels.find(l=>(l.sha??l.sha256)===br.sha);
              if(lvl&&(!effectiveOpts.requireClosed||lvl.closed!==false)){
                const vErr=voxelSolidError(lvl,{...effectiveOpts,worldDiag,geomStretch:entry.geomStretch});
                if(vErr<=effectiveOpts.maxVoxelError){
                  installRungRoot(entry,br.sha,br.faces??lvl.faces,br.root);
                  displayedTier=br.sha;
                  break;
                }
              }
            }
          }
        }
      }
      const rungRecord=(displayedTier!=='hero')?entry.rungs.get(displayedTier):null;
      if(!rungRecord)return root;

      rungRecord.root.updateWorldMatrix(true,true);
      const rungMeshes=[];
      rungRecord.root.traverse(rm=>{if(rm.isMesh&&rm.geometry)rungMeshes.push(rm);});
      if(!rungMeshes.length)return root;

      let group=ashGroups.get(root);
      if(!group){group=new THREE.Group();group.name=`${id}:stunt-double`;ashGroups.set(root,group);}
      const repSources=root.children.filter(c=>c.visible&&c.userData?.kaminosRepetitionCopy===true);
      const totalInstances=1+repSources.length;
      const instMat=new THREE.Matrix4();
      const activeKeys=new Set();
      for(let instIdx=0;instIdx<totalInstances;instIdx++){
        if(instIdx===0)instMat.copy(root.matrixWorld);
        else instMat.multiplyMatrices(root.matrixWorld,repSources[instIdx-1].matrix);
        for(let meshIdx=0;meshIdx<rungMeshes.length;meshIdx++){
          const rm=rungMeshes[meshIdx];
          const wKey=`${id}:ash:${meshIdx}:${instIdx}`;
          activeKeys.add(wKey);
          let wrapper=ashWrappers.get(wKey);
          if(!wrapper){wrapper=new THREE.Mesh(rm.geometry,rm.material);wrapper.matrixAutoUpdate=false;ashWrappers.set(wKey,wrapper);}
          if(wrapper.parent!==group)group.add(wrapper);
          wrapper.geometry=rm.geometry;
          wrapper.material=rm.material;
          wrapper.name=rm.name||id;
          wrapper.matrix.multiplyMatrices(instMat,rm.matrixWorld);
          wrapper.matrixWorld.copy(wrapper.matrix);
        }
      }
      for(const [k,w] of ashWrappers)if(w.parent===group&&!activeKeys.has(k)){w.removeFromParent();ashWrappers.delete(k);}
      return group;
    }finally{
      restoreBeauty?.();
    }
  }

  async function resolveBurnableSurface(recordOrRoot,{mesh=null,bounds=null,grid=16,maxVoxelError=0.80}={}) {
    const root=recordOrRoot?.object??recordOrRoot;
    const id=recordOrRoot?.id??root?.userData?.kaminosSceneObject?.id??root?.uuid??'burnable';
    if(!root?.isObject3D)return null;
    const giReg=resolveGiProxies();
    await giReg?.whenIdle?.();
    const beautyCtrl=resolveBeautyLods();
    const restoreBeauty=typeof root.userData?.kaminosBeautyLodRestore==='function'?root.userData.kaminosBeautyLodRestore():null;
    let heroMesh=mesh,entry=null,handle=null,levels=null,localDiag=1,minPitch=0.01;
    try{
      root.updateWorldMatrix(true,true);
      if(!heroMesh){
        root.traverse(m=>{if(!heroMesh&&intrinsicHeroMesh(m,root))heroMesh=m;});
      }
      if(!heroMesh?.geometry)return null;
      if(!bounds){
        if(!heroMesh.geometry.boundingBox)heroMesh.geometry.computeBoundingBox?.();
        bounds=heroMesh.geometry.boundingBox;
      }
      entry=ensureEntryForRoot(root,id);
      if(!config.enabled)return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
      handle=giReg?.get?.(root)??giReg?.handleFor?.(root)??null;
      levels=handle?.representation==='surfels'?null:handle?.levels;
      if(!levels?.length)return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
      syncResidentRungsFromPeers(root,entry,handle,beautyCtrl);
      const size=bounds.getSize(new THREE.Vector3());
      localDiag=Math.hypot(size.x,size.y,size.z)||1;
      minPitch=Math.max(1e-6,Math.min(size.x,size.y,size.z)/Math.max(1,Number(grid)||16));
    }finally{
      restoreBeauty?.();
    }

    for(let pass=0;pass<levels.length+1;pass++){
      const chosen=selectColliderTier(levels,{
        heroFaces:entry.heroFaces,
        worldDiag:localDiag,
        voxelSize:minPitch,
        maxVoxelError,
        geomStretch:entry.geomStretch,
        requireClosed:config.requireClosed,
        stat:config.stat,
        tailWeight:config.tailWeight,
        creviceAllowance:config.creviceAllowance,
        hysteresis:0,
      });
      const targetTier=chosen.tier;
      if(targetTier==='hero'){
        return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
      }
      if(!entry.rungs.has(targetTier)){
        const levelObj=levels.find(l=>(l.sha??l.sha256)===targetTier);
        if(levelObj){
          ensureRungLoaded(root,entry,levelObj);
          while(pendingLoads.size)await Promise.all([...pendingLoads]);
        }
      }
      const rungRecord=entry.rungs.get(targetTier);
      if(!rungRecord){
        return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
      }
      // Re-verify if installRungRoot discovered a larger warp stretch
      const recheck=selectColliderTier(levels,{
        heroFaces:entry.heroFaces,
        worldDiag:localDiag,
        voxelSize:minPitch,
        maxVoxelError,
        geomStretch:entry.geomStretch,
        requireClosed:config.requireClosed,
        stat:config.stat,
        tailWeight:config.tailWeight,
        creviceAllowance:config.creviceAllowance,
        hysteresis:0,
      });
      if(recheck.tier!==targetTier)continue;
      let rungMesh=null;
      rungRecord.root.traverse(rm=>{if(!rungMesh&&rm.isMesh&&rm.geometry)rungMesh=rm;});
      if(!rungMesh)return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
      // If heroMesh has a non-identity local transform relative to root, map rungMesh.geometry into heroMesh's local space
      root.updateWorldMatrix(true,true);
      const invHero=new THREE.Matrix4().copy(heroMesh.matrixWorld).invert();
      const rootToHero=new THREE.Matrix4().multiplyMatrices(invHero,root.matrixWorld);
      const identity=new THREE.Matrix4();
      let isIdentity=true;
      for(let i=0;i<16;i++){
        if(Math.abs(rootToHero.elements[i]-identity.elements[i])>1e-7){isIdentity=false;break;}
      }
      let geometry=rungMesh.geometry;
      if(!isIdentity){
        geometry=rungMesh.geometry.clone();
        geometry.applyMatrix4(rootToHero);
        geometry.computeBoundingBox?.();
      }
      return {
        geometry,
        tier:targetTier,
        faces:recheck.selected?.faces??chosen.selected?.faces??rungRecord.faces,
        heroFaces:entry.heroFaces,
        voxelError:recheck.selected?.voxelError??chosen.selected?.voxelError??0,
      };
    }
    return {geometry:heroMesh.geometry,tier:'hero',faces:entry.heroFaces,heroFaces:entry.heroFaces,voxelError:0};
  }

  return {
    update,
    resolveObstacle,
    resolveBurnableSurface,
    clear,
    whenIdle:async()=>{while(pendingLoads.size)await Promise.all([...pendingLoads]);},
    async prepare(records,frameOptions={}) {
      await resolveGiProxies()?.whenIdle?.();
      for(let pass=0;pass<3;pass++){
        update(records,frameOptions);
        if(frameOptions.ashCellSize){
          for(const r of records)if(canCollideWithFire(r))resolveObstacle(r,{...frameOptions,voxelSize:frameOptions.ashCellSize});
        }
        if(!pendingLoads.size)break;
        while(pendingLoads.size)await Promise.all([...pendingLoads]);
      }
      update(records,frameOptions);
      return lastLodBudget;
    },
    setSettings(patch={}) {
      if(typeof patch.enabled==='boolean')config.enabled=patch.enabled;
      if(Number.isInteger(patch.grid)&&patch.grid>=2)config.grid=patch.grid;
      if(Number.isFinite(patch.domainScale)&&patch.domainScale>0)config.domainScale=patch.domainScale;
      if(patch.voxelSize===null||(Number.isFinite(patch.voxelSize)&&patch.voxelSize>0))config.voxelSize=patch.voxelSize;
      if(Number.isFinite(patch.maxVoxelError)&&patch.maxVoxelError>0)config.maxVoxelError=patch.maxVoxelError;
      if(patch.colliderFaceBudget===Infinity||(Number.isFinite(patch.colliderFaceBudget)&&patch.colliderFaceBudget>0))config.colliderFaceBudget=patch.colliderFaceBudget;
      if(typeof patch.requireClosed==='boolean')config.requireClosed=patch.requireClosed;
      return {...config};
    },
    read:()=>({...config}),
    state:()=>({
      memberIds:[...memberIds],
      meshCount:wrappers.size,
      triangleCount:lastTriangleCount,
      heroTriangleCount:lastHeroTriangleCount,
      lodBudget:lastLodBudget,
    }),
  };
}
