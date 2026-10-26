import {burnerBodyFor,checkedBurnerRecipe} from './burner-recipe.mjs';
export function installBurnerControls({document,host,scene,edits,history,numberDrag,write,onError=()=>{}}) {
 const panel=document.createElement('section');panel.id='selected-burner-properties';panel.hidden=true;
 panel.innerHTML='<h3>Burner</h3><p class="flame-scope">Move the body or its group as one apparatus. Opening changes the active outlet; the metal body stays fixed.</p>';
 host.prepend(panel);
 const targets=new Set(),inputs=new Map();
 const body=()=>burnerBodyFor(scene,scene.selection.activeId);
 function target(entry){const id='@burner-recipe:'+entry.id;if(!targets.has(id)){edits.register(id,{allowMissing:true,read:()=>structuredClone((scene.find(entry.id)??scene.retained(entry.id))?.burner??null),check:checkedBurnerRecipe,write:value=>write(entry.id,value)});targets.add(id);}return id;}
 for(const [key,label,type,step,min,max] of [['on','Burner on','checkbox'],['opening','Opening','number',.01,0,1],['feed','Feed speed','number',.01,0,1],['fuel','Fuel fraction','number',.01,0,1],['heat','Inlet heat','number',.01,0,2],['aim','Outlet cant °','number',1,-80,80]]){
  const row=document.createElement('label');row.className='slider-row';row.innerHTML=`<span class="slider-label">${label}</span><input type="${type}" class="transform-input" aria-label="Burner ${label}">`;const input=row.querySelector('input');input.dataset.burnerParam=key;
  if(type==='number'){input.step='any';input.min=min;input.max=max;}panel.append(row);inputs.set(key,input);
  input.addEventListener('input',()=>{const entry=body();if(!entry||!input.validity.valid||type!=='checkbox'&&input.value==='')return;const id=target(entry);if(edits.state().active?.id!==id)return;try{edits.preview(checkedBurnerRecipe({...entry.burner,[key]:type==='checkbox'?input.checked:input.valueAsNumber}));}catch(error){onError(error);}});
  history({controls:[input],edits,id:()=>{const e=body();if(!e)throw Error('Choose a burner');return target(e);},label:`Set burner ${label}`,onError});
  if(type==='number'){const drag=numberDrag({input,grip:row.querySelector('span'),step});edits.subscribe(state=>{if(!state.active)drag.stop();});}
 }
 const status=document.createElement('p');status.className='flame-scope';status.dataset.burnerStatus='';panel.append(status);
 return {sync(){const entry=body();panel.hidden=!entry;if(!entry)return;panel.querySelector('h3').textContent=entry.burner.designId==='crown-ring'?'Burner · Crown':'Burner · Seam';
  for(const [key,input] of inputs)if(input.type==='checkbox')input.checked=entry.burner[key];else if(document.activeElement!==input||!edits.state().active)input.value=entry.burner[key];
  const ports=scene.objects.filter(e=>e.emission?.burnerPort?.bodyId===entry.id),outside=ports.some(e=>e.object.userData.burnerOutside),floored=ports.some(e=>e.object.userData.burnerRadiusFloor);
  status.textContent=!entry.burner.on||entry.burner.opening===0?'Supply off. Existing gas continues evolving.':outside?'An outlet is outside the simulation box. Move the burner or enlarge the box.':floored?'Small ports use the solver’s 0.02 footprint floor; supply still follows the actual opening area. Enlarge the burner relative to its box to resolve narrower jets.':`${ports.length} bound outlet${ports.length===1?'':'s'} · shared Fire & smoke simulation`;
 },panel,target};
}
