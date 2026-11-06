import {imageGenerationRecipe,imageRecipeChanges} from './authoring-image-recipe.mjs';
import {checkedImageAuthor} from './authoring-image-generation.mjs';
const copy=value=>structuredClone(value);
export function imageVariationPlan({experiment,sources,seeds,title}){
 if(!Array.isArray(seeds)||!seeds.length||seeds.some(seed=>!Number.isSafeInteger(seed)||seed<0)||new Set(seeds).size!==seeds.length)throw Error('Choose distinct nonnegative integer seeds.');
 if(!Array.isArray(sources)||!sources.length)throw Error('Select at least one source recipe.');
 const rows=sources.map(source=>{try{return {...copy(source),request:imageGenerationRecipe(source.provenance),completion:copy(source.provenance.completion??null)};}catch(error){return {...copy(source),error:error.message};}});
 return {title:title||`${experiment.title} — seed variation`,seeds:[...seeds],count:rows.length*seeds.length,rows};
}
export function imageVariationRequest({experiment,run,job}){
 const source=run.sources[job.sourceIndex],p=source.provenance,before=imageGenerationRecipe(p),request={...before,seed:job.seed};
 return {...request,...(p.promptExpansion?{promptExpansion:copy(p.promptExpansion)}:{}),textLength:before.textLength==='model'?'fit16':before.textLength,author:checkedImageAuthor(run.author),experiment:{id:experiment.id,title:experiment.title},
  expectedModel:Object.fromEntries(['source','sampling','lora'].filter(key=>Object.hasOwn(p,key)&&p[key]!==undefined).map(key=>[key,copy(p[key])])),
  iteration:{operation:'recipe-rerun',parent:{source:source.source,name:source.name},...(p.completion?{parentCompletion:copy(p.completion)}:{}),changes:imageRecipeChanges(before,request)},
  variation:{experimentId:experiment.id,runId:run.id,jobId:job.id,attempt:job.attempt}};
}
export function createImageRunExecutor({request,generate,stopGeneration=()=>{},busy=()=>false,changed=()=>{}}){
 let active=null,stopRequested=false;
 const publish=()=>changed();
 const read=()=>copy(active);
 const post=async(id,body)=>{const doc=await request('/api/image-experiments',{id,...body});changed(copy(doc));return doc;};
 return {read,busy:()=>!!active,
  async stop(){if(!active)return;stopRequested=true;await post(active.experimentId,{action:'stop-run',runId:active.runId});stopGeneration();},
  async execute(experimentId,runId){
   if(active||busy())throw Error('Finish the active generation before starting a run.');
   active={experimentId,runId};stopRequested=false;publish();
   try{
    let doc=await request(`/api/image-experiments?${new URLSearchParams({id:experimentId})}`);
    let run=doc.runs?.find(r=>r.id===runId);if(!run)throw Error('Saved run is missing.');
    if(run.jobs.some(j=>j.status==='running'))throw Error('An image in this run is already active. Its completion is still unconfirmed.');
    for(const planned of run.jobs){
     if(stopRequested||run.stopRequested)break;if(planned.status!=='queued')continue;
     const attempt=crypto.randomUUID();
     doc=await post(experimentId,{action:'claim-job',runId,jobId:planned.id,attempt});run=doc.runs.find(r=>r.id===runId);
     const job=run.jobs.find(j=>j.id===planned.id);if(stopRequested||run.stopRequested){doc=await post(experimentId,{action:'finish-job',runId,jobId:job.id,attempt,status:'stopped',error:'Run stopped before inference'});break;}active={experimentId,runId,jobId:job.id};publish();
     try{
      const result=await generate(imageVariationRequest({experiment:doc,run,job}));
      if(!result){doc=await post(experimentId,{action:'finish-job',runId,jobId:job.id,attempt,status:'stopped',error:'Generation stopped'});stopRequested=true;await post(experimentId,{action:'stop-run',runId});}
      // Successful publication is part of the generator's persistence callback.
      // A disk/HTTP failure therefore retains the exact pixels for Retry saving.
      else {doc=await request(`/api/image-experiments?${new URLSearchParams({id:experimentId})}`);const saved=doc.runs.find(r=>r.id===runId).jobs.find(j=>j.id===job.id);if(saved.status!=='succeeded')throw Error('Saved image has no confirmed run membership.');}
     }catch(error){
      // A retained image must be saved before this or another job can run.
      if(error.pendingImage)throw error;
      doc=await post(experimentId,{action:'finish-job',runId,jobId:job.id,attempt,status:'failed',error:error.message});
      if(stopRequested)break;
     }
     run=doc.runs.find(r=>r.id===runId);publish();
    }
    return doc;
   }finally{active=null;publish();}
  },
 };
}

export function installImageVariationRuns({document,host,controller,executor,request,pageAuthor,imageState=()=>({}),retrySaving=async()=>{},onError=()=>{}}){
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
 const action=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(error=>{feedback.textContent=error.message;onError(error);});return b;};
 const feedback=node('p');feedback.setAttribute('role','status');feedback.className='asset-help';
 const toolbar=node('div');toolbar.className='experiment-selection-toolbar';toolbar.id='asset-experiment-selection-toolbar';const selectedLabel=node('strong');
 let draft=null,compare=false,paint=null,runPaint=null;
 const composer=node('section');composer.id='asset-variation-composer';composer.className='experiment-composer';composer.hidden=true;
 const name=node('input');name.id='asset-variation-name';name.setAttribute('aria-label','Run name');
 const seeds=node('input');seeds.id='asset-variation-seeds';seeds.setAttribute('aria-label','Seeds, separated by commas');
 const nameLabel=node('label','Run name ');nameLabel.append(name);const seedsLabel=node('label','Seeds ');seedsLabel.append(seeds);
 const summary=node('p');summary.id='asset-variation-summary';const rows=node('div');rows.className='experiment-plan-rows';
 const savePlan=async(start)=>{
  updatePlan();if(!draft||draft.plan.rows.some(row=>row.error))throw Error('Every selected source needs a supported recipe before this run can start.');
  if(executor.busy())throw Error('Finish the current run first.');
  const author=await pageAuthor();const runId=crypto.randomUUID();
  const doc=await request('/api/image-experiments',{action:'create-run',id:draft.experiment.id,runId,title:name.value,sources:draft.sources.map(s=>s.source),seeds:draft.plan.seeds,author});
  // Revalidate the canonical snapshots read by the store, before any GPU work.
  const run=doc.runs.find(r=>r.id===runId),plan=imageVariationPlan({experiment:doc,sources:run.sources,seeds:run.seeds});
  if(plan.rows.some(row=>row.error))throw Error('Saved run includes an unsupported recipe. No generation started.');
  composer.hidden=true;await controller.open(doc.id);if(start){await executor.execute(doc.id,runId);await controller.open(doc.id);}
 };
 const submit=action('Save & run',()=>savePlan(true));submit.id='asset-variation-submit';const saveOnly=action('Save plan',()=>savePlan(false));saveOnly.id='asset-variation-save';
 function updatePlan(){
  try{
   if(!draft)return;const raw=seeds.value.split(/[\s,]+/).filter(Boolean);if(raw.some(s=>!/^\d+$/.test(s)))throw Error('Seeds must be nonnegative integers, separated by commas.');
   const plan=imageVariationPlan({experiment:draft.experiment,sources:draft.sources,seeds:raw.map(Number),title:name.value});draft.plan=plan;
   summary.textContent=`${plan.rows.length} ${plan.rows.length===1?'recipe':'recipes'} × ${plan.seeds.length} seeds = ${plan.count} images. Only the seed changes. Prompts and original references stay with each recipe.`;
   rows.replaceChildren();for(const row of plan.rows){const line=node('details'),heading=node('summary',row.name);line.append(heading);
    if(row.error)line.append(node('p',row.error));else{const r=row.request;line.append(node('p',`${r.model} · ${r.size}px · ${r.level} · ${r.reference?'Original reference: '+r.reference.name:'Text only'}`),node('p',r.prompt));if(row.completion?.earlyDecoded||row.completion?.partial)line.append(node('p',`Parent decoded after ${row.completion.stepsCompleted??'?'} of ${row.completion.stepsRequested??'?'} steps. New images use the full recorded schedule; comparison with this parent also changes completion.`));}rows.append(line);}
   submit.disabled=saveOnly.disabled=plan.rows.some(row=>row.error)||executor.busy();
  }catch(error){summary.textContent=error.message;submit.disabled=saveOnly.disabled=true;}
 }
 seeds.oninput=updatePlan;name.oninput=()=>{if(draft)draft.plan.title=name.value;};
 composer.append(node('h3','Seed variations'),nameLabel,seedsLabel,summary,rows,submit,saveOnly,action('Cancel',()=>{composer.hidden=true;draft=null;}));
 function compose(){const state=controller.read(),doc=state.document;const chosen=state.selection.length?state.selection:state.selected?[state.selected]:[];if(!chosen.length)throw Error('Select one or more source recipes.');draft={experiment:{id:doc.id,title:doc.title},sources:chosen.map(source=>{const m=doc.members.find(m=>m.source===source);return {source:m.source,name:m.name,provenance:copy(m.entry?.provenance)};})};name.value=`${doc.title} — seed variation`;seeds.value=Array.from({length:4},()=>Math.floor(Math.random()*1e9)).join(', ');composer.hidden=false;updatePlan();name.focus();}
 toolbar.append(selectedLabel,action('Variations…',compose),action('Compare selected',()=>{compare=!compare;paint=null;render();}),action('Clear selection',()=>controller.clearSelection()));
 const comparisons=node('section');comparisons.className='experiment-compare';comparisons.hidden=true;
 const runs=node('section');runs.id='asset-experiment-runs';
 host.append(toolbar,composer,feedback,comparisons,runs);
 async function runAction(doc,run,operation){feedback.textContent='';if(operation)await request('/api/image-experiments',{id:doc.id,runId:run.id,...operation});await controller.open(doc.id);await executor.execute(doc.id,run.id);await controller.open(doc.id);}
 function render(){
  const state=controller.read(),doc=state.document;if(!doc)return;
  selectedLabel.textContent=`${state.selection.length} selected`;toolbar.hidden=!state.selection.length;
  if(draft&&draft.experiment.id!==doc.id){draft=null;composer.hidden=true;}
  const key=JSON.stringify([doc.id,state.selection,compare,doc.members]);
  comparisons.hidden=!compare||!state.selection.length;
  if(key!==paint){paint=key;comparisons.replaceChildren();for(const source of state.selection){const m=doc.members.find(m=>m.source===source);if(m?.availability!=='available')continue;const figure=node('figure'),img=node('img');img.src=m.preview;img.alt=m.name;figure.append(img,node('figcaption',m.name));comparisons.append(figure);}}
  const pending=imageState().pending;
  const next=JSON.stringify([doc.id,doc.runs,doc.members.map(m=>[m.source,m.availability]),executor.read(),!!pending]);
  if(next===runPaint)return;runPaint=next;runs.replaceChildren();
  if(!doc.runs?.length)return;runs.append(node('h3','Runs'));
  for(const run of [...doc.runs].reverse()){
   const section=node('details');section.className='experiment-run';section.open=true;
   const completed=run.jobs.filter(j=>j.status==='succeeded').length;section.append(node('summary',`${run.title} · ${completed}/${run.jobs.length} saved · ${run.author.label}`));
   const actions=node('div');actions.className='experiment-run-actions';
   const active=run.jobs.some(j=>j.status==='running');
   if(run.jobs.some(j=>j.status==='queued')&&!active&&!run.stopRequested)actions.append(action('Continue run',()=>runAction(doc,run)));
   if(active||run.jobs.some(j=>j.status==='queued'))actions.append(action('Stop run',async()=>{if(executor.read()?.runId===run.id)await executor.stop();else await request('/api/image-experiments',{action:'stop-run',id:doc.id,runId:run.id});await controller.open(doc.id);}));
   const failed=run.jobs.filter(j=>['failed','stopped'].includes(j.status));if(failed.length&&!active)actions.append(action(`Retry ${failed.length} unfinished`,()=>runAction(doc,run,{action:'retry-run',jobIds:failed.map(j=>j.id)})));
   if(pending?.provenance?.variation?.runId===run.id)actions.append(action('Retry saving image',async()=>{await retrySaving();await controller.open(doc.id);}));
   if(active&&!executor.busy())actions.append(node('p','An image is active in another page, or its completion is unconfirmed. Refresh to read its saved state.'));
   section.append(actions);const scroller=node('div');scroller.className='experiment-run-scroll';const table=node('table');table.className='experiment-run-grid';const head=node('tr');head.append(node('th','Source recipe'));for(const seed of run.seeds)head.append(node('th',`Seed ${seed}`));table.append(head);
   run.sources.forEach((source,index)=>{const row=node('tr'),label=node('th',source.name);if(source.availability==='available'){const img=node('img');img.src=source.source;img.alt=source.name;label.append(img);}row.append(label);for(const seed of run.seeds){const job=run.jobs.find(j=>j.sourceIndex===index&&j.seed===seed),cell=node('td');cell.dataset.jobId=job.id;cell.append(node('small',job.status));
    if(job.result){const m=doc.members.find(m=>m.source===job.result.source);if(m?.availability==='available'){const b=action('',()=>controller.select(m.source));const img=node('img');img.src=m.preview;img.alt=m.name;b.append(img);cell.append(b);}else cell.append(node('p','Saved image unavailable'));}
    if(job.error)cell.append(node('p',job.error));row.append(cell);}table.append(row);});scroller.append(table);section.append(scroller);runs.append(section);
  }
 }
 return {render,compose};
}
