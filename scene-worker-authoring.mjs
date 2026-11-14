import {createSceneEdits,checkedPose} from './scene-edit-session.mjs';
import {sceneObjectTransformState,applySceneObjectTransformState} from './scene-object-state.mjs';
import {changeSelection} from './scene-selection.mjs';
import {assemblySelection} from './scene-assembly.mjs';
import {pickSceneWorkerObject} from './scene-worker-picking.mjs';
import {createSceneWorkerEditing} from './scene-worker-editing.mjs';

// Authored state stays with the real worker registry. The page receives plain
// records only, and these synchronous edits use the existing Kit boundaries.
export function createSceneWorkerAuthoring({THREE,ordinary,fields=()=>[],checkTransform=()=>{},changed=()=>{},editing=false,materialDefinitions=[]}){
 const scene=ordinary.workingScene;
 let workflow=null;
 function entry(id){const row=scene.find(id);if(!row)throw Error('Scene object is absent: '+id);return row;}
 function validate(id,value){const row=entry(id),pose=checkedPose(value);if(row.type!=='glb')checkTransform(row,pose);return pose;}
 const edits=createSceneEdits({read:id=>sceneObjectTransformState(entry(id).object),write(id,value){
  const apply=()=>{const pose=validate(id,value),root=entry(id).object;applySceneObjectTransformState(root,pose);root.updateWorldMatrix(true,true);};
  return workflow?workflow.write(apply):apply();
 },changed});
 function projection(){
  const snapshot=ordinary.authored.snapshot(),box=new THREE.Box3();
  const ids=new Set(snapshot.selection.ids.flatMap(id=>id.startsWith('@group:')?scene.groups.find(g=>g.id===id.slice(7))?.objectIds??[]:[id]));
  for(const row of scene.objects)if(ids.has(row.id))box.expandByObject(row.object);
  return {...snapshot,fields:fields(),bounds:ordinary.readBounds(),selectionBounds:box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()},history:edits.state(),...(workflow?{materials:workflow.materialProjection()}:{})};
 }
 const reply=()=>({ui:projection()});
 if(editing){workflow=createSceneWorkerEditing({ordinary,edits,projection,materialDefinitions});ordinary.authored.membership.attachHistory(edits);}
 const commands={
  'scene.pick'(input,ctx){ctx.assertCurrent();if(typeof input?.extend!=='boolean')throw Error('Picking extension must be Boolean');const id=pickSceneWorkerObject({THREE,ordinary,input});
   const target=assemblySelection({ids:id?[id]:[],activeId:id},scene.groups).activeId;
   const selected=!target&&input.extend?scene.selection:changeSelection(scene.selection,target,{extend:input.extend});
   scene.select(selected.ids,selected.activeId,fields().map(f=>f.id));changed();return {...reply(),pickedId:id};},
  'scene.select'({ids,activeId=ids?.at(-1)??null}={},ctx){ctx.assertCurrent();if(!Array.isArray(ids))throw Error('Selection requires scene IDs');const next=assemblySelection({ids,activeId},scene.groups);scene.select(next.ids,next.activeId,fields().map(f=>f.id));changed();return reply();},
  'scene.transform'({id,transform}={},ctx){ctx.assertCurrent();const pose=validate(id,transform);edits.apply(id,pose,'Transform '+(entry(id).label??id));return reply();},
  'scene.transformComponent'({id,field,value}={},ctx){ctx.assertCurrent();const [group,axis]=String(field).split('.'),index={x:0,y:1,z:2}[axis];if(!['position','rotation','scale'].includes(group)||index===undefined||!Number.isFinite(value))throw Error('Transform component requires a valid field and finite value');const pose=sceneObjectTransformState(entry(id).object);pose[group][index]=value;edits.apply(id,validate(id,pose),'Edit '+field);return reply();},
  'scene.undo'(_input,ctx){ctx.assertCurrent();edits.undo();return reply();},
  'scene.redo'(_input,ctx){ctx.assertCurrent();edits.redo();return reply();},
 };
 if(workflow){delete commands['scene.undo'];delete commands['scene.redo'];}
 return Object.freeze({projection,clear(){edits.clear();workflow?.clear();if(workflow)ordinary.authored.membership.clearHistoryTargets();},
  assertSettled(){if(edits.state().active||edits.state().replaying)throw Error('Finish the active scene edit before saving');},
  prepare:run=>workflow.prepare(run),commit:run=>workflow.commit(run),constructionContext:()=>workflow.constructionContext(),
  asyncCommands:workflow?.commands??{},commands:Object.freeze({...commands,...workflow?.foregroundCommands})});
}
