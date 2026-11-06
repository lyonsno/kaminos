export {imageVariationPlan,imageVariationRequest,createImageRunExecutor} from './authoring-image-runs.mjs';
import {assetWithheld} from './authoring-assets.mjs';

const copy=value=>structuredClone(value);
const available=m=>m?.availability==='available'&&m.entry&&!assetWithheld(m.entry);
// A projection of shared saved PNG lineage, never inferred from collection ownership.
export function imageExperimentBranches(members){
 const nodes=new Map(members.map(member=>{const p=member.entry?.provenance,parent=p?.iteration?.parent??(p?.reference?{source:p.reference.source,name:p.reference.name}:null);return [member.source,{member,parent,author:p?.author??null,operation:p?.iteration?.operation??(p?.iteration?'recipe-rerun':parent?'image-conditioned':'import'),children:[]}];}));
 for(const [source,n]of nodes){if(n.parent?.source!==source&&nodes.has(n.parent?.source))nodes.get(n.parent.source).children.push(source);}
 const rows=[],seen=new Set();
 const walk=(source,issue=null)=>{const stack=[{source,depth:0,issue}];while(stack.length){const entry=stack.pop();if(seen.has(entry.source))continue;seen.add(entry.source);const n=nodes.get(entry.source);rows.push({...n,depth:entry.depth,issue:entry.issue,parentAvailable:!!n.parent&&nodes.has(n.parent.source)});for(const child of [...n.children].reverse())stack.push({source:child,depth:entry.depth+1,issue:null});}};
 for(const [source,n]of nodes)if(!nodes.has(n.parent?.source))walk(source);
 for(const source of nodes.keys())if(!seen.has(source))walk(source,'cycle');
 return rows;
}
export function imageExperimentGalleryMembers(doc,{branchView=false}={}){const owned=new Set((doc.runs??[]).flatMap(run=>run.jobs.flatMap(job=>job.result?[job.result.source]:[])));return branchView?doc.members:doc.members.filter(member=>!owned.has(member.source));}
const authorLabel=author=>author?`${author.kind==='person'?'● Person':'◆ Agent'} · ${author.label||author.id}`:'Imported · author not recorded';
export async function experimentRequest(path,body){
 const response=await fetch(path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error||`Experiment HTTP ${response.status}`);return result;
}
export function createImageExperiments({request=experimentRequest,openRecipe,openImageEditor,changed=()=>{}}){
 let state={document:null,selected:null,selection:[],loading:false,error:null},ticket=0,anchor=null;
 const publish=()=>changed();
 const check=doc=>{if(doc?.schema!=='kaminos.image-experiment.v1'||!Array.isArray(doc.members))throw Error('Unsupported experiment document');return doc;};
 const member=source=>{const m=state.document?.members.find(m=>m.source===source);if(!available(m))throw Error('Choose an available experiment image');return m;};
 async function open(id){
  const own=++ticket;state.loading=true;state.error=null;publish();
  try{
   const doc=check(await request(`/api/image-experiments?${new URLSearchParams({id})}`));
   if(doc.id!==id)throw Error('The returned experiment does not match the requested collection');
   if(own!==ticket)return null;
   const selected=doc.id===state.document?.id&&doc.members.some(m=>m.source===state.selected)?state.selected:null;
   const selection=doc.id===state.document?.id?state.selection.filter(source=>available(doc.members.find(m=>m.source===source))):[];
   state={document:doc,selected,selection,loading:false,error:null};publish();return copy(doc);
  }catch(error){if(own===ticket){state.loading=false;state.error=error.message;publish();}throw error;}
 }
 const api={
  read:()=>copy(state),branches:()=>copy(imageExperimentBranches(state.document?.members??[])),open,
  close(){++ticket;state={document:null,selected:null,selection:[],loading:false,error:null};publish();},
  select(source){member(source);state.selected=source;publish();},
  accept(doc){check(doc);if(state.document?.id===doc.id&&doc.revision>=state.document.revision){state.document=copy(doc);state.selection=state.selection.filter(source=>available(doc.members.find(m=>m.source===source)));publish();}},
  deselect(){state.selected=null;publish();},
  toggleSelected(source,{range=false,scope=null}={}){member(source);const members=state.document.members;const visible=scope?scope.map(id=>members.find(m=>m.source===id)).filter(available):members;let sources=[source];if(range&&anchor&&visible.some(m=>m.source===anchor)&&visible.some(m=>m.source===source)){const a=visible.findIndex(m=>m.source===anchor),b=visible.findIndex(m=>m.source===source);sources=visible.slice(Math.min(a,b),Math.max(a,b)+1).filter(available).map(m=>m.source);}const selected=new Set(state.selection);if(range)for(const id of sources)selected.add(id);else if(selected.has(source))selected.delete(source);else selected.add(source);state.selection=members.filter(m=>selected.has(m.source)).map(m=>m.source);anchor=source;publish();},
  clearSelection(){state.selection=[];anchor=null;publish();},
  async edit(source=state.selected){const m=copy(member(source));await openRecipe(m.entry);return m.entry;},
  async editImage(source=state.selected){const m=copy(member(source));if(!openImageEditor)throw Error('Image editing is unavailable');await openImageEditor(m.entry);return m.entry;},
  async create({title,description='',agent,members=[]}){const doc=check(await request('/api/image-experiments',{action:'create',title,description,agent,members}));return open(doc.id);},
  async update({title,description}){const doc=state.document;if(!doc)throw Error('Open an experiment first');await request('/api/image-experiments',{action:'update',id:doc.id,revision:doc.revision,title,description});return open(doc.id);},
  async add(id,members){const doc=check(await request('/api/image-experiments',{action:'add',id,members}));if(state.document?.id===id)await open(id);return doc;},
  async recordResult(entry,provenance){
   // The run's captured recipe owns the destination, never whichever collection
   // happens to be on screen when asynchronous inference finishes.
   if(!provenance.experiment)return null;
   if(provenance.variation){const v=provenance.variation;const doc=check(await request('/api/image-experiments',{action:'finish-job',id:v.experimentId,runId:v.runId,jobId:v.jobId,attempt:v.attempt,status:'succeeded',result:{source:entry.source,name:entry.name}}));if(state.document?.id===doc.id)await open(doc.id);return doc;}
   return api.add(provenance.experiment.id,[{source:entry.source,name:entry.name,group:'Iterations',role:'result'}]);
  },
 };
 return api;
}

export function installImageExperiments({document,controller,assets,assetsUI,history,layout,recipe,busy=()=>false,runs=null}){
 const by=id=>document.getElementById(id),view=document.defaultView;
 const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e;};
 const button=(text,action)=>{const e=node('button',text);e.type='button';e.onclick=()=>run(action);return e;};
 const status=node('div',null,'asset-help');status.id='asset-experiment-status';status.setAttribute('role','status');
 const host=node('section');host.id='asset-experiment-browser';host.hidden=true;
 const bar=node('div',null,'experiment-heading');
 const back=button('← Experiments',async()=>{controller.close();await assets.browse('image-experiments');address(null);});
 const title=node('h2'),description=node('p'),meta=node('span',null,'asset-help');
 let branchView=new URL(view.location.href).searchParams.get('experiment_view')==='branches';
 const branches=button('Branches',()=>{branchView=!branchView;painting=null;const url=new URL(view.location.href);if(branchView)url.searchParams.set('experiment_view','branches');else url.searchParams.delete('experiment_view');view.history.replaceState(null,'',url);render();});branches.id='asset-experiment-branches';
 const refresh=button('Refresh',()=>controller.open(controller.read().document.id));
 const details=button('Edit details',()=>showForm(true));
 const start=button('New recipe',async()=>{const doc=controller.read().document;recipe.joinExperiment({id:doc.id,title:doc.title});await assetsUI.open('generate',{refresh:false});by('asset-prompt').focus();});start.id='asset-experiment-new-recipe';
 bar.append(back,title,meta,branches,start,details,refresh);host.append(bar,description,status);
 const body=node('div',null,'experiment-body'),grid=node('div',null,'experiment-groups'),inspector=node('aside',null,'experiment-selection');
 const runsHost=node('section'),main=node('div',null,'experiment-main');const runsUI=runs?.install(runsHost);main.append(runsHost,grid);
 body.append(main,inspector);host.append(body);by('asset-browse').append(host);
 const newButton=button('New experiment',()=>showForm(false));newButton.id='asset-experiment-new';by('asset-browse-header').append(newButton);
 const form=node('form');form.id='asset-experiment-form';form.hidden=true;
 const name=node('input');name.placeholder='Experiment name';name.required=true;name.setAttribute('aria-label','Experiment name');
 const notes=node('textarea');notes.placeholder='What are you exploring?';notes.rows=2;notes.setAttribute('aria-label','Experiment description');
 const include=node('label'),includeBox=node('input');includeBox.type='checkbox';include.append(includeBox,node('span','Include the selected image'));
 const save=node('button','Create experiment');save.type='submit';const cancel=button('Cancel',()=>{form.hidden=true;});
 form.append(name,notes,include,save,cancel);by('asset-browse-header').after(form);
 let editing=false,painting=null,detailKey=null,seenRoot=assets.read().root,addOptionsLoaded=false;
 async function run(action){try{status.textContent='';const local=by('asset-experiment-action-status');if(local)local.textContent='';await action();}catch(error){status.textContent=error.message;const local=by('asset-experiment-action-status');if(local)local.textContent=error.message;by('asset-status').textContent=error.message;}}
 function address(id){const url=new URL(view.location.href);if(id)url.searchParams.set('image_experiment',id);else url.searchParams.delete('image_experiment');view.history.replaceState(null,'',url);}
 function showForm(edit){editing=edit;form.hidden=false;const doc=controller.read().document;name.value=edit?doc.title:'';notes.value=edit?doc.description:'';include.hidden=edit||assets.read().selected?.kind!=='image';includeBox.checked=!edit&&!include.hidden;save.textContent=edit?'Save details':'Create experiment';name.focus();}
 form.onsubmit=event=>{event.preventDefault();run(async()=>{
  save.disabled=true;
  try{const selected=assets.read().selected,members=!editing&&includeBox.checked&&selected?.kind==='image'?[{source:selected.source,name:selected.name,group:'Starting images'}]:[];
   const doc=editing?await controller.update({title:name.value,description:notes.value}):await controller.create({title:name.value,description:notes.value,members});
   form.hidden=true;address(doc.id);
  }finally{save.disabled=false;}
 });};
 const returnBar=node('div',null,'experiment-return');returnBar.id='asset-experiment-return';returnBar.hidden=true;
 const returnButton=button('Back to experiment',()=>open((recipe.read().experiment??controller.read().document).id));returnBar.append(returnButton);by('asset-generate').prepend(returnBar);
 const addBar=node('div',null,'experiment-add');const addSelect=node('select');addSelect.setAttribute('aria-label','Destination experiment');
 const addButton=button('Add to experiment',async()=>{const e=assets.read().selected;if(!e||!addSelect.value)return;const doc=await controller.add(addSelect.value,[{source:e.source,name:e.name,group:'Collected images'}]);await open(doc.id);});
 addBar.append(addSelect,addButton);by('asset-detail').append(addBar);
 addSelect.onfocus=()=>run(loadOptions);
 async function loadOptions(){const data=await experimentRequest('/api/image-experiments');const prior=addSelect.value;addSelect.replaceChildren(node('option','Choose experiment…'),...data.entries.map(doc=>{const e=node('option',doc.title);e.value=doc.id;return e;}));addSelect.firstChild.value='';if(prior)addSelect.value=prior;addOptionsLoaded=true;}
 function captions(m){const p=m.entry?.provenance;return p?`${p.model} · seed ${p.seed} · ${p.width} × ${p.height}`:m.role==='reference'?'Reference image':'No generation recipe recorded';}
 async function open(id){await assetsUI.open('browse',{refresh:false});if(!await assets.refresh({browse:false}))throw Error(assets.read().error||'Asset collections are unavailable');await assets.browse('image-experiments');const doc=await controller.open(id);if(doc)address(id);return doc;}
 document.addEventListener('kaminos-assets-mode-change',event=>{
  const doc=controller.read().document;
  if(event.detail.mode==='generate'&&doc&&!busy()){const draft=recipe.read();if(!draft.parent&&!draft.imageParent)run(()=>recipe.joinExperiment({id:doc.id,title:doc.title},{preserveRecipe:true}));}
 });
 function render(){
  const s=controller.read(),doc=s.document,root=assets.read().root;
  if(root!==seenRoot){seenRoot=root;if(doc){controller.close();address(null);return;}}
  host.hidden=!doc&&!s.loading&&!s.error;by('asset-browse').dataset.experimentOpen=String(!host.hidden);
  by('authoring-assets').dataset.experiments=String(root==='image-experiments'||!host.hidden);
  if(s.error)status.textContent=s.error;
  else if(s.loading)status.textContent='Opening experiment…';
  else status.textContent='';
  const membership=recipe.read().experiment??doc;returnBar.hidden=!membership;returnButton.textContent=membership?`← Back to ${membership.title}`:'Back to experiment';
  addBar.hidden=assets.read().selected?.kind!=='image'||assetWithheld(assets.read().selected);if(!addBar.hidden&&!addOptionsLoaded){addOptionsLoaded=true;loadOptions().catch(()=>{addOptionsLoaded=false;});}
  if(!doc)return;
  runsUI?.render();
  title.textContent=doc.title;description.textContent=doc.description;meta.textContent=`${doc.members.length} ${doc.members.length===1?'image':'images'}${doc.agent?' · '+doc.agent.label:''}`;start.disabled=busy();
  branches.setAttribute('aria-pressed',String(branchView));
  const key=JSON.stringify([doc.id,doc.revision,branchView,doc.members]);
  if(key!==painting){painting=key;grid.replaceChildren();const groups=new Map();
   for(const row of imageExperimentBranches(imageExperimentGalleryMembers(doc,{branchView}))){const m=row.member,group=branchView?'Experiment branches':m.role==='reference'?'References':m.group||'Results';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);}
   if(!groups.size)grid.append(node('p','Start with New recipe, or select an image in Assets and use Add to experiment.','asset-help'));
   for(const [name,members]of groups){const section=node('section',null,'experiment-group'),heading=node('h3',name),cards=node('div',null,branchView?'experiment-grid is-branches':'experiment-grid');section.append(heading,cards);grid.append(section);
    for(const row of members){const m=row.member,card=button('',()=>controller.select(m.source));card.className='experiment-image';card.dataset.source=m.source;card.setAttribute('style',branchView?`--branch-depth:${row.depth}`:'');card.disabled=!available(m);
     if(available(m)){const img=node('img');img.src=m.preview;img.alt=m.name;img.loading='lazy';card.append(img);}else card.append(node('div',m.availability==='withheld'?'Awaiting review':'Image unavailable','experiment-placeholder'));
     card.append(node('strong',m.name),node('small',available(m)?captions(m):m.error||m.entry?.visibility?.reason));card.append(node('small',authorLabel(row.author),'experiment-author'));if(row.parent)card.append(node('small',`${row.operation==='image-edit'?'Image edit':'Branch'} of ${row.parent.name||row.parent.source}${row.parentAvailable?'':' · parent outside this collection'}`,'experiment-parent'));if(row.issue)card.append(node('small','Lineage cycle recorded · inspect parent links','asset-help'));const wrapper=node('div',null,'experiment-card');wrapper.style?.setProperty('--branch-depth',String(row.depth));const check=node('input');check.type='checkbox';check.dataset.checkSource=m.source;check.setAttribute('aria-label',`Select ${m.name} for variations`);check.disabled=!available(m);check.onclick=event=>controller.toggleSelected(m.source,{range:event.shiftKey,scope:[...grid.querySelectorAll('[data-check-source]')].filter(check=>!check.disabled).map(check=>check.dataset.checkSource)});wrapper.append(check,card);cards.append(wrapper);
    }
   }
  }
  for(const check of grid.querySelectorAll('[data-check-source]'))check.checked=s.selection.includes(check.dataset.checkSource);
  for(const card of grid.querySelectorAll('[data-source]'))card.setAttribute('aria-pressed',String(card.dataset.source===s.selected));
  const selected=doc.members.find(m=>m.source===s.selected),nextDetail=JSON.stringify([doc.id,doc.revision,s.selected,busy(),doc.members]);
  inspector.hidden=!selected;body.classList.toggle('has-selection',!!selected);
  if(nextDetail!==detailKey){detailKey=nextDetail;inspector.replaceChildren();if(selected){
   const close=button('×',()=>controller.deselect());close.setAttribute('aria-label','Close image details');
   inspector.append(close,node('h3',selected.name),node('p',authorLabel(selected.entry?.provenance?.author),'experiment-author'));const parent=selected.entry?.provenance?.iteration?.parent;if(parent){const parentMember=doc.members.find(m=>m.source===parent.source);inspector.append(node('p',`Branched from ${parent.name||parent.source}`));if(available(parentMember))inspector.append(button('Go to parent',()=>controller.select(parent.source)));}if(available(selected)){const img=node('img');img.src=selected.preview;img.alt=selected.name;inspector.append(img);}
   const edit=button('Edit recipe & rerun',async()=>{if(busy())throw Error('Finish the current generation first');await controller.edit(selected.source);});edit.disabled=!selected.entry?.provenance||!available(selected);edit.id='asset-experiment-edit';const actionStatus=node('p',null,'asset-help');actionStatus.id='asset-experiment-action-status';actionStatus.setAttribute('role','status');inspector.append(edit,actionStatus,node('p',captions(selected),'asset-help'));
   if(runsUI){const vary=button('Variations…',()=>runsUI.compose());vary.id='asset-experiment-vary';inspector.append(vary);}
   const editImage=button('Use image as reference',async()=>{if(busy())throw Error('Finish the current generation first');await controller.editImage(selected.source);});editImage.id='asset-experiment-edit-image';editImage.disabled=busy()||!available(selected);inspector.append(editImage);
   const compare=node('select');compare.setAttribute('aria-label','Compare this image with');const placeholder=node('option','Compare with…');placeholder.value='';compare.append(placeholder);
   for(const m of doc.members.filter(m=>m.source!==selected.source&&available(m))){const option=node('option',`${m.group} · ${m.name}`);option.value=m.source;compare.append(option);}
   compare.onchange=()=>run(async()=>{if(!compare.value)return;const current=controller.read().document;const members=current?.id===doc.id?[selected.source,compare.value].map(source=>current.members.find(m=>m.source===source)):[];if(members.length!==2||!members.every(available))throw Error('Choose available images from the current experiment');const [chosen,other]=members;history.record(other.entry);history.record(chosen.entry);assets.select(chosen.entry);await assetsUI.open('generate',{refresh:false});layout.compare(true);history.compare(other.source);});inspector.append(compare);
   const p=selected.entry?.provenance;
   if(p){const fields=[['Your request',p.promptExpansion?.request?.prompt||p.prompt],['Expanded prompt',p.promptExpansion?.expandedPrompt],['Submitted prompt',p.prompt],['Changes from parent',p.iteration?.changes.map(c=>`${c.field}: ${c.before??'none'} → ${c.after??'none'}`).join('\n')],['Parent',p.iteration?.parent?.name]];
    for(const [label,value]of fields){if(!value)continue;const d=node('details'),summary=node('summary',label),text=node('p',value);d.append(summary,text);if(label==='Your request')d.open=true;inspector.append(d);}
   }
  }}
 }
 render();return {render,open};
}
