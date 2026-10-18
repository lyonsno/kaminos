// Viewport visibility is editor state; source enablement and collision remain
// with their owners. The shared edit ledger owns history for every entry point.
export function checkedHiddenIds(ids = []) {
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id))throw Error('Hidden viewport targets require nonempty scene IDs');
 return [...new Set(ids)];
}
export function visibilityParents(id,{objects=[],groups=[]}) {
 const entry=objects.find(item=>item.id===id),parents=groups.filter(group=>group.objectIds.includes(id)).map(group=>'@group:'+group.id);
 if(entry?.type==='flame-emitter')parents.push('flame-field');
 if(entry?.type==='local-liquid-emitter')parents.push('water-field');
 return parents;
}
export function sceneItemVisible(id,hiddenIds=[],scene={}) {
 const hidden=new Set(hiddenIds);return ![id,...visibilityParents(id,scene)].some(key=>hidden.has(key));
}
// Hide only while submitting the viewport and its depth/color passes. Solver,
// heat, lights, exports and other consumers still see authored object state.
export function withViewportVisibility(objects,visible,render) {
 const restored=[];
 try {for(const entry of objects)if(entry.object&&!visible(entry.id)){restored.push([entry.object,entry.object.visible]);entry.object.visible=false;}return render();}
 finally {for(const [object,prior] of restored)object.visible=prior;}
}
export function visibilityShortcut(event,{activeElement,viewport,outliner,hover=false}={}) {
 if(event.defaultPrevented||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.code!=='KeyH'||event.altKey&&event.shiftKey)return null;
 if([event.target,activeElement].some(node=>node?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')))return null;
 const focused=node=>node&&node!==viewport.ownerDocument.body&&(viewport.contains(node)||outliner?.contains(node));
 if(!hover&&!focused(event.target)&&!focused(activeElement))return null;
 return event.altKey?'showAll':event.shiftKey?'hideUnselected':'hideSelected';
}
export function installSceneVisibility({document,viewport,outliner,edits,scene,readHidden,writeHidden,selection,setSelection,blocked=()=>null,changed=()=>{},onError=()=>{}}) {
 const id='@scene-visibility';let hover=false;
 const visible=key=>sceneItemVisible(key,readHidden(),scene());
 const read=()=>({hiddenIds:checkedHiddenIds(readHidden()),selection:structuredClone(selection())});
 const check=value=>{
  const result=structuredClone(value);result.hiddenIds=checkedHiddenIds(result.hiddenIds);
  if(!Array.isArray(result.selection?.ids)||result.selection.ids.some(key=>typeof key!=='string')||result.selection.activeId!==null&&!result.selection.ids.includes(result.selection.activeId))throw Error('Visibility requires a valid selection');
  return result;
 };
 edits.register(id,{read,check,write:value=>{writeHidden(value.hiddenIds);setSelection(value.selection.ids,value.selection.activeId);changed();}});
 function apply(hiddenIds,label) {
  const reason=blocked();if(reason)throw Error(reason);
  const value=read();value.hiddenIds=checkedHiddenIds(hiddenIds);
  value.selection.ids=value.selection.ids.filter(key=>sceneItemVisible(key,value.hiddenIds,scene()));
  if(!value.selection.ids.includes(value.selection.activeId))value.selection.activeId=value.selection.ids.at(-1)??null;
  edits.apply(id,value,label);return read();
 }
 const targets=()=>{const s=scene();return [...s.fields.map(f=>f.id),...s.groups.map(g=>'@group:'+g.id),...s.objects.map(o=>o.id)];};
 const api={read,visible,
  set(key,show){if(!targets().includes(key))throw Error('Unknown visibility target');if(typeof show!=='boolean')throw Error('Visibility must be Boolean');
   const keys=show?[key,...visibilityParents(key,scene())]:[key],hidden=new Set(readHidden());for(const item of keys)show?hidden.delete(item):hidden.add(item);
   return apply([...hidden],show?'Show in viewport':'Hide in viewport');},
  hideSelected(){const ids=selection().ids;if(!ids.length)return false;return apply([...readHidden(),...ids],'Hide selected');},
  hideUnselected(){const ids=selection().ids;if(!ids.length)return false;const s=scene(),keep=new Set(ids);
   for(const group of s.groups)if(keep.has('@group:'+group.id))for(const member of group.objectIds)keep.add(member);
   for(const field of s.fields)if(keep.has(field.id))for(const entry of s.objects)if(visibilityParents(entry.id,s).includes(field.id))keep.add(entry.id);
   for(const key of [...keep])for(const parent of visibilityParents(key,s))keep.add(parent);
   return apply([...new Set([...readHidden(),...targets().filter(key=>!keep.has(key))])],'Hide unselected');},
  showAll(){return apply([],'Show all');},
 };
 const pointer=event=>{hover=viewport.contains(event.target)&&!event.target.closest?.('button,input,select,summary,details,#scene-command-search');};
 const keydown=event=>{const action=visibilityShortcut(event,{activeElement:document.activeElement,viewport,outliner,hover});if(!action||blocked())return;
  event.preventDefault();event.stopImmediatePropagation();try{api[action]();}catch(error){onError(error);}};
 document.addEventListener('pointermove',pointer,true);document.addEventListener('keydown',keydown,true);
 return api;
}
