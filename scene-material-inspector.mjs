import {checkMaterialParameters} from './scene-material-recipes.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
export function installMaterialInspector({document,root,materials,definitions,edits,selected,selection=()=>({ids:[],memberIds:[]}),isEditable=()=>true,assertAvailable,changed,error}){
 const target='@scene-materials',registry=new Map(definitions.map(d=>[d.id,d]));
 edits.register(target,{read:materials.read,write:materials.write,check:materials.check});
 let slotKey=null,renderKey=null,sessions=[],bulkGesture=false;const draftIds=new Map();const pendingSources=new Map();
 const id=()=>globalThis.crypto.randomUUID();
 const apply=(value,label)=>{assertAvailable();try{return edits.apply(target,value,label);}catch(e){if(edits.state().active?.id===target)edits.cancel();throw e;}};
 const bulkTargets=(ids=selection().memberIds)=>{
  const targets=[];let skipped=0;
  for(const objectId of new Set(ids)){
   const entry=selected(objectId),slots=entry&&isEditable(objectId)&&!entry.burnable?.enabled?materials.slots(entry):[];
   if(!slots.length){skipped++;continue;}
   for(const slot of slots)targets.push({objectId,slot:slot.key,recipeId:slot.recipeId});
  }
  return {targets,skipped};
 };
 const bindingKey=b=>JSON.stringify([b.objectId,b.slot]);
 function bulkView(state,ids){
  const {targets:live,skipped}=bulkTargets(ids),bindings=new Map(state.bindings.map(b=>[bindingKey(b),b.recipeId]));
  const targets=live.map(t=>({...t,recipeId:bindings.get(bindingKey(t))??null}));
  const recipesById=new Map(state.recipes.map(r=>[r.id,r]));
  const bound=targets.map(t=>recipesById.get(t.recipeId));
  const fields=bound.length&&bound.every(Boolean)?registry.get(bound[0].implementation).fields.filter(field=>
   bound.every(r=>registry.get(r.implementation).fields.includes(field))
  ).map(field=>{
   const value=bound[0].parameters[field.key],mixed=bound.some(r=>r.parameters[field.key]!==value);
   return {...field,mixed,value:mixed?null:value};
  }):[];
  const recipeId=targets[0]?.recipeId??null,mixed=targets.some(t=>t.recipeId!==recipeId);
  return {targets,skipped,fields,recipeId:mixed?null:recipeId,mixed};
 }
 function editSelectionDocument(state,patch,ids,makeCopyId=id){
   if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)throw Error('Material selection edit requires a parameter patch');
   const next=structuredClone(state),{targets,fields}=bulkView(next,ids);
   if(Object.keys(patch).some(key=>!fields.some(f=>f.key===key)))throw Error('These material parameters are not shared by the selection');
   const selectedKeys=new Set(targets.map(bindingKey));
   let changedAny=false;
   for(const recipe of next.recipes.slice()){
    const bindings=next.bindings.filter(b=>b.recipeId===recipe.id);
    const chosen=bindings.filter(b=>selectedKeys.has(bindingKey(b)));
    if(!chosen.length)continue;
    const parameters=checkMaterialParameters(registry.get(recipe.implementation),{...recipe.parameters,...patch});
    if(Object.keys(patch).every(key=>recipe.parameters[key]===parameters[key]))continue;
    changedAny=true;
    if(chosen.length===bindings.length){recipe.parameters=parameters;continue;}
    const copy={...recipe,id:makeCopyId(recipe.id),name:recipe.name+' · selection',parameters};
    next.recipes.push(copy);
    for(const binding of chosen)binding.recipeId=copy.id;
   }
   return changedAny?next:null;
 }

 const api={
  read:()=>materials.document(),
  slots:objectId=>materials.slots(selectedById(objectId)).map(({key,label,recipeId})=>({key,label,recipeId})),
  readSelection(ids){
   const {targets,...info}=bulkView(materials.read(),ids);
   return {...info,slots:targets.length};
  },
  assignSelection(recipeId,ids){
   const next=materials.read(),{targets}=bulkTargets(ids);
   if(!targets.length)throw Error('Select an editable mesh surface');
   if(recipeId!==null&&!next.recipes.some(r=>r.id===recipeId))throw Error('Material missing');
   const changedTargets=targets.filter(t=>t.recipeId!==recipeId);
   if(!changedTargets.length)return false;
   const affected=new Set(changedTargets.map(bindingKey));
   next.bindings=next.bindings.filter(b=>!affected.has(bindingKey(b)));
   if(recipeId)next.bindings.push(...changedTargets.map(t=>({...t,recipeId})));
   return apply(next,recipeId?'Assign material to selection':'Restore source materials on selection');
  },
  editSelection(patch,ids){
   const next=editSelectionDocument(materials.read(),patch,ids);
   return next?apply(next,'Edit selected material properties'):false;
  },
  create({objectId,slot:requested,implementation='asset-surface',name,parameters:requestedParameters}={}){
   const entry=selectedById(objectId),slots=materials.slots(entry),slot=requested!==undefined?slots.find(s=>s.key===requested):(slots.find(s=>s.key===slotKey)||slots[0]);if(!slot)throw Error('Choose a material slot');
   if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');
   const definition=registry.get(implementation);if(!definition)throw Error('Material implementation unavailable');
   if(definition.prepare)return (async()=>{
    const parameters=checkMaterialParameters(definition,requestedParameters??await definition.defaults());
    await definition.prepare(parameters);assertAvailable();
    if(selectedById(entry.id).object!==entry.object)throw Error('Material target changed while loading');
    return createRecipe(parameters);
   })();
   return createRecipe(checkMaterialParameters(definition,requestedParameters??(implementation==='kiln-glaze'?{}:{color:'#'+(slot.base.color?.getHexString()??'92979c'),roughness:slot.base.roughness??.55,metalness:slot.base.metalness??0})));
   function createRecipe(parameters){
   const recipe={id:id(),name:name||slot.base.name||`${entry.label||'Surface'} finish`,implementation,version:definition.version,parameters};
   const next=materials.read();next.recipes.push(recipe);next.bindings=next.bindings.filter(b=>b.objectId!==entry.id||b.slot!==slot.key);next.bindings.push({objectId:entry.id,slot:slot.key,recipeId:recipe.id});apply(next,'Create material');return recipe.id;
   }
  },
  edit(recipeId,patch){
   if(!patch||typeof patch!=='object')throw Error('Material edit requires a parameter patch');
   const next=materials.read(),recipe=next.recipes.find(r=>r.id===recipeId);if(!recipe)throw Error('Material missing');
   const before=structuredClone(recipe),definition=registry.get(recipe.implementation);
   if(patch.name!==undefined)recipe.name=patch.name;if(patch.parameters)recipe.parameters={...recipe.parameters,...patch.parameters};
   if(definition.prepare&&definition.resourceKey?.(before.parameters)!==definition.resourceKey?.(recipe.parameters)){
    assertAvailable();materials.check(next);const token={};pendingSources.set(recipeId,token);
    return (async()=>{try{
     await definition.prepare(recipe.parameters);
     if(pendingSources.get(recipeId)!==token)return false;
     const current=materials.read(),index=current.recipes.findIndex(r=>r.id===recipeId);
     if(JSON.stringify(current.recipes[index])!==JSON.stringify(before))throw Error('Material changed while loading its checkpoint; choose the checkpoint again');
     current.recipes[index]=recipe;return apply(current,'Change material checkpoint');
    }finally{if(pendingSources.get(recipeId)===token)pendingSources.delete(recipeId);}})();
   }
   return apply(next,'Edit material');
  },
  assign({objectId,slot,recipeId}={}){const entry=selectedById(objectId);if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');if(!materials.slots(entry).some(s=>s.key===slot))throw Error('Material slot missing');const next=materials.read();next.bindings=next.bindings.filter(b=>b.objectId!==entry.id||b.slot!==slot);if(recipeId)next.bindings.push({objectId:entry.id,slot,recipeId});return apply(next,'Assign material');},
  makeUnique({objectId,slot}={}){const entry=selectedById(objectId);if(entry.burnable?.enabled)throw Error('Disable Burning before changing its material');const next=materials.read(),binding=next.bindings.find(b=>b.objectId===entry.id&&b.slot===slot);if(!binding)throw Error('Assign a material first');const recipe=structuredClone(next.recipes.find(r=>r.id===binding.recipeId));recipe.id=id();recipe.name+=' copy';next.recipes.push(recipe);binding.recipeId=recipe.id;apply(next,'Make material unique');return recipe.id;},
 };
 function selectedById(objectId){const entry=objectId?selected(objectId):selected();if(!entry)throw Error('Select a mesh');return entry;}
 const failed=e=>{error(e.message);sync(true);};
 const run=action=>{try{Promise.resolve(action()).catch(failed);}catch(e){failed(e);}};
 function syncBulk(state,bulk){
  const title=document.createElement('h2');title.textContent='Selection materials';root.append(title);
  const note=document.createElement('p');note.textContent=`${bulk.targets.length} editable surface slots${bulk.skipped?` · ${bulk.skipped} items without editable surfaces skipped`:''}. Assignment applies to all these slots.`;root.append(note);
  if(!bulk.targets.length)return;
  const row=document.createElement('label');row.textContent='Assign finish ';
  const select=document.createElement('select');select.id='material-selection-assignment';
  const {Option}=document.defaultView;
  const mixed=new Option('Mixed materials','@mixed');mixed.disabled=true;select.add(mixed);
  select.add(new Option('Source materials',''));
  for(const recipe of state.recipes)select.add(new Option(recipe.name,recipe.id));
  if(bulk.mixed)mixed.selected=true;else select.value=bulk.recipeId??'';
  select.onchange=()=>run(()=>api.assignSelection(select.value||null));
  row.append(select);root.append(row);
  const hint=document.createElement('p');
  hint.textContent=bulk.fields.length?'Property edits affect this selection; shared finishes outside it keep their values.':'Assign a finish or select finishes with common editable properties.';
  root.append(hint);
  for(const field of bulk.fields){
   const row=document.createElement('label');row.className='transform-row';
   const grip=document.createElement('span');grip.textContent=field.label;row.append(grip);
   const input=document.createElement('input');input.type=field.mixed&&field.type==='color'?'text':field.type;input.className='transform-input';input.dataset.selectionMaterialParam=field.key;
   input.setAttribute('aria-label',field.label);input.value=field.mixed?'':field.value;
   if(field.mixed)input.placeholder=field.type==='color'?'Mixed · #RRGGBB':'Mixed';
   for(const key of ['min','max','step'])if(field[key]!==undefined)input[key]=field[key];
   row.append(input);root.append(row);
   const read=()=>field.type==='number'?input.valueAsNumber:input.value;
   if(input.type==='text'){
    input.onchange=()=>run(()=>input.value?api.editSelection({[field.key]:read()}):sync(true));
   }else{
    input.addEventListener('input',()=>run(()=>{
     const active=edits.state().active;
     if(active?.id!==target)return;
     bulkGesture=true;
     if(input.value===''){edits.preview(active.before);return;}
     try{
      const next=editSelectionDocument(active.before,{[field.key]:read()},undefined,recipeId=>{
       if(!draftIds.has(recipeId))draftIds.set(recipeId,id());
       return draftIds.get(recipeId);
      });
      edits.preview(next??active.before);
     }catch(e){edits.preview(active.before);throw e;}
    }));
    sessions.push(installSceneControlHistory({controls:[input],edits,id:target,label:'Edit selected '+field.label,onError:e=>error(e.message)}));
    if(field.type==='number'&&!field.mixed)sessions.push(installRelativeNumberDrag({input,grip,step:field.step}));
   }
  }
 }
 function sync(force=false){
  const currentSelection=selection();
  if(currentSelection.ids.length>1||currentSelection.ids.some(id=>id.startsWith('@group:'))){
   const state=materials.read(),bulk=bulkView(state,currentSelection.memberIds);
   const key=JSON.stringify(['selection',currentSelection.ids,bulk,state.recipes.map(r=>[r.id,r.name])]);
   if((!force&&renderKey===key)||edits.state().active?.id===target)return;
   sessions.forEach(s=>s.dispose?.());sessions=[];renderKey=key;root.replaceChildren();syncBulk(state,bulk);return;
  }
  const entry=selected();const slots=materials.slots(entry);if(!slots.some(s=>s.key===slotKey))slotKey=slots[0]?.key??null;
  const slot=slots.find(s=>s.key===slotKey),state=materials.read(),recipe=state.recipes.find(r=>r.id===slot?.recipeId),definition=registry.get(recipe?.implementation);
  const key=JSON.stringify([entry?.id,slots.map(s=>[s.key,s.label]),slotKey,recipe?.id,state.recipes.map(r=>[r.id,r.name]),entry?.burnable?.enabled,definition?.resourceKey?.(recipe.parameters)]);
  if(!force&&renderKey===key){if(recipe)for(const input of root.querySelectorAll('[data-material-param]'))if(input!==document.activeElement)input.value=recipe.parameters[input.dataset.materialParam];return;}
  if(edits.state().active?.id===target)return;
  sessions.forEach(s=>s.dispose?.());sessions=[];renderKey=key;root.replaceChildren();
  const title=document.createElement('h2');title.textContent=entry?.label||'Material';root.append(title);
  if(!slot){const p=document.createElement('p');p.textContent='Select a mesh to inspect its materials.';root.append(p);return;}
  const label=document.createElement('label');label.textContent='Surface slot ';const select=document.createElement('select');select.id='material-slot';
  for(const s of slots)select.add(new document.defaultView.Option(s.label,s.key));select.value=slotKey;select.onchange=()=>{slotKey=select.value;sync(true);};label.append(select);root.append(label);
  if(entry.burnable?.enabled){const p=document.createElement('p');p.textContent='Live burning owns this surface. Disable Burning in Selection to edit the base recipe; heat and char remain per object.';root.append(p);return;}
  const assigned=document.createElement('label');assigned.textContent='Material ';const recipes=document.createElement('select');recipes.id='material-assignment';recipes.add(new document.defaultView.Option('Source material',''));for(const r of state.recipes)recipes.add(new document.defaultView.Option(r.name,r.id));recipes.value=recipe?.id||'';recipes.onchange=()=>run(()=>api.assign({objectId:entry.id,slot:slotKey,recipeId:recipes.value}));assigned.append(recipes);root.append(assigned);
  const actions=document.createElement('div');actions.className='material-actions';const button=(text,callback)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.onclick=()=>run(callback);actions.append(b);return b;};
  if(!recipe){const implementation=document.createElement('select');implementation.id='material-implementation';for(const d of definitions)implementation.add(new document.defaultView.Option(d.title,d.id));if(slot.base.isNodeMaterial)implementation.value='kiln-glaze';root.append(implementation);button('Create material',()=>api.create({objectId:entry.id,slot:slotKey,implementation:implementation.value}));root.append(actions);return;}
  const users=state.bindings.filter(b=>b.recipeId===recipe.id&&selected(b.objectId));const usage=document.createElement('p');usage.id='material-users';usage.className='material-users';usage.textContent=`${users.length} surface${users.length===1?'':'s'} use this material: ${users.map(b=>selected(b.objectId)?.label||b.objectId).join(', ')}. Edits affect all users.`;root.append(usage);
  button('Make unique',()=>api.makeUnique({objectId:entry.id,slot:slotKey}));root.append(actions);
  const name=document.createElement('input');name.id='material-name';name.value=recipe.name;name.setAttribute('aria-label','Material name');name.onchange=()=>run(()=>api.edit(recipe.id,{name:name.value}));root.append(name);
  const description=document.createElement('p');description.className='material-implementation-description';description.textContent=`${definition.title} · ${definition.description}`;root.append(description);
  if(definition.sources){
   const row=document.createElement('label');row.textContent='Checkpoint ';const choices=document.createElement('select');choices.dataset.materialSource='';choices.setAttribute('aria-label','Checkpoint');choices.add(new document.defaultView.Option('Loading checkpoints…',''));choices.disabled=true;row.append(choices);root.append(row);
   definition.sources().then(items=>{
    if(!choices.isConnected)return;
    const current=JSON.stringify(recipe.parameters.source);if(!items.some(item=>JSON.stringify(item.source)===current))items.unshift({label:'Current checkpoint',source:recipe.parameters.source});
    choices.replaceChildren(...items.map(item=>new document.defaultView.Option(item.label,JSON.stringify(item.source))));choices.value=current;choices.disabled=false;
    choices.onchange=()=>run(async()=>{choices.setAttribute('aria-busy','true');try{await api.edit(recipe.id,{parameters:{source:JSON.parse(choices.value)}});}finally{choices.removeAttribute('aria-busy');sync(true);}});
   }).catch(e=>{if(choices.isConnected){choices.replaceChildren(new document.defaultView.Option(e.message,''));error(e.message);}});
  }
  if(definition.describe){const source=document.createElement('p');source.className='material-source';source.textContent=definition.describe(recipe.parameters);root.append(source);}
  for(const field of definition.fields){
   const row=document.createElement('label');row.className='transform-row';const grip=document.createElement('span');grip.textContent=field.label;const input=document.createElement('input');input.type=field.type;input.className='transform-input';input.dataset.materialParam=field.key;input.setAttribute('aria-label',field.label);input.value=recipe.parameters[field.key];if(field.type==='number'){if(field.min!==undefined)input.min=field.min;if(field.max!==undefined)input.max=field.max;input.step=field.step;}
   input.addEventListener('input',()=>run(()=>{const next=materials.read(),current=next.recipes.find(r=>r.id===recipe.id);current.parameters[field.key]=input.type==='number'?input.valueAsNumber:input.value;edits.preview(next);}));
   const session=installSceneControlHistory({controls:[input],edits,id:target,label:'Edit '+field.label,onError:e=>error(e.message)});sessions.push(session);
   row.append(grip,input);root.append(row);if(field.type==='number')sessions.push(installRelativeNumberDrag({input,grip,step:field.step}));
  }
 }
 edits.subscribe(state=>{
  const finished=state.active?.id!==target;
  const refresh=finished&&bulkGesture;
  if(finished){draftIds.clear();bulkGesture=false;}
  sync(refresh);changed();
 });sync();return {...api,sync};
}
