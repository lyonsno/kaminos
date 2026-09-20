import * as THREE from './lib/three.webgpu.js';
import {createFireLightFieldShadow} from './fire-light-field-shadow.mjs';

const {float,uniform,vec3}=THREE.TSL;

function materialForTriangle(mesh,triangleOffset) {
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(materials.length===1) return materials[0]||null;
  const group=mesh.geometry.groups.find(entry=>triangleOffset>=entry.start&&triangleOffset<entry.start+entry.count);
  return materials[group?.materialIndex??0]||null;
}

function eligibleMaterial(material) {
  return !!material&&!material.transparent&&!(material.opacity<1)&&!(material.alphaTest>0)
    &&!(material.transmission>0)&&material.transmissionNode==null&&material.backdropNode==null;
}

function materialAlbedo(material) {
  const color=material?.color?.isColor?material.color:new THREE.Color(.65,.65,.65);
  return color.clone();
}

function belongsToAuthoredSceneObject(object) {
  for(let current=object;current;current=current.parent) {
    if(current.userData?.kaminosSceneObject) return true;
  }
  return false;
}

export function collectStaticBounceTriangles(scene,{origin=new THREE.Vector3()}={}) {
  const candidates=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverseVisible(object=>{
    if(!object.isMesh||!object.castShadow||object.isSkinnedMesh||object.isInstancedMesh
      ||!belongsToAuthoredSceneObject(object)) return;
    const geometry=object.geometry,position=geometry?.attributes?.position;
    if(!position) return;
    const index=geometry.index;
    const triangleCount=Math.floor((index?.count??position.count)/3);
    for(let triangle=0;triangle<triangleCount;triangle++) {
      const offset=triangle*3,material=materialForTriangle(object,offset);
      if(!eligibleMaterial(material)) continue;
      const ia=index?index.getX(offset):offset;
      const ib=index?index.getX(offset+1):offset+1;
      const ic=index?index.getX(offset+2):offset+2;
      a.fromBufferAttribute(position,ia).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position,ib).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(position,ic).applyMatrix4(object.matrixWorld);
      ab.subVectors(b,a);ac.subVectors(c,a);normal.crossVectors(ab,ac);
      const twiceArea=normal.length();
      if(!(twiceArea>1e-8)) continue;
      normal.divideScalar(twiceArea);
      const centroid=a.clone().add(b).add(c).multiplyScalar(1/3);
      const towardOrigin=new THREE.Vector3().subVectors(origin,centroid);
      if(material.side===THREE.DoubleSide&&normal.dot(towardOrigin)<0) normal.negate();
      const distanceSq=Math.max(towardOrigin.lengthSq(),1e-4);
      const sourceCosine=Math.max(0,normal.dot(towardOrigin.normalize()));
      const area=twiceArea*.5;
      candidates.push({
        identity:`${object.uuid}:${triangle}`,
        object,triangle,position:centroid,normal:normal.clone(),area,
        albedo:materialAlbedo(material),
        sourceScore:area*(.05+.95*sourceCosine)/(distanceSq+.1),
      });
    }
  });
  return candidates;
}

export function selectStaticBouncePatches(scene,{count=12,origin=new THREE.Vector3()}={}) {
  if(!Number.isInteger(count)||count<0) throw new Error('bounce-patch-count-must-be-nonnegative-integer');
  const candidates=collectStaticBounceTriangles(scene,{origin});
  if(!candidates.length||count===0) return [];
  const bounds=new THREE.Box3();
  for(const candidate of candidates) bounds.expandByPoint(candidate.position);
  const diagonal=Math.max(bounds.getSize(new THREE.Vector3()).length(),1e-4);
  const selected=[];
  const remaining=[...candidates];
  while(selected.length<count&&remaining.length) {
    let bestIndex=0,bestScore=-Infinity;
    for(let i=0;i<remaining.length;i++) {
      const candidate=remaining[i];
      let novelty=1;
      if(selected.length) {
        novelty=Math.min(...selected.map(chosen=>{
          const spatial=Math.min(1,candidate.position.distanceTo(chosen.position)/diagonal*3);
          const angular=(1-candidate.normal.dot(chosen.normal))*.5;
          return spatial+angular*.35;
        }));
      }
      const score=candidate.sourceScore*(.12+novelty);
      if(score>bestScore||(score===bestScore&&candidate.identity<remaining[bestIndex].identity)) {
        bestScore=score;bestIndex=i;
      }
    }
    selected.push(remaining.splice(bestIndex,1)[0]);
  }
  return selected;
}

export function createDisabledStaticDiffuseBounce() {
  const status={
    identity:'static-surface-vpl-first-diffuse-bounce-v0',requested:false,effective:false,
    enabled:false,reason:'route-not-requested',patchCount:0,maxPatchCount:0,resolution:null,
    cachedGeometryRevision:null,directBoundary:'accepted-direct-preserved',renderCount:0,
  };
  return {
    signal:vec3(0),render(){return false;},
    setEnabled(){return {...status};},
    debugState:()=>({...status,patches:[]}),
    dispose(){},
  };
}

export function createStaticDiffuseBounce({
  renderer,scene,fireShadow,fireCenterNode,fireIrradianceAtNode,
  receiverNode,receiverNormalNode,requested=false,patchCount=12,resolution=64,
  origin=new THREE.Vector3(),
}) {
  if(!Number.isInteger(patchCount)||patchCount<=0) throw new Error('bounce-patch-count-must-be-positive-integer');
  const enabled=uniform(requested?1:0);
  const slots=[];
  let signal=vec3(0);
  for(let i=0;i<patchCount;i++) {
    const position=uniform(new THREE.Vector3());
    const normal=uniform(new THREE.Vector3(0,1,0));
    const albedo=uniform(new THREE.Vector3(.65,.65,.65));
    const area=uniform(0);
    const active=uniform(0);
    const visibility=createFireLightFieldShadow({
      renderer,scene,sourceNode:position,receiverNode,normalNode:receiverNormalNode,
      requested,resolution,
    });

    const toFire=fireCenterNode.sub(position);
    const fireDistanceSq=toFire.dot(toFire);
    const fireDirection=toFire.div(fireDistanceSq.sqrt().max(1e-5));
    const sourceCosine=normal.dot(fireDirection).max(0);
    const sourceVisibility=fireShadow.visibilityAt(position,normal);
    const patchRadiance=fireIrradianceAtNode(position).max(vec3(0)).mul(sourceCosine)
      .mul(sourceVisibility).mul(albedo).mul(1/Math.PI);

    const toPatch=position.sub(receiverNode);
    const distanceSq=toPatch.dot(toPatch);
    const receiverToPatch=toPatch.div(distanceSq.sqrt().max(1e-5));
    const receiverCosine=receiverNormalNode.dot(receiverToPatch).max(0);
    const patchCosine=normal.dot(receiverToPatch.negate()).max(0);
    const solidAngle=area.mul(receiverCosine).mul(patchCosine)
      .div(distanceSq.add(area.div(Math.PI)).mul(Math.PI).max(1e-5));
    signal=signal.add(patchRadiance.mul(solidAngle).mul(visibility.visibility).mul(active));
    slots.push({position,normal,albedo,area,active,visibility,identity:null});
  }

  const status={
    identity:'static-surface-vpl-first-diffuse-bounce-v0',requested:!!requested,effective:false,
    enabled:!!requested,reason:requested?'geometry-not-cached':'route-not-requested',patchCount:0,
    maxPatchCount:patchCount,resolution,cachedGeometryRevision:null,
    directBoundary:'accepted-direct-preserved',renderCount:0,
  };
  let cachedGeometryRevision=null;
  const render=geometryRevision=>{
    if(!requested) return false;
    if(status.effective&&geometryRevision===cachedGeometryRevision) return true;
    const patches=selectStaticBouncePatches(scene,{count:patchCount,origin});
    for(let i=0;i<slots.length;i++) {
      const slot=slots[i],patch=patches[i];
      slot.visibility.invalidate('bounce-geometry-rebuild');
      if(!patch) {slot.active.value=0;slot.identity=null;continue;}
      const epsilon=Math.max(.003,Math.sqrt(patch.area)*.004);
      slot.position.value.copy(patch.position).addScaledVector(patch.normal,epsilon);
      slot.normal.value.copy(patch.normal);
      slot.albedo.value.set(patch.albedo.r,patch.albedo.g,patch.albedo.b);
      slot.area.value=patch.area;
      slot.active.value=1;
      slot.identity=patch.identity;
      slot.visibility.render(`bounce:${geometryRevision}:${patch.identity}`);
    }
    cachedGeometryRevision=geometryRevision;
    status.cachedGeometryRevision=geometryRevision;
    status.patchCount=patches.length;
    status.effective=patches.length>0;
    status.reason=status.effective?null:'no-static-opaque-patches';
    status.renderCount++;
    return status.effective;
  };
  return {
    signal:signal.mul(enabled),
    render,
    setEnabled(value) {
      enabled.value=value?1:0;
      status.enabled=!!value;
      return {...status};
    },
    debugState:()=>({...status,patches:slots.filter(slot=>slot.active.value>0).map(slot=>({identity:slot.identity,position:slot.position.value.toArray(),normal:slot.normal.value.toArray(),area:slot.area.value,albedo:slot.albedo.value.toArray(),visibility:slot.visibility.debugState()}))}),
    dispose(){for(const slot of slots) slot.visibility.dispose();status.effective=false;status.reason='disposed';},
  };
}
