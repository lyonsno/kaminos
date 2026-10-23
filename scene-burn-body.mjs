import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';
import {createLogBurnIndicator} from './live-log-indicator.mjs';
import {createLogDebrisGpu} from './log-debris-gpu.mjs';
import {resolveBurnableTarget} from './burnable-target.mjs';
import {bindResidentLightCoverage} from './scene-resident-coverage.mjs';

const sourceMaterials=new WeakMap();
export const originalBurnMaterial=material=>sourceMaterials.get(material)??material;

// An object's material owns its state; it never switches sources, clocks or domains.
export async function createSceneBurnBody({entry,renderer,scene,ground,onFrame,document}){
  resolveBurnableTarget([entry],entry.id);
  let mesh;entry.object.traverse(node=>{if(node.isMesh)mesh=node;});
  const original=mesh.material,bindings=[],releases=[];
  let field,debris,indicator,elapsed=0,disposed=false;
  function dispose(){
    if(disposed)return;disposed=true;
    indicator?.dispose();for(const release of releases)release();
    mesh.material=original;debris?.dispose();
    for(const binding of bindings){sourceMaterials.delete(binding.material);binding.dispose();}field?.dispose();
  }
  try{
    mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
    field=await createLiveLogHeatGpu({renderer,mesh,bounds,disintegrate:true});
    const converted=(Array.isArray(original)?original:[original]).map(material=>{
      const binding=createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:LIVE_LOG_HEAT_IDENTITY,presenceNode:field.stateNode.w});
      sourceMaterials.set(binding.material,material);bindings.push(binding);return binding.material;
    });
    mesh.material=Array.isArray(original)?converted:converted[0];
    const coverage={owner:mesh,read:()=>({...field.residentState(),texture:field.texture,device:field.device,revision:field.read().generation+':'+field.read().steps})};
    releases.push(bindResidentLightCoverage(mesh,coverage));
    debris=await createLogDebrisGpu({renderer,field,ground:ground(),onFrame});
    releases.push(bindResidentLightCoverage(debris.caps,coverage));debris.caps.castShadow=true;
    // Detached fragments remain world-space presentation, never a separately editable object.
    debris.root.userData.kaminosEditorHelper=true;scene.add(debris.root);
    indicator=createLogBurnIndicator({object:entry.object,fields:[field],document,fitObject:true});
    return {
      object:entry.object,
      setMounted(value){debris.root.visible=value;},
      materialMask:()=>field.materialMask(entry.id),
      encodeGasSource:(encoder,frame,gas)=>field.encodeGasSource(encoder,frame,gas),
      encode(encoder,frame){field.encode(encoder,frame);debris.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);},
      read:()=>({objectId:entry.id,fields:[field.read()],debris:debris.read(),elapsed,physicalWoodCalibration:false}),
      snapshot:()=>debris.snapshot(),
      dispose,
    };
  }catch(error){dispose();throw error;}
}
