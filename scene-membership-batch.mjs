import {captureSceneMembership,resolveSceneMembershipTopology} from './scene-membership-history.mjs';
import {checkedPose} from './scene-edit-session.mjs';
import {checkedGroupPose} from './scene-group.mjs';
import {checkedSelection} from './scene-selection.mjs';
import {checkedRepetition} from './scene-repetition.mjs';

const selectionTarget='@selection-membership';
// Compound authored edits share the individual lifecycle. Live registrations
// are resolved after source-loading awaits and remain owned by their sessions.
export function createSceneMembershipBatch({scene,membership,records,groups,
  context={},select=(ids,activeId)=>scene.select(ids,activeId),
  detach=id=>membership.remove(id,{recordHistory:false,preserveForMembershipHistory:true}),
  changed=()=>{},duplicate,
}) {
  let edits=null;
  const insertionTargets=new Set();
  function capture(){return {...captureSceneMembership(scene.objects.map(records.serialize),records.reloadable),
    groups:groups.serialize(),selection:structuredClone(scene.selection),...context.capture?.()};}
  function check(raw){
    const value=structuredClone(raw);
    if(!Array.isArray(value.objects)||!Array.isArray(value.groups))throw Error('Scene membership records are required');
    const ids=new Set();
    for(const record of value.objects){if(!record.id||ids.has(record.id)||!records.reloadable(record))throw Error('Scene member has no retained source');ids.add(record.id);checkedPose(record.transform);}
    if(value.liveIds!==undefined&&!Array.isArray(value.liveIds))throw Error('Live scene references must be an array');
    for(const id of value.liveIds??[]){if(typeof id!=='string'||!id||ids.has(id))throw Error('Invalid live scene reference');ids.add(id);}
    for(const group of value.groups){checkedGroupPose(group.transform);if(group.objectIds.some(id=>!ids.has(id)))throw Error('Group refers to an absent scene member');}
    checkedSelection(value.selection.ids,value.selection.activeId);context.check?.(value);return value;
  }
  async function apply(value){
    const ids=new Set(value.objects.map(row=>row.id)),current=capture(),live=new Set(current.liveIds);
    if(value.objects.some(record=>live.has(record.id)))throw Error('Cannot restore authored membership over a live scene registration');
    if(current.objects.some(row=>!ids.has(row.id)))select([],null);
    for(const row of current.objects)if(!ids.has(row.id))detach(row.id);
    for(const record of value.objects){
      const entry=scene.find(record.id)??await membership.reconstruct(record);
      records.apply(entry,record);
    }
    const topology=resolveSceneMembershipTopology(value,{...capture(),order:scene.objects.map(row=>row.id)});
    scene.reorder(topology.ids);scene.setGroups(topology.groups);
    for(const group of scene.groups)groups.ensure?.(group);
    context.restore?.(value);
    if(value.field&&!topology.selection.ids.includes(value.field))select([value.field],value.field);
    else select(topology.selection.ids,topology.selection.activeId);
    changed();
  }
  async function write(raw){
    const value=check(raw),before=capture();
    try{await apply(value);}catch(error){
      try{await apply(before);}catch(rollback){throw new AggregateError([error,rollback],'Scene membership restoration and rollback failed');}
      throw error;
    }
  }
  function remove(ids){
    if(!ids.length)return false;
    const before=check(capture());
    if(ids.some(id=>!before.objects.some(record=>record.id===id)))throw Error('Scene member has no retained source; close its owning experiment to remove it');
    edits.assertCanRecordApplied(selectionTarget);
    for(const id of ids)membership.retainForHistory(id,selectionTarget);
    for(const id of ids)detach(id);
    select([],null);edits.recordApplied(selectionTarget,before,capture(),`Remove ${ids.length} selected`);return true;
  }
  function duplicateGroup(id,{interactive=false,start}={}){
    const original=scene.groups.find(group=>group.id===id);if(!original)throw Error('Choose a group');
    const members=original.objectIds.map(member=>scene.find(member));
    if(members.some(entry=>!duplicate.supported(entry)))throw Error('This group contains an emitter whose duplication is not supported; duplicate its mesh members instead');
    const groupId=duplicate.groupId(),copies=[],target=`@group-insertion:${groupId}`;
    edits.assertCanRecordApplied(selectionTarget);
    try{
      for(const entry of members)copies.push(duplicate.object(entry.id));
      duplicate.remap?.(new Map(members.map((entry,i)=>[entry.id,copies[i]])));
      groups.create(copies,`${original.label} copy`,{id:groupId,transform:structuredClone(original.transform),repetition:checkedRepetition(original.repetition)});
    }catch(error){for(const copy of copies)membership.remove(copy,{recordHistory:false});throw error;}
    function snapshot(){
      const group=scene.groups.find(row=>row.id===groupId),present=copies.filter(copy=>scene.find(copy));
      if(!group&&!present.length)return null;if(!group||present.length!==copies.length)throw Error('Incomplete group insertion');
      return {objects:copies.map(copy=>records.serialize(scene.find(copy))),group:structuredClone(group)};
    }
    const selectOriginal=()=>scene.groups.some(group=>group.id===id)?select(['@group:'+id],'@group:'+id):select([],null);
    edits.register(target,{allowMissing:true,read:snapshot,
      check:value=>{if(value===null)return null;if(!Array.isArray(value.objects)||value.objects.length!==copies.length||value.objects.some(row=>!copies.includes(row.id)||!records.reloadable(row))||value.group?.id!==groupId)throw Error('Invalid group insertion');return structuredClone(value);},
      write:async value=>{
        if(value===null){for(const copy of copies)detach(copy);selectOriginal();return;}
        const before=capture();
        try{
          for(const record of value.objects)await membership.reconstruct(record);
          groups.create(copies,value.group.label,{...value.group,id:groupId});
        }catch(error){
          try{await apply(before);}catch(rollback){throw new AggregateError([error,rollback],'Group reconstruction and rollback failed');}
          throw error;
        }
      }});
    insertionTargets.add(target);for(const copy of copies)membership.retainForHistory(copy,target);
    const complete=({commit})=>{
      edits.discard(change=>change.id===`@group:${groupId}`||change.id===`@assembly:${groupId}`);
      if(commit)edits.recordApplied(target,null,snapshot(),'Duplicate group');
      else {for(const copy of copies)membership.remove(copy,{recordHistory:false});selectOriginal();}
    };
    if(interactive){if(!start('translate',complete)){complete({commit:false});throw Error('Could not start group placement');}}
    else complete({commit:true});return groupId;
  }
  function duplicateSelection(roots,members,{interactive=false,start}={}){
    if(members.some(id=>!duplicate.supported(scene.find(id))))throw Error('This selection contains a source whose independent duplication is unsupported');
    const before=check(capture()),copies=new Map(),newRoots=[];edits.assertCanRecordApplied(selectionTarget);
    const revert=()=>{for(const id of copies.values())detach(id);scene.setGroups(before.groups);select(before.selection.ids,before.selection.activeId);membership.releaseUnreferenced();};
    try{
      for(const id of members){const copy=duplicate.object(id);copies.set(id,copy);membership.retainForHistory(copy,selectionTarget);}
      duplicate.remap?.(copies);
      for(const id of roots){
        if(id.startsWith('@group:')){const group=scene.groups.find(row=>row.id===id.slice(7)),copyId=duplicate.groupId();groups.create(group.objectIds.filter(id=>copies.has(id)).map(id=>copies.get(id)),`${group.label} copy`,{id:copyId,transform:structuredClone(group.transform),repetition:checkedRepetition(group.repetition)});newRoots.push('@group:'+copyId);}
        else newRoots.push(copies.get(id));
      }
      select(newRoots,newRoots.at(-1));
    }catch(error){revert();throw error;}
    const complete=({commit})=>{
      edits.discard(entry=>entry.id==='@selection-transform'&&Object.keys(entry.after?.roots||{}).some(id=>newRoots.includes(id)||[...copies.values()].includes(id))||[...copies.values()].includes(entry.id));
      if(commit)edits.recordApplied(selectionTarget,before,capture(),`Duplicate ${members.length} selected`);else revert();
    };
    if(interactive){if(!start('translate',complete)){complete({commit:false});throw Error('Could not start duplicate placement');}}
    else complete({commit:true});return newRoots;
  }
  return Object.freeze({capture,check,apply,write,remove,duplicateGroup,duplicateSelection,
    attachHistory(history){if(edits&&edits!==history)throw Error('Compound membership history is already installed');if(!edits){edits=history;edits.register(selectionTarget,{read:capture,check,write});}},
    clearHistoryTargets(){for(const id of insertionTargets)edits.unregister(id);insertionTargets.clear();},
  });
}
