import {createSceneMaterialOperations} from './scene-material-operations.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
export function installMaterialInspector({document,root,materials,definitions,edits,selected,assertAvailable,changed,error}){
 const target='@scene-materials',registry=new Map(definitions.map(d=>[d.id,d]));
 edits.register(target,{read:materials.read,write:materials.write,check:materials.check});
 let slotKey=null,renderKey=null,sessions=[];
 const apply=(value,label)=>{assertAvailable();try{return edits.apply(target,value,label);}catch(e){if(edits.state().active?.id===target)edits.cancel();throw e;}};
 const api=createSceneMaterialOperations({materials,definitions,selected,apply,assertAvailable,readSlot:()=>slotKey});
 function selectedById(objectId){const entry=objectId?selected(objectId):selected();if(!entry)throw Error('Select a mesh');return entry;}
 const failed=e=>{error(e.message);sync(true);};
 const run=action=>{try{Promise.resolve(action()).catch(failed);}catch(e){failed(e);}};
 function sync(force=false){
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
 edits.subscribe(()=>{sync();changed();});sync();return {...api,sync};
}
