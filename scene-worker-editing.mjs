import {checkedPose} from './scene-edit-session.mjs';
import {createSceneMaterialOperations} from './scene-material-operations.mjs';

// One ordered semantic operation may prepare resources asynchronously. Only
// its live writes enter the existing synchronous foreground service. The page
// and asset drawer consume the same commands and accepted scene projection.
export function createSceneWorkerEditing({ordinary,edits,projection,materialDefinitions=[]}) {
 const {workingScene:scene,authored}=ordinary;
 let context=null,lastReceipt=null,insideCommit=false,materialGesture=null;
 const current=()=>{if(!context)throw Error('Scene editing requires its ordered operation context');context.assertCurrent();};
 async function prepare(run){
  current();
  return context.withFrames(async()=>{current();const value=await run();current();return value;},{foregroundEdits:false});
 }
 async function commit(run){
  current();
  const receipt=await context.commitForeground(()=>{
   insideCommit=true;try{return run();}finally{insideCommit=false;}
  });
  lastReceipt=receipt;
  return receipt.value;
 }
 const write=run=>context&&!insideCommit?commit(run):run();
 const materialTarget='@scene-materials';
 edits.register(materialTarget,{read:ordinary.materials.read,check:ordinary.materials.check,
  write(value){
   if(!context||insideCommit)return ordinary.materials.write(value);
   return (async()=>{await prepare(()=>ordinary.materials.prepare(value));return commit(()=>ordinary.materials.write(value));})();
  }});
 const materialOperations=createSceneMaterialOperations({materials:ordinary.materials,definitions:materialDefinitions,
  selected:id=>scene.find(id??scene.selection.activeId),assertAvailable:current,prepare,
  apply:(value,label)=>commit(()=>{
   try{return edits.apply(materialTarget,value,label);}
   catch(error){if(edits.state().active?.id===materialTarget)edits.cancel();throw error;}
  })});
 const gesture=input=>{
  if(!materialGesture||input?.gestureId!==materialGesture.id||scene.generation!==materialGesture.generation||edits.state().active?.id!==materialTarget)throw Error('Material gesture is stale or absent');
  return materialGesture;
 };
 const foregroundCommands={
  'scene.materialBegin'(input,ctx){
   ctx.assertCurrent();if(!ordinary.materials.recipe(input.recipeId))throw Error('Material missing');
   edits.begin(materialTarget,input.label??'Edit material');
   materialGesture={id:crypto.randomUUID(),recipeId:input.recipeId,generation:scene.generation,requestId:ctx.requestId};
   return {gestureId:materialGesture.id,ui:projection()};
  },
  'scene.materialPreview'(input,ctx){
   ctx.assertCurrent();const active=gesture(input);if(input.recipeId!==active.recipeId)throw Error('Material gesture belongs to another recipe');
   const next=ordinary.materials.read(),recipe=next.recipes.find(row=>row.id===active.recipeId),definition=materialDefinitions.find(row=>row.id===recipe.implementation);
   const before=definition.resourceKey?.(recipe.parameters);
   if(input.patch.name!==undefined)recipe.name=input.patch.name;
   if(input.patch.parameters)recipe.parameters={...recipe.parameters,...input.patch.parameters};
   if(before!==definition.resourceKey?.(recipe.parameters))throw Error('Material source changes require the prepared material edit operation');
   edits.preview(next);return {ui:projection()};
  },
  'scene.materialCommit'(input,ctx){ctx.assertCurrent();gesture(input);edits.commit();materialGesture=null;return {ui:projection()};},
  'scene.materialCancel'(input,ctx){ctx.assertCurrent();gesture(input);edits.cancel();materialGesture=null;return {ui:projection()};},
 };
 async function operation(ctx,run){
  if(context)throw Error('Another ordered scene edit is active');
  ctx.assertCurrent();context=ctx;lastReceipt=null;
  try{
   const value=await run();current();
   return {...value,ui:projection(),mutationApplied:lastReceipt?.mutationApplied===true};
  }catch(error){
   if(lastReceipt?.mutationApplied===true&&!Object.hasOwn(error,'mutationApplied'))error.mutationApplied=true;
   if(error.mutationApplied===true)try{context.report({ui:projection()});}catch{/* canceled contexts cannot publish; the page can query accepted state */}
   throw error;
  }finally{context=null;lastReceipt=null;}
 }
 function sourceRecord(input){
  if(!input||typeof input.source!=='string')throw Error('Scene Add requires a retained mesh source');
  const assetOrigin={...structuredClone(input.assetOrigin??{}),...(input.provenance!==undefined?{provenance:structuredClone(input.provenance)}:{})};
  const record=authored.records.normalize({...input,id:`glb:${crypto.randomUUID()}`,type:'glb',
   fileName:input.fileName??'object.glb',label:input.label??input.fileName??'Mesh',
   transform:checkedPose(input.transform??{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),
   ...(Object.keys(assetOrigin).length?{assetOrigin}:{})});
  authored.assertLoadable([record]);return record;
 }
 async function insert(record,{bindings=[]}={}){
  let prepared;
  try{
   await prepare(async()=>{prepared=await authored.membership.prepareReconstruction(record);});
   await commit(()=>{
    const entry=prepared.commit();
    if(bindings.length)ordinary.materials.restoreBindings(entry,bindings);
    scene.select([entry.id],entry.id);
    authored.membership.recordInsertion(entry.id);
   });
   return {objectId:record.id};
  }finally{prepared?.dispose();}
 }
 const commands={
  'scene.importAsset':(input,ctx)=>operation(ctx,()=>insert(sourceRecord(input))),
  'scene.remove':(input,ctx)=>operation(ctx,async()=>{
   const id=input?.id??scene.selection.activeId;
   if(!id||!scene.find(id))throw Error('Choose a scene object to remove');
   if(scene.find(id).type!=='glb')throw Error('Remove this source through its domain owner');
   await commit(()=>{if(authored.membership.remove(id)===false)throw Error('Scene removal was refused');});
   return {objectId:id};
  }),
  'scene.duplicate':(input,ctx)=>operation(ctx,()=>{
   const id=input?.id??scene.selection.activeId;
   const entry=scene.find(id);if(!entry)throw Error('Choose a scene object to duplicate');
   if(entry.type!=='glb')throw Error('Duplicate this source through its domain owner');
   const record=authored.records.serialize(entry);
   return insert(sourceRecord({...record,label:`${entry.label??entry.fileName} copy`}),{bindings:ordinary.materials.bindings(id)});
  }),
  'scene.undo':(_input,ctx)=>operation(ctx,async()=>({changed:await edits.undo()})),
  'scene.redo':(_input,ctx)=>operation(ctx,async()=>({changed:await edits.redo()})),
  'scene.editorState':(_input,ctx)=>operation(ctx,async()=>({})),
  'scene.materialCreate':(input,ctx)=>operation(ctx,async()=>({recipeId:await materialOperations.create(input)})),
  'scene.materialEdit':(input,ctx)=>operation(ctx,async()=>({changed:await materialOperations.edit(input.recipeId,input.patch)})),
  'scene.materialAssign':(input,ctx)=>operation(ctx,async()=>({changed:await materialOperations.assign(input)})),
  'scene.materialUnique':(input,ctx)=>operation(ctx,async()=>({recipeId:await materialOperations.makeUnique(input)})),
  'scene.materialSources':(input,ctx)=>operation(ctx,async()=>{
   const definition=materialDefinitions.find(row=>row.id===input.implementation);if(!definition?.sources)throw Error('Material checkpoint catalogue is unavailable');
   return {sources:await prepare(()=>definition.sources())};
  }),
 };
 function materialProjection(){
  const entry=scene.find(scene.selection.activeId);
  return {...ordinary.materials.document(),objectId:entry?.id??null,
   gesture:materialGesture&&edits.state().active?.id===materialTarget?{gestureId:materialGesture.id,recipeId:materialGesture.recipeId,requestId:materialGesture.requestId}:null,
   slots:ordinary.materials.slots(entry).map(({key,label,recipeId,base})=>({key,label,recipeId,nodeMaterial:base?.isNodeMaterial===true})),
   definitions:materialDefinitions.map(({id,version,title,description,fields,sources})=>({id,version,title,description,fields:structuredClone(fields),hasSources:typeof sources==='function'}))};
 }
 return Object.freeze({prepare,commit,write,materialProjection,clear:()=>{materialGesture=null;},foregroundCommands:Object.freeze(foregroundCommands),constructionContext:()=>{current();return context;},commands:Object.freeze(commands)});
}
