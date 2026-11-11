import {createWorkingScene} from './working-scene.mjs';
import {createSceneRecordOperations} from './scene-record-operations.mjs';
import {createSceneObjectRecord} from './scene-object-record.mjs';
import {createSceneMembershipOperations} from './scene-membership-operations.mjs';
import {createSceneLifecycle} from './scene-lifecycle.mjs';

export function registerAuthoredSceneObject(object,metadata={},services,{activate=true}={}){
 const id=String(metadata.id||services.createId(metadata.type||'object'));
 const sceneTransform=metadata.type==='splat'?services.copyTransform(metadata.sceneTransform||metadata.transform||services.readTransform(object)):null;
 const record=createSceneObjectRecord(object,metadata,{id,sceneTransform});
 const admitted=services.membership().admit(record,{activate,
  group:metadata.groupLabel?{label:metadata.groupLabel,source:metadata.groupSource??metadata.source,select:false}:null});
 services.changed?.();return admitted;
}

export function restoreAuthoredSceneRecord(entry,record,services){
 if(record.transform){
  if(entry.type==='splat'){services.splatPose(entry,record.sceneTransform||record.transform);services.splatCorrection(entry);}
  else if(entry.type==='flame-emitter')services.flamePose(entry.id,record.transform);
  else services.transform(entry.object,record.transform);
 }
 services.materials(entry.object,record.materials);
 services.removeStandIn?.(record.id);
 if(record.groupId)services.group?.(entry,record.groupId);
}

// Domain constructors and rendering remain caller services. The registry,
// source dispatch and replacement use the same owners as the ordinary page.
export function createAuthoredSceneRuntime({scene,workingScene=createWorkingScene(),readers,createLoaders,roots,
 membership:membershipOptions={},replacement={},assertRecordSupported}={}){
 if(typeof scene?.add!=='function'||typeof scene?.remove!=='function')throw Error('Authored scene requires its actual scene roots');
 for(const [name,value] of Object.entries({createLoaders,assertRecordSupported,restore:roots?.restore,dispose:roots?.dispose,
  readTransform:readers?.transform,readMaterials:readers?.materials}))if(typeof value!=='function')throw Error(`Authored scene requires ${name}`);
 let membership;
 const contexts=new Map(),fields=()=>replacement.selection?.fields?.()??[];
 const select=(ids,activeId)=>workingScene.select(ids,activeId,fields());
 const selection={set:select,object:id=>select(id?[id]:[],id??null),group:id=>select(['@group:'+id],'@group:'+id),...replacement.selection};
 const registerSceneObject=(object,metadata,options)=>registerAuthoredSceneObject(object,metadata,{
  createId:kind=>`${kind}:${crypto.randomUUID()}`,readTransform:readers.transform,copyTransform:structuredClone,
  membership:()=>membership,changed:membershipOptions.authoringChanged},options);
 const loaders=createLoaders({workingScene,registerSceneObject});
 const records=createSceneRecordOperations({readers,loaders});
 const assertLoadable=values=>{records.assertReloadable(values);for(const record of values){
  const supported=assertRecordSupported(record,loaders);
  if(supported&&typeof supported.then==='function'){Promise.resolve(supported).catch(()=>{});throw TypeError('Record support checks must be synchronous');}
  if(supported===false)throw Error(`Scene record support refused: ${record.id}`);
 }};
 const rootServices={attach:entry=>scene.add(entry.object),detach:entry=>scene.remove(entry.object),
  mount:(entry,mounted)=>mounted?scene.add(entry.object):scene.remove(entry.object),...roots};
 membership=createSceneMembershipOperations({...membershipOptions,scene:workingScene,records,roots:rootServices,select:selection.set});
 const prior=replacement.context??{};
 const check=id=>{contexts.get(id)?.assertCurrent();};
 const lifecycle=createSceneLifecycle({scene:workingScene,roots:rootServices,
  records:{prepare:replacement.prepare,releasePrepared:replacement.releasePrepared,
   load:async(record,requestId,prepared)=>{
    check(requestId);const context=contexts.get(requestId);
    const object=await records.load(record,{activate:false,loadRequestId:requestId,preparedAsset:prepared?.take(record.id),context,signal:context?.signal,
     isCurrent:()=>workingScene.loads.isCurrent(requestId)&&!context?.signal.aborted});
    check(requestId);return object;
   },restore:replacement.restore??roots.restore},
  groups:replacement.groups??{restore:values=>workingScene.setGroups(values)},selection,
  context:{...prior,
   beforeLoad:async(record,id)=>{check(id);await prior.beforeLoad?.(record,id);check(id);},
   loaded:async(setup,id)=>{check(id);await prior.loaded?.(setup,id);check(id);}},
 });
 async function replace(values,{context,...options}){
  assertLoadable(values);context?.assertCurrent();
  const id=options.loadRequestId;contexts.set(id,context);
  try{return await lifecycle.replace(values,options);}finally{contexts.delete(id);}
 }
 function restoreSelection(data,plan){
  const valid=new Set([...workingScene.objects.map(r=>r.id),...workingScene.groups.map(g=>'@group:'+g.id),...fields()]);
  if(Array.isArray(data.selectionIds)){
   const ids=data.selectionIds.filter(id=>valid.has(id)),active=plan.activeGroupId?'@group:'+plan.activeGroupId:plan.activeObjectId;
   selection.set(ids,ids.includes(active)?active:ids.at(-1)??null);
  }
  if(data.activeFieldId&&fields().includes(data.activeFieldId))selection.set([...new Set([...workingScene.selection.ids,data.activeFieldId])],data.activeFieldId);
 }
 const snapshot=()=>({objects:workingScene.objects.map(records.serialize),groups:structuredClone(workingScene.groups),selection:structuredClone(workingScene.selection)});
 return Object.freeze({workingScene,records,membership,lifecycle,registerSceneObject,assertLoadable,replace,restoreSelection,snapshot});
}
