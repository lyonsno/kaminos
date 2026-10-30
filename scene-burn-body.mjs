import {checkedSurfaceKelvin,SURFACE_KELVIN_PER_HEAT} from './burn-thermal-radiance.mjs';
import {checkedBurnAppearance} from './scene-burning-settings.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';
import {createLogDebrisGpu} from './log-debris-gpu.mjs';
import {resolveBurnableTarget} from './burnable-target.mjs';
import {bindResidentLightCoverage} from './scene-resident-coverage.mjs';
import {sceneRadianceSourceMaterial} from './scene-radiance.mjs';
import {createSceneBurnStructure} from './scene-burn-structure.mjs';

export const originalBurnMaterial=sceneRadianceSourceMaterial;

// An object's material owns its state; it never switches sources, clocks or domains.
export async function createSceneBurnBody({entry,renderer,scene,ground,onFrame,kelvinPerHeat=()=>1600}){
  resolveBurnableTarget([entry],entry.id);
  let mesh;entry.object.traverse(node=>{if(node.isMesh)mesh=node;});
  const appearance=()=>checkedBurnAppearance(entry.burnable?.appearance??{profile:mesh.userData?.kaminosPromptRelief?.appearance??'crust',glow:1});
  const original=Array.isArray(mesh.material)?mesh.material.map(originalBurnMaterial):originalBurnMaterial(mesh.material),bindings=[],releases=[];
  let field,debris,structure,elapsed=0,disposed=false,lastSettings,lastKelvin;
  function syncAppearance(){let kelvin;try{kelvin=checkedSurfaceKelvin(kelvinPerHeat());}catch{kelvin=lastKelvin??SURFACE_KELVIN_PER_HEAT;}if(entry.burnable!==lastSettings||kelvin!==lastKelvin){const next=appearance();for(const binding of bindings)binding.setAppearance({...next,kelvinPerHeat:kelvin});lastSettings=entry.burnable;lastKelvin=kelvin;}}
  function dispose(){
    if(disposed)return;disposed=true;
    for(const release of releases)release();
    structure?.dispose();mesh.material=original;debris?.dispose();
    for(const binding of bindings)binding.dispose();field?.dispose();
  }
  try{
    mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
    field=await createLiveLogHeatGpu({renderer,mesh,bounds,disintegrate:true});
    const converted=(Array.isArray(original)?original:[original]).map(material=>{
      const binding=createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:LIVE_LOG_HEAT_IDENTITY,presenceNode:field.stateNode.w});
      bindings.push(binding);return binding.material;
    });
    mesh.material=Array.isArray(original)?converted:converted[0];syncAppearance();
    const coverage={owner:mesh,read:()=>({...field.residentState(),texture:field.texture,device:field.device,revision:field.read().generation+':'+field.read().steps})};
    releases.push(bindResidentLightCoverage(mesh,coverage));
    debris=await createLogDebrisGpu({renderer,field,ground:ground(),onFrame,thermalControls:bindings[0]?.thermalControls});
    releases.push(bindResidentLightCoverage(debris.caps,coverage));debris.caps.castShadow=true;
    // Detached fragments remain world-space presentation, never a separately editable object.
    debris.root.userData.kaminosEditorHelper=true;scene.add(debris.root);
    structure=createSceneBurnStructure({renderer,field,parent:debris.root});
    void structure.configure(entry.burnable.structure===true);
    // Authored surface edits also apply while the fluid is paused; lighting may
    // have installed an outer clone, whose scalar inputs need the same update.
    releases.push(onFrame(()=>{
      structure.present();syncAppearance();
      const displayed=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      bindings.forEach((binding,i)=>binding.update(elapsed,displayed[i]));
    }));
    return {
      object:entry.object,
      setSettings:settings=>{void structure.configure(settings?.structure===true);},
      setAppearance(value){if(bindings.some(binding=>!binding.read().appearanceSelectable))throw Error('No incineration appearance on this material');for(const binding of bindings)binding.setAppearance(value);},
      setMounted(value){debris.root.visible=value;},
      materialMask:()=>field.materialMask(entry.id),
      encodeGasSource:(encoder,frame,gas)=>field.encodeGasSource(encoder,frame,gas),
      encode(encoder,frame){field.encode(encoder,frame);structure.encode(encoder);debris.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);},
      read:()=>({objectId:entry.id,fields:[field.read()],structure:structure.read(),debris:debris.read(),elapsed,physicalWoodCalibration:false,appearance:bindings.map(binding=>binding.read()),
        materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({color:m.color.getHexString(),roughness:m.roughness,metalness:m.metalness}))}),
      snapshot:async()=>({...await debris.snapshot(),structure:await structure.snapshot()}),
      dispose,
    };
  }catch(error){dispose();throw error;}
}
