import * as THREE from './lib/three.webgpu.js';
import {checkedSurfaceKelvin,SURFACE_KELVIN_PER_HEAT} from './burn-thermal-radiance.mjs';
import {checkedBurnAppearance} from './scene-burning-settings.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {LIVE_LOG_GRID,LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';
import {createLogDebrisGpu} from './log-debris-gpu.mjs';
import {resolveBurnableTarget,resolveBurnableHeroMesh} from './burnable-target.mjs';
import {bindResidentLightCoverage,residentLightCoverage} from './scene-resident-coverage.mjs';
import {sceneRadianceSourceMaterial,cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createSceneBurnStructure} from './scene-burn-structure.mjs';
import {createSceneBurnFracture} from './scene-burn-fracture.mjs';

export const originalBurnMaterial=sceneRadianceSourceMaterial;

// An object's material owns its state; it never switches sources, clocks or domains.
export async function createSceneBurnBody({entry,renderer,scene,ground,onFrame,kelvinPerHeat=()=>1600,beautyLods=null,resolveSurfaceGeometry=null}){
  resolveBurnableTarget([entry],entry.id);
  const mesh=resolveBurnableHeroMesh(entry.object);
  const resolveBeautyLods=()=>typeof beautyLods==='function'?beautyLods():beautyLods;
  const appearance=()=>checkedBurnAppearance(entry.burnable?.appearance??{profile:mesh.userData?.kaminosPromptRelief?.appearance??'crust',glow:1});
  const original=Array.isArray(mesh.material)?mesh.material.map(originalBurnMaterial):originalBurnMaterial(mesh.material),bindings=[],releases=[],proxyOriginals=new Map(),proxyBurnMaterials=new Map(),proxySameMaps=new Map(),proxyTransforms=new Map();
  let field,debris,structure,fracture,elapsed=0,disposed=false,lastSettings,lastKelvin;
  function syncAppearance(){let kelvin;try{kelvin=checkedSurfaceKelvin(kelvinPerHeat());}catch{kelvin=lastKelvin??SURFACE_KELVIN_PER_HEAT;}if(entry.burnable!==lastSettings||kelvin!==lastKelvin){const next=appearance();for(const binding of bindings)binding.setAppearance({...next,kelvinPerHeat:kelvin});lastSettings=entry.burnable;lastKelvin=kelvin;}}
  function dispose(){
    if(disposed)return;disposed=true;
    for(const release of releases)release();
    fracture?.dispose();structure?.dispose();
    for(const [proxyMesh,tf] of proxyTransforms){
      if(proxyMesh.geometry){
        proxyMesh.geometry.applyMatrix4(tf.heroToRoot);
        proxyMesh.geometry.computeBoundingBox?.();
        proxyMesh.geometry.computeBoundingSphere?.();
      }
      proxyMesh.matrix.copy(tf.origMatrix);
      proxyMesh.matrix.decompose(proxyMesh.position,proxyMesh.quaternion,proxyMesh.scale);
      proxyMesh.matrixWorldNeedsUpdate=true;
    }
    proxyTransforms.clear();
    for(const [proxyMesh,origMat] of proxyOriginals){
      if(proxyMesh.userData)delete proxyMesh.userData.kaminosBeautyLodBurnProxy;
      proxyMesh.material=origMat;
    }
    proxyOriginals.clear();
    proxySameMaps.clear();
    for(const pMats of proxyBurnMaterials.values()){
      for(const pm of (Array.isArray(pMats)?pMats:[pMats]))if(!converted?.includes(pm))pm?.dispose?.();
    }
    proxyBurnMaterials.clear();
    mesh.material=original;debris?.dispose();
    for(const binding of bindings)binding.dispose();field?.dispose();
  }
  let converted=null;
  try{
    entry.object.updateWorldMatrix(true,true);
    const invRoot=new THREE.Matrix4().copy(entry.object.matrixWorld).invert();
    const heroToRoot=new THREE.Matrix4().multiplyMatrices(invRoot,mesh.matrixWorld);
    const rootToHero=new THREE.Matrix4().copy(heroToRoot).invert();
    const identityMat=new THREE.Matrix4();
    let heroIsRootSpace=true;
    for(let i=0;i<16;i++){
      if(Math.abs(heroToRoot.elements[i]-identityMat.elements[i])>1e-7){heroIsRootSpace=false;break;}
    }
    mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
    const resolvedSurface=typeof resolveSurfaceGeometry==='function'?await resolveSurfaceGeometry(entry,{mesh,bounds,grid:LIVE_LOG_GRID}):null;
    const surfaceGeometry=resolvedSurface?.geometry??null;
    const surfaceLod=resolvedSurface?{tier:resolvedSurface.tier??'hero',faces:resolvedSurface.faces??null,heroFaces:resolvedSurface.heroFaces??null,voxelError:resolvedSurface.voxelError??0}:null;
    field=await createLiveLogHeatGpu({renderer,mesh,bounds,surfaceGeometry,surfaceLod,disintegrate:true});
    const origList=Array.isArray(original)?original:[original];
    converted=origList.map(material=>{
      const binding=createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:LIVE_LOG_HEAT_IDENTITY,presenceNode:field.stateNode.w});
      bindings.push(binding);return binding.material;
    });
    const burnMaterialValue=Array.isArray(original)?converted:converted[0];
    mesh.material=burnMaterialValue;syncAppearance();
    const coverage={owner:mesh,read:()=>({...field.residentState(),texture:field.texture,device:field.device,revision:field.read().generation+':'+field.read().steps})};
    releases.push(bindResidentLightCoverage(mesh,coverage));
    function buildProxyBurnMaterial(origProxyMat,idx){
      const heroOrig=origList[idx]??origList[0];
      const baseBurn=converted[idx]??converted[0];
      const sameMaps=(origProxyMat?.map??null)===(heroOrig?.map??null)
        &&(origProxyMat?.normalMap??null)===(heroOrig?.normalMap??null)
        &&(origProxyMat?.roughnessMap??null)===(heroOrig?.roughnessMap??null)
        &&(origProxyMat?.metalnessMap??null)===(heroOrig?.metalnessMap??null);
      if(sameMaps||!origProxyMat)return {material:baseBurn,sameMaps:true};
      const cloned=cloneSceneRadianceMaterial(renderer.library,origProxyMat);
      cloned.colorNode=baseBurn.colorNode;
      cloned.roughnessNode=baseBurn.roughnessNode;
      cloned.normalNode=baseBurn.normalNode;
      cloned.metalnessNode=baseBurn.metalnessNode;
      cloned.emissiveNode=baseBurn.emissiveNode;
      cloned.opacityNode=baseBurn.opacityNode;
      cloned.outputNode=baseBurn.outputNode;
      cloned.alphaTest=baseBurn.alphaTest;
      return {material:cloned,sameMaps:false};
    }
    function syncProxyBurnMaterials(){
      const proxyMeshes=new Set();
      entry.object.traverse(node=>{
        if(!node.isMesh||node===mesh)return;
        let inBeautyProxy=false;
        for(let p=node;p&&p!==entry.object;p=p.parent){
          if(p.userData?.kaminosRepetitionCopy||p.userData?.kaminosEditorHelper||p.userData?.kaminosEditorOnly)return;
          if(p.userData?.kaminosBeautyLodProxy)inBeautyProxy=true;
        }
        if(inBeautyProxy)proxyMeshes.add(node);
      });
      for(const rung of resolveBeautyLods()?.listResidentRungs?.(entry.object)??[]){
        rung.root?.traverse?.(node=>{if(node.isMesh)proxyMeshes.add(node);});
      }
      for(const proxyMesh of proxyMeshes){
        if(!heroIsRootSpace&&!proxyTransforms.has(proxyMesh)&&proxyMesh.geometry){
          proxyTransforms.set(proxyMesh,{heroToRoot:heroToRoot.clone(),origMatrix:proxyMesh.matrix.clone()});
          proxyMesh.geometry.applyMatrix4(rootToHero);
          proxyMesh.geometry.computeBoundingBox?.();
          proxyMesh.geometry.computeBoundingSphere?.();
          proxyMesh.matrix.copy(heroToRoot);
          proxyMesh.matrix.decompose(proxyMesh.position,proxyMesh.quaternion,proxyMesh.scale);
          proxyMesh.matrixWorldNeedsUpdate=true;
        }
        if(!proxyOriginals.has(proxyMesh)){
          const rawOrig=proxyMesh.userData?.kaminosOriginalMaterial??proxyMesh.material;
          proxyOriginals.set(proxyMesh,Array.isArray(rawOrig)?rawOrig.map(originalBurnMaterial):originalBurnMaterial(rawOrig));
        }
        if(!proxyBurnMaterials.has(proxyMesh)){
          const origVal=proxyOriginals.get(proxyMesh);
          if(Array.isArray(origVal)){
            const built=origVal.map((m,i)=>buildProxyBurnMaterial(m,i));
            proxyBurnMaterials.set(proxyMesh,built.map(b=>b.material));
            proxySameMaps.set(proxyMesh,built.map(b=>b.sameMaps));
          }else{
            const built=buildProxyBurnMaterial(origVal,0);
            proxyBurnMaterials.set(proxyMesh,built.material);
            proxySameMaps.set(proxyMesh,[built.sameMaps]);
          }
        }
        if(!proxyMesh.userData)proxyMesh.userData={};
        proxyMesh.userData.kaminosBeautyLodBurnProxy=true;
        const targetBurn=proxyBurnMaterials.get(proxyMesh);
        const targetPrimary=Array.isArray(targetBurn)?targetBurn[0]:targetBurn;
        const curPrimary=Array.isArray(proxyMesh.material)?proxyMesh.material[0]:proxyMesh.material;
        if(curPrimary!==targetPrimary&&curPrimary?.colorNode!==targetPrimary?.colorNode){
          proxyMesh.material=targetBurn;
        }
        if(!residentLightCoverage(proxyMesh))releases.push(bindResidentLightCoverage(proxyMesh,coverage));
      }
    }
    syncProxyBurnMaterials();
    debris=await createLogDebrisGpu({renderer,field,ground:ground(),onFrame,thermalControls:bindings[0]?.thermalControls});
    releases.push(bindResidentLightCoverage(debris.caps,coverage));debris.caps.castShadow=true;
    // Detached fragments remain world-space presentation, never a separately editable object.
    scene.add(debris.root);
    structure=createSceneBurnStructure({renderer,field,parent:debris.root});
    void structure.configure(entry.burnable.structure===true);
    fracture=createSceneBurnFracture({renderer,field,structure,debris,parent:debris.root,ground,materials:Array.isArray(original)?original:[original]});
    void fracture.configure(entry.burnable.fracture===true);
    // Authored surface edits also apply while the fluid is paused; lighting may
    // have installed an outer clone, whose scalar inputs need the same update.
    releases.push(onFrame(()=>{
      structure.present();fracture.present();syncAppearance();fracture.update(elapsed,{...appearance(),kelvinPerHeat:lastKelvin});
      syncProxyBurnMaterials();
      const displayed=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      bindings.forEach((binding,i)=>{
        binding.update(elapsed,displayed[i]);
        for(const [proxyMesh,origVal] of proxyOriginals.entries()){
          const pMat=Array.isArray(proxyMesh.material)?proxyMesh.material[i]:proxyMesh.material;
          if(!pMat||pMat===displayed[i])continue;
          const sameMap=proxySameMaps.get(proxyMesh)?.[i]??true;
          if(sameMap){
            binding.update(elapsed,pMat);
          }else{
            const origMat=Array.isArray(origVal)?origVal[i]:origVal;
            if(origMat){
              pMat.color?.copy?.(origMat.color);
              pMat.roughness=origMat.roughness;
              pMat.metalness=origMat.metalness;
            }
          }
        }
      });
    }));
    return {
      object:entry.object,
      setSettings:settings=>{void structure.configure(settings?.structure===true);void fracture.configure(settings?.fracture===true);},
      get requiresSubmittedSteps(){return fracture.active;},
      afterSubmit:(frame,contacts)=>fracture.afterSubmit(frame,contacts),
      settleMechanics:()=>fracture.settled(),
      mechanicalParticipant:()=>fracture.mechanicalParticipant(),
      reset(){if(disposed)throw Error('Burn body is disposed');field.reset();structure.reset();fracture.reset();debris.reset();elapsed=0;for(const binding of bindings)binding.update(0);},
      setAppearance(value){if(bindings.some(binding=>!binding.read().appearanceSelectable))throw Error('No incineration appearance on this material');for(const binding of bindings)binding.setAppearance(value);},
      setMounted(value){debris.root.visible=value;},
      materialMask:()=>field.materialMask(entry.id),
      encodeGasSource:(encoder,frame,gas)=>field.encodeGasSource(encoder,frame,gas),
      encode(encoder,frame){const fStatus=fracture.read().status;if(fStatus==='preparing'||fStatus==='compiling')return;field.encode(encoder,frame);structure.encode(encoder);if(!fracture.active)debris.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);},
      read:()=>({objectId:entry.id,fields:[field.read()],structure:structure.read(),fracture:fracture.read(),debris:debris.read(),elapsed,physicalWoodCalibration:false,appearance:bindings.map(binding=>binding.read()),
        materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({color:m.color.getHexString(),roughness:m.roughness,metalness:m.metalness}))}),
      snapshot:async()=>({...await debris.snapshot(),structure:await structure.snapshot(),fracture:await fracture.snapshot()}),
      dispose,
    };
  }catch(error){dispose();throw error;}
}
