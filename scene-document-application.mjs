import {planSceneRestore} from './scene-persistence-core.js';
import {createSceneDocumentSession} from './scene-document-session.mjs';

export function createSceneDocumentApplication({runtime,assertSupported,prepareDocument,beforeReplace,afterReplace,documentServices={}}={}){
 for(const [name,service] of Object.entries({assertSupported,prepareDocument,beforeReplace,afterReplace,readAddress:documentServices.readAddress})){
  if(typeof service!=='function')throw Error(`Scene document application requires ${name}`);
 }
 const requests=runtime.workingScene.loads;
 function check(meta){
  meta.context?.assertCurrent();
  if(!requests.isCurrent(meta.requestId))throw Error('Scene document superseded');
 }
 const session=createSceneDocumentSession({...documentServices,requests,records:runtime.records,requiresNavigation:()=>false,
  planRestore(data,options){
   const plan=planSceneRestore(data,options);runtime.assertLoadable(plan.objects);
   const supported=assertSupported(data,plan);
   if(supported&&typeof supported.then==='function'){Promise.resolve(supported).catch(()=>{});throw TypeError('Document support checks must be synchronous');}
   if(supported===false)throw Error('Scene document support refused');
   return plan;
  },
  async apply(data,plan,meta){
   check(meta);await prepareDocument(data,plan,meta);check(meta);
   const extra=await beforeReplace(data,plan,meta);check(meta);
   const applied=await runtime.replace(plan.objects,{context:meta.context,loadRequestId:meta.requestId,
    activeId:plan.activeObjectId,activeGroupId:plan.activeGroupId,groups:plan.groups,
    setup:{...extra,materialLibrary:plan.materialLibrary,water:plan.localLiquid,
     flame:{composition:plan.composition,sourcePresent:plan.flameSourcePresent},startupLodHint:data.lodPreparation,startupGroups:plan.groups}});
   check(meta);if(!applied)return false;
   await afterReplace(data,plan,meta);check(meta);runtime.restoreSelection(data,plan);return true;
  },
 });
 const read=()=>({...runtime.snapshot(),document:session.state()});
 const commands={
  async 'scene.applyDocument'({document,sceneFile=null,emptySettings=false}={},context){
   context.assertCurrent();
   const result=await session.restore({json:async()=>document},{sceneFile,mounted:true,emptySettings,applyContext:context});
   context.assertCurrent();
   if(!result.ok)throw Error(result.stale?'Scene document superseded or stale':result.error);
   return {applied:true,...read()};
  },
  'scene.read'(_input,context){context.assertCurrent();return read();},
 };
 return Object.freeze({commands:Object.freeze(commands),session,read});
}
