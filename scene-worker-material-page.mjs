import {installRelativeNumberDrag} from './scene-control-history.mjs';

// This holds a pending interaction, never a second scene or history. All
// previews and settlement use the identity returned by the worker's ledger.
export function createWorkerMaterialGesture({recipeId,label='Edit material',call,readGesture=()=>null}){
 let id=null,failure=null,closing=null;
 const failed=error=>{
  failure??=error;
  if(!id&&error.mutationApplied===true&&typeof error.requestId==='string'){
   const current=readGesture();
   if(current?.recipeId===recipeId&&current.requestId===error.requestId&&typeof current.gestureId==='string')id=current.gestureId;
  }
 };
 let tail;
 try{tail=Promise.resolve(call('scene.materialBegin',{recipeId,label},{gesture:true})).then(result=>{
  if(typeof result?.gestureId!=='string'||!result.gestureId)throw Error('Worker did not return the material gesture identity');id=result.gestureId;
 }).catch(failed);}catch(error){failed(error);tail=Promise.resolve();}
 function preview(patch){
  if(closing)throw Error('Material gesture is settling');
  const task=tail.then(()=>{if(failure)throw failure;return call('scene.materialPreview',{recipeId,gestureId:id,patch},{gesture:true});});
  tail=task.catch(failed);return task;
 }
 function finish(cancel){
  if(closing)return closing;
  closing=tail.then(async()=>{
   if(!id)throw failure??Error('Material gesture did not begin');
   try{await call(cancel||failure?'scene.materialCancel':'scene.materialCommit',{gestureId:id},{gesture:true});}
   catch(error){if(failure)failure.settlementError=error;else throw error;}
   if(failure)throw failure;
  });closing.catch(()=>{});return closing;
 }
 return Object.freeze({preview,commit:()=>finish(false),cancel:()=>finish(true)});
}

export function createSceneWorkerMaterialInspector({document,root,readUi,call,busy=()=>false,report=()=>{}}){
 let slotKey=null,renderKey=null,sessions=[],active=null,closed=false;
 const error=error=>report((error.mutationApplied===true?'Change applied; ':'')+error.message);
 const node=(tag,text)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;};
 async function finish(cancel=false){
  const gesture=active;if(!gesture)return;
  if(!gesture.closing)gesture.closing=(cancel?gesture.owner.cancel():gesture.owner.commit()).finally(()=>{if(active===gesture)active=null;render(true);});
  return gesture.closing;
 }
 const settle=cancel=>{if(!closed)void finish(cancel).catch(error);};
 function begin(input,recipeId,label){
  if(active)return active.input===input?active:null;
  active={input,owner:createWorkerMaterialGesture({recipeId,label,call,readGesture:()=>readUi()?.materials?.gesture}),closing:null};return active;
 }
 function tune(input,recipeId,key,label){
  const preview=()=>{
   const gesture=begin(input,recipeId,'Edit '+label);if(!gesture||gesture.closing)return;
   const value=input.type==='number'?input.valueAsNumber:input.value;
   void gesture.owner.preview({parameters:{[key]:value}}).catch(error);
  };
  input.addEventListener('focusin',()=>begin(input,recipeId,'Edit '+label));
  input.addEventListener('input',preview);
  input.addEventListener('change',()=>{preview();settle(false);});
  input.addEventListener('focusout',()=>{if(active?.input===input)settle(false);});
  input.addEventListener('pointercancel',()=>{if(active?.input===input)settle(true);});
  input.addEventListener('keydown',event=>{if(event.key==='Escape'&&active?.input===input){event.preventDefault();event.stopImmediatePropagation();settle(true);input.blur();}});
 }
 function action(name,input){
  return Promise.resolve().then(()=>finish(false)).then(()=>call(name,input)).catch(error);
 }
 function render(force=false){
  if(closed)return;
  const ui=readUi(),state=ui?.materials,slots=state?.slots??[];
  if(!slots.some(row=>row.key===slotKey))slotKey=slots[0]?.key??null;
  const slot=slots.find(row=>row.key===slotKey),recipe=state?.recipes.find(row=>row.id===slot?.recipeId),definition=state?.definitions.find(row=>row.id===recipe?.implementation);
  const object=ui?.objects?.find(row=>row.id===state?.objectId);
  const key=JSON.stringify([state?.objectId,slots,slotKey,recipe?.id,state?.recipes.map(row=>[row.id,row.name]),object?.burnable?.enabled,recipe?.parameters.source]);
  if(!force&&key===renderKey){
   for(const input of root.querySelectorAll('[data-worker-material-param]'))if(input!==document.activeElement&&input!==active?.input)input.value=recipe?.parameters[input.dataset.workerMaterialParam]??'';
  }else{
   if(active&&!active.closing)settle(true);
   for(const session of sessions)session.dispose?.();sessions=[];renderKey=key;root.replaceChildren();
   root.append(node('h2',object?.label??'Material'));
   if(!slot){root.append(node('p','Select a mesh to inspect its materials.'));return;}
   const choose=node('label','Surface slot '),slotSelect=node('select');slotSelect.id='material-slot';
   for(const row of slots){const option=node('option',row.label);option.value=row.key;slotSelect.append(option);}slotSelect.value=slotKey;slotSelect.onchange=()=>{slotKey=slotSelect.value;render(true);};choose.append(slotSelect);root.append(choose);
   if(object?.burnable?.enabled){root.append(node('p','Live burning owns this surface. Disable Burning in Selection to edit the base recipe.'));return;}
   const assignment=node('label','Material '),assigned=node('select');assigned.id='material-assignment';
   const source=node('option','Source material');source.value='';assigned.append(source);
   for(const row of state.recipes){const option=node('option',row.name);option.value=row.id;assigned.append(option);}assigned.value=recipe?.id??'';
   assigned.onchange=()=>action('scene.materialAssign',{objectId:state.objectId,slot:slotKey,recipeId:assigned.value});assignment.append(assigned);root.append(assignment);
   if(!recipe){
    const implementation=node('select');implementation.id='material-implementation';
    for(const row of state.definitions){const option=node('option',row.title);option.value=row.id;implementation.append(option);}
    if(slot.nodeMaterial)implementation.value='kiln-glaze';
    const create=node('button','Create material');create.type='button';create.onclick=()=>action('scene.materialCreate',{objectId:state.objectId,slot:slotKey,implementation:implementation.value});root.append(implementation,create);
   }else{
    const unique=node('button','Make unique');unique.type='button';unique.onclick=()=>action('scene.materialUnique',{objectId:state.objectId,slot:slotKey});root.append(unique);
    const name=node('input');name.id='material-name';name.value=recipe.name;name.setAttribute('aria-label','Material name');name.onchange=()=>action('scene.materialEdit',{recipeId:recipe.id,patch:{name:name.value}});root.append(name);
    root.append(node('p',`${definition.title} · ${definition.description}`));
    if(definition.hasSources){
     const label=node('label','Checkpoint '),sources=node('select');sources.dataset.materialSource='';sources.setAttribute('aria-label','Checkpoint');label.append(sources);root.append(label);
     const loading=node('option','Loading checkpoints…');sources.append(loading);sources.disabled=true;
     void call('scene.materialSources',{implementation:definition.id}).then(result=>{
      if(!sources.isConnected)return;
      const rows=result.sources,current=JSON.stringify(recipe.parameters.source);if(!rows.some(row=>JSON.stringify(row.source)===current))rows.unshift({label:'Current checkpoint',source:recipe.parameters.source});
      sources.replaceChildren(...rows.map(row=>{const option=node('option',row.label);option.value=JSON.stringify(row.source);return option;}));sources.value=current;sources.disabled=false;
      sources.onchange=()=>action('scene.materialEdit',{recipeId:recipe.id,patch:{parameters:{source:JSON.parse(sources.value)}}});
     }).catch(cause=>{if(sources.isConnected){sources.replaceChildren(node('option',cause.message));error(cause);}});
    }
    for(const field of definition.fields){
     const row=node('label'),grip=node('span',field.label),input=node('input');row.className='transform-row';input.type=field.type;input.className='transform-input';input.dataset.workerMaterialParam=field.key;input.setAttribute('aria-label',field.label);input.value=recipe.parameters[field.key];
     if(field.type==='number'){if(field.min!==undefined)input.min=field.min;if(field.max!==undefined)input.max=field.max;input.step=field.step;}
     tune(input,recipe.id,field.key,field.label);row.append(grip,input);root.append(row);
     if(field.type==='number')sessions.push(installRelativeNumberDrag({input,grip,step:field.step,onStart:()=>begin(input,recipe.id,'Edit '+field.label)}));
    }
   }
  }
  for(const control of root.querySelectorAll('input,select,button'))control.disabled=busy()||((!!active||!!ui?.history?.active)&&!(active?.input===control&&!active.closing));
 }
 return Object.freeze({render,dispose(){closed=true;for(const session of sessions)session.dispose?.();active=null;}});
}
