import {createKilnRecipeStore} from '../../inference-kiln-selection.mjs';
import {FIRE_RENDER_DEFAULTS} from '../../scene-fire-render-settings.mjs';
import {createSceneBloom,checkedSceneBloom} from '../../scene-bloom.mjs';
import {checkedBurnAppearance} from '../../scene-burning-settings.mjs';
import {promptReliefRecord,PROMPT_RELIEF_SOURCE} from '../../inference-kiln-record.mjs';
import {assertSceneSourcesReloadable} from '../../scene-persistence-core.js';
import vm from 'node:vm';
import {createSceneAOState} from '../../scene-ao-state.mjs';
import {createSceneRecordOperations} from '../../scene-record-operations.mjs';
import {createSceneDocumentSession} from '../../scene-document-session.mjs';
import {createSceneLoadRequests} from '../../scene-load-generation.mjs';
import {planSceneRestore} from '../../scene-persistence-core.js';
import {compositionRestoreUrl,savedSceneLocation} from '../../scene-authoring.mjs';
import {readOwnerExperimentAddress} from '../../owner-experiment-entry.mjs';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const recordStart=page.indexOf('const sceneRecords = createSceneRecordOperations(');
const recordEnd=page.indexOf('\n});',recordStart)+4;
if(recordStart<0||recordEnd<recordStart)throw Error('Missing production scene-record installation');
const recordInstallation=page.slice(recordStart,recordEnd).replace('const sceneRecords =','globalThis.sceneRecords =');

// Domain-unit fixture adapter. These tests deliberately stub the scene service
// while exercising extracted page consumers. Ownership/integration tests use
// createWorkingScene itself; this double is not evidence for its invariants.
export function sceneContext(context, options) {
  context.checkedBurnAppearance??=checkedBurnAppearance;
  context.createKilnRecipeStore??=createKilnRecipeStore;
  // This domain fixture does not assemble the Rendering panel. Its controls
  // are exercised by their owner tests and the native saved-kiln consumer.
  context.readFireRendering??=()=>structuredClone(FIRE_RENDER_DEFAULTS);
  context.restoreFireRendering??=()=>{};
  context.promptEditTargets??=new Set();
  context.checkedSceneBloom??=checkedSceneBloom;context.bloomControls??=null;
  context.sceneBloom??=createSceneBloom({rebuild(){},redraw(){}});
  context.sceneAO ??= createSceneAOState();
  context.promptReliefRecord??=promptReliefRecord;context.PROMPT_RELIEF_SOURCE??=PROMPT_RELIEF_SOURCE;context.assertSceneSourcesReloadable??=assertSceneSourcesReloadable;
  context.sceneComponents ??= null;
  if(context.document){context.document.body ??= {dataset:{}};context.document.body.dataset ??= {};}
  if (!context.workingScene) {
    context.sceneObjects ??= [];
    context.sceneGroups ??= [];
    context.sceneSelection ??= {ids:[],activeId:null};
    const retained=context.retainedSceneMembershipObjects ?? new Map();
    const disposers=context.retainedSceneMembershipDisposers ?? new WeakMap();
    const service={
      get objects(){return context.sceneObjects;},
      get groups(){return context.sceneGroups;},
      get selection(){return context.sceneSelection;},
      get activeObjectId(){return context.activeSceneObjectId??null;},
      get activeGroupId(){return context.activeSceneGroupId??null;},
      get activeFieldId(){return context.activeSceneFieldId??null;},
      get generation(){return context.sceneMutationToken??0;},
      find:id=>context.sceneObjects.find(row=>row.id===id),
      findRoot:root=>context.sceneObjects.find(row=>row.object===root),
      replaceObjects:rows=>context.sceneObjects=rows,
      put(record,{index=null}={}){context.sceneObjects=context.sceneObjects.filter(row=>row.id!==record.id);context.sceneObjects.splice(index??context.sceneObjects.length,0,record);return record;},
      forget(id){const row=service.find(id);context.sceneObjects=context.sceneObjects.filter(row=>row.id!==id);return row;},
      move(id,index){return service.put(service.find(id),{index});},
      reorder:ids=>context.sceneObjects=ids.map(service.find),
      setGroups(rows){context.sceneGroups=structuredClone(rows);for(const row of context.sceneObjects){row.groupId=rows.find(g=>g.objectIds.includes(row.id))?.id??null;if(row.object?.userData?.kaminosSceneObject)row.object.userData.kaminosSceneObject.groupId=row.groupId;}},
      updateGroup(id,patch){const group=context.sceneGroups.find(g=>g.id===id);Object.assign(group,patch);return group;},
      pruneGroups(){service.setGroups(context.sceneGroups.map(g=>({...g,objectIds:g.objectIds.filter(id=>service.find(id))})).filter(g=>g.objectIds.length));},
      select(ids,activeId=ids.at(-1)??null){context.sceneSelection={ids:[...ids],activeId};context.activeSceneFieldId=['flame-field','water-field'].includes(activeId)?activeId:null;context.activeSceneGroupId=activeId?.startsWith('@group:')?activeId.slice(7):null;context.activeSceneObjectId=context.activeSceneFieldId||context.activeSceneGroupId?null:activeId;},
      pruneSelection({fields=[]}={}){const ids=context.sceneSelection.ids.filter(id=>service.find(id)||context.sceneGroups.some(g=>'@group:'+g.id===id)||fields.includes(id));service.select(ids,ids.includes(context.sceneSelection.activeId)?context.sceneSelection.activeId:ids.at(-1)??null);},
      clearSelection(){service.select([]);},
      clearMembership(){context.sceneObjects=[];context.sceneGroups=[];service.clearSelection();},
      invalidateArrivals(){return context.sceneMutationToken=(context.sceneMutationToken??0)+1;},
      arrival(){const generation=service.generation;return {isCurrent:()=>service.generation===generation,assertCurrent(){if(service.generation!==generation)throw Error('Scene changed while preparing the asset');}};},
      retain(row,dispose){retained.set(row.id,row);if(dispose)disposers.set(row.object,dispose);},
      retained:id=>retained.get(id),retainedObjects:()=>[...retained.values()],
      releaseUnreferenced(referenced,dispose){for(const [id,row] of retained){if(referenced(id))continue;retained.delete(id);const release=disposers.get(row.object)||dispose;disposers.delete(row.object);if(!context.sceneObjects.some(item=>item.id===id&&item.object===row.object))release(row.object,row);}},
    };
    context.workingScene=service;
  }
  context.sceneMembership ??= {
    admit: (record,options) => context.workingScene.put(record,options),
    retainForHistory(id,target){context.compoundRetentionTargets?.set(id,target);},
    clearHistoryTargets(){for(const id of context.sceneMembershipEditTargets??[])context.scenePlacementTools.edits.unregister(id);context.sceneMembershipEditTargets?.clear();context.compoundRetentionTargets?.clear();},
  };
  context.sceneMembershipBatch ??= {clearHistoryTargets(){},attachHistory(){}};
  const result=vm.createContext(context,options);
  if(!context.sceneRecords){context.createSceneRecordOperations=createSceneRecordOperations;vm.runInContext(recordInstallation,result);}
  if(!context.sceneDocument)composePageDocumentSession(result);
  return result;
}

// Install the actual page's document owner and its explicit adapters. Legacy
// fixture fields seed initial state only; production has no mutable flag aliases.
export function composePageDocumentSession(context) {
  context.createSceneDocumentSession=createSceneDocumentSession;
  context.sceneLoadRequests??=context.workingScene?.loads??createSceneLoadRequests();
  context.planSceneRestore??=planSceneRestore;
  context.compositionRestoreUrl??=compositionRestoreUrl;
  context.savedSceneLocation??=savedSceneLocation;
  context.readOwnerExperimentAddress??=readOwnerExperimentAddress;
  context.authoringWorkspace??=null;
  context.isCompositionAuthoring??=()=>false;
  context.FLAME_EMITTER_TYPE??='flame-emitter';
  context.setInfo??=()=>{};
  context.grBrowseScenes??=()=>{};
  context.URL??=URL;context.URLSearchParams??=URLSearchParams;
  context.location??={};context.location.origin??='http://localhost:9000';
  context.location.href??=context.location.origin+'/'+(context.location.search??'')+(context.location.hash??'');
  context.history??={replaceState(_state,_title,url){context.location.href=String(url);}};
  const a=page.indexOf('function createPageSceneDocumentSession('),b=page.indexOf('\nconst sceneDocument =',a);
  if(a<0||b<a)throw Error('Missing production document-session installation');
  vm.runInContext(page.slice(a,b),context);
  context.sceneDocument=context.createPageSceneDocumentSession({filename:context.currentSceneFile??null,blocked:context.sceneSaveBlockedByFailedRestore??false});
  return context.sceneDocument;
}

export function runInSceneContext(code, context, options) {
  return vm.runInContext(code,sceneContext(context),options);
}

// Domain-unit composition: exercise the imported compound algorithm with the
// production page's domain adapters. Root lifecycle stays an explicit fixture;
// working-scene/Workbench integration tests exercise real retention separately.
export async function composePageMembershipBatch(context, html) {
  const {createSceneMembershipBatch}=await import('../../scene-membership-batch.mjs');
  sceneContext(context);
  context.createSceneMembershipBatch=createSceneMembershipBatch;
  context.serializeSceneObject??=row=>structuredClone({...row,object:undefined});
  context.isReloadableSceneObjectRecord??=()=>true;
  context.serializeSceneGroups??=()=>structuredClone(context.workingScene.groups);
  context.normalizeFlameDomainTranslation??=value=>value;
  context.normalizeFlameDomainScale??=value=>value;
  context.canDuplicateObject??=()=>false;
  context.createSceneGroupForObjects??=()=>{};
  context.ensureGroupTarget??=()=>{};
  context.clearActiveSceneObjectSelection??=()=>context.setSceneSelection([],null);
  context.sceneMembership.reconstruct??=async record=>{
    const entry=context.workingScene.retained(record.id);
    if(entry){context.workingScene.put(entry);context.setSceneObjectMounted?.(entry,true);}
    else await context.addSceneObjectFromSource(record);
    return context.workingScene.find(record.id);
  };
  for(const name of ['createPageSceneMembershipBatch','applyCompoundSceneRecord','restoreCompoundSceneContext']){
    const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;
    if(a<0||b<a)throw Error('Missing production '+name);
    vm.runInContext(html.slice(a,b),context);
  }
  context.sceneMembershipBatch=context.createPageSceneMembershipBatch();
  return context.sceneMembershipBatch;
}

// Page lifecycle/domain composition. This adapter does not claim ownership
// invariants; the lifecycle and preview tests use the real working-scene owner.
export async function composePageSceneLifecycle(context,html){
 const {createSceneLifecycle}=await import('../../scene-lifecycle.mjs');sceneContext(context);
 context.workingScene.loads??=context.sceneLoadRequests;
 context.workingScene.suspendedObjects??=()=>[];
 context.workingScene.discardSuspendedMembership??=()=>null;
 for(const name of ['setSceneObjectMounted','setSceneGroupsFromRecords','setSceneSelection','setActiveSceneObject','setActiveSceneGroup'])context[name]??=()=>{};
 context.createSceneLifecycle=createSceneLifecycle;
 const a=html.indexOf('function createPageSceneLifecycle('),b=html.indexOf('function loadTexture(',a);
 const c=html.indexOf('function restoreLoadedSceneRecord('),d=html.indexOf('async function loadSceneObjects(',c);
 if(a<0||b<a||c<0||d<c)throw Error('Missing production scene lifecycle adapters');
 vm.runInContext(html.slice(c,d),context);
 vm.runInContext(html.slice(a,b).replace('const sceneLifecycle=createPageSceneLifecycle();',''),context);
 context.sceneLifecycle=context.createPageSceneLifecycle();return context.sceneLifecycle;
}
