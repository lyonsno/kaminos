import {Matrix3,Quaternion,Vector3} from './lib/three.core.js';
import {mapBurnRegions} from './burn-structure-core.mjs';
import {createBurnFractureGpu} from './burn-fracture-gpu.mjs';
import {createBurnFractureSurface} from './burn-fracture-replay.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';
import {sceneRadianceSourceMaterial} from './scene-radiance.mjs';
import {burnMechanicsLocalScale} from './burn-fracture-core.mjs';

export function createSceneBurnFracture({renderer,field,structure,debris,parent,ground,materials,
 createDynamics=createBurnFractureGpu,createSurface=createBurnFractureSurface}){
 const {mesh}=field.residentState(),hiddenMaterials=new Map();
 let enabled=false,disposed=false,generation=0,status='off',error=null,pending=null,dynamics=null,surface=null,referenceScale=null;
 function frame(){
  mesh.updateWorldMatrix(true,false);const inverse=mesh.matrixWorld.clone().invert(),g=ground();
  const worldScale=new Vector3().setFromMatrixScale(mesh.matrixWorld),s=worldScale.x;
  if(mesh.matrixWorld.determinant()<=0||Math.max(...worldScale.toArray())-Math.min(...worldScale.toArray())>s*1e-6)throw Error('Live fracture requires positive uniform object scale');
  if(referenceScale!==null&&Math.abs(s-referenceScale)>referenceScale*1e-6)throw Error('Object scale changed: switch Fracture off and on to rebuild mechanics at this size');
  const position=new Vector3(g.center[0],g.height-.05,g.center[2]).applyMatrix4(inverse),scale=new Vector3(),rotation=new Quaternion();inverse.decompose(new Vector3(),rotation,scale);
  return {scale:s,gravity:new Vector3(0,-9.81,0).applyMatrix3(new Matrix3().setFromMatrix4(inverse)).toArray(),support:{position:position.toArray(),quaternion:rotation.toArray(),halfExtents:[g.radius/s,.05/s,g.radius/s],friction:.6}};
 }
 function clear(){field.setRegionMotion(null);debris.setRegionMotion(null);surface?.dispose();surface=null;dynamics?.dispose();dynamics=null;referenceScale=null;for(const [material,visible] of hiddenMaterials)material.visible=visible;hiddenMaterials.clear();}
 function present(){if(!surface)return;mesh.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);surface.mesh.matrix.copy(parent.matrixWorld).invert().multiply(mesh.matrixWorld);surface.mesh.updateWorldMatrix(false,false);}
 async function prepare(token){let candidate,view;try{
  await structure.setRequired(true);if(disposed||token!==generation)return;
  const sections=structure.resident();if(!sections)throw Error(structure.read().error??'Structural material unavailable');
  const {prepared}=sections,state=field.residentState(),mapping=mapBurnRegions(prepared,{...state,bounds:{min:state.bounds.min.toArray(),max:state.bounds.max.toArray()}}),current=frame();
  const local=burnMechanicsLocalScale(prepared,current.scale);referenceScale=current.scale;
  status='compiling';candidate=await createDynamics({renderer,...local,sections,field,regionMapping:mapping,finiteSupports:[current.support],gravity:current.gravity});
  if(disposed||token!==generation){candidate.dispose();return;}
  view=createSurface({renderer,prepared,materials:sections.sourceMaterials?.map(sceneRadianceSourceMaterial)??materials,field,dynamics:candidate,stateIdentity:LIVE_LOG_HEAT_IDENTITY});
  view.mesh.matrixAutoUpdate=false;view.mesh.userData.kaminosEditorHelper=true;
  field.setRegionMotion({device:field.device,count:prepared.cells.length,owners:mapping.owners,matrices:candidate.matrices,wrapper:candidate.wrapper});
  debris.setRegionMotion(field.residentState().regionMotion);
  dynamics=candidate;surface=view;parent.add(surface.mesh);
  // Keep the authored object in collision and selection traversal. Only its
  // superseded draw materials are hidden; the moving surface owns presentation.
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){hiddenMaterials.set(material,material.visible);material.visible=false;}
  present();status='live';
 }catch(cause){candidate?.dispose();view?.dispose();if(disposed||token!==generation)return;clear();error=cause.message;status='failed';}}
 return {
  configure(value){if(disposed||enabled===(value===true))return pending;enabled=value===true;const token=++generation;error=null;
   if(!enabled){clear();void structure.setRequired(false);status='off';pending=null;return;}
   status='preparing';pending=prepare(token);return pending;
  },
  get active(){return status==='live';},
  afterSubmit({dt}){if(status!=='live')return;try{const current=frame();dynamics.setGravity(current.gravity);dynamics.setSupport(0,current.support);dynamics.advance(dt);present();}catch(cause){error=cause.message;status='failed';throw cause;}},
  present,
  update(seconds,appearance){for(const b of surface?.bindings??[]){b.setAppearance(appearance);b.update(seconds);}},
  read:()=>({enabled,status,error,thermal:'live-resident-material',clock:'submitted-fluid-simulation-seconds',mechanics:dynamics?.read()??null,surface:surface?.read()??null,contact:'coarse-surviving-boxes-against-ground; no-piece-self-contact',interaction:'ordinary-whole-object-transforms; no-independent-fragment-grab'}),
  snapshot:()=>dynamics?.snapshot()??null,
  dispose(){if(disposed)return;disposed=true;generation++;clear();status='disposed';},
 };
}
