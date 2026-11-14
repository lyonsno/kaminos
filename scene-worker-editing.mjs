import {checkedPose} from './scene-edit-session.mjs';

// One ordered semantic operation may prepare resources asynchronously. Only
// its live writes enter the existing synchronous foreground service. The page
// and asset drawer consume the same commands and accepted scene projection.
export function createSceneWorkerEditing({ordinary,edits,projection}) {
 const {workingScene:scene,authored}=ordinary;
 let context=null,lastReceipt=null;
 const current=()=>{if(!context)throw Error('Scene editing requires its ordered operation context');context.assertCurrent();};
 async function prepare(run){
  current();
  return context.withFrames(async()=>{current();const value=await run();current();return value;},{foregroundEdits:false});
 }
 async function commit(run){
  current();
  const receipt=await context.commitForeground(run);
  lastReceipt=receipt;
  return receipt.value;
 }
 const write=run=>context?commit(run):run();
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
 };
 return Object.freeze({prepare,commit,write,constructionContext:()=>{current();return context;},commands:Object.freeze(commands)});
}
