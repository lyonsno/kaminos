import {GRID_TUNING_GROUPS,GRID_TUNING_FIELDS,gridWidthChoices,gridTuningSummary,intermediateCoverageChoices} from './volume-grid-tuning.mjs';

export function createGridTuningInspector({document,host,read,validate,apply}) {
 const root=document.createElement('section');root.id='flame-grid-tuning';root.className='flame-grid-tuning';
 const title=document.createElement('h3');title.textContent='Simulation grids';root.append(title);
 const intro=document.createElement('p');intro.className='flame-scope';intro.textContent='Material holds flame and smoke detail. Velocity carries motion. Pressure corrects the flow. Edit a draft, then apply the three regions together.';root.append(intro);
 const fields=new Map(),summaries=new Map();let baseline=null,draft=null,dirty=false,applying=false;
 const pick=c=>Object.fromEntries(GRID_TUNING_FIELDS.map(([key])=>[key,c[key]]));
 const signature=c=>JSON.stringify(pick(c));
 for(const group of GRID_TUNING_GROUPS){
  const section=document.createElement('details');section.open=true;section.className='flame-inspector-section';
  const heading=document.createElement('summary');heading.textContent=group.name;section.append(heading);
  for(const [key,id,label] of group.fields){
   const source=document.getElementById(id),row=document.createElement('label');row.className='slider-row';
   const text=document.createElement('span');text.className='slider-label';text.textContent=label;row.append(text);
   const choice=['resolution','worldSmoke','worldSmokeIntermediate','fineVelocity','finePressure','worldSmokePressure'].includes(key);
   const input=document.createElement(choice?'select':'input');input.className='transform-input';input.id=`grid-draft-${key}`;input.setAttribute('aria-label',`${group.name}: ${label}`);
   if(choice&&source.tagName==='SELECT')for(const option of source.options)input.append(option.cloneNode(true));
   if(!choice){input.type='number';input.step=key.toLowerCase().includes('extent')||key==='gridHeightRatio'?'any':'1';input.min=key.toLowerCase().includes('iterations')?'0':key==='gridHeightRatio'?'1':'2';if(key.toLowerCase().includes('extent'))input.min='1.000000001';
    if(!key.toLowerCase().includes('iterations')&&!key.toLowerCase().includes('extent')&&key!=='gridHeightRatio'){const list=document.createElement('datalist');list.id=`${input.id}-choices`;input.setAttribute('list',list.id);row.append(list);input._suggestions=list;}
   }
   input.title=label.includes('detail')?'Cells across this region. Higher widths give smaller cells.':label==='Pressure iterations'?'More correction sweeps on this region’s pressure grid.':label==='Width / fine width'?'Physical coverage relative to the fine box; changing coverage also changes cell spacing.':'';
   input.addEventListener(choice?'change':'input',()=>{draft[key]=input.value===''?NaN:['worldSmoke','worldSmokeIntermediate'].includes(key)?input.value:Number(input.value);dirty=true;refresh();});
   fields.set(key,input);row.append(input);section.append(row);
  }
  const out=document.createElement('p');out.className='flame-grid-summary';summaries.set(group.name.split(' ·')[0],out);section.append(out);root.append(section);
 }
 const fit=document.createElement('button');fit.type='button';fit.className='btn';fit.id='grid-tuning-fit';root.append(fit);
 const status=document.createElement('p');status.id='grid-tuning-status';status.className='flame-scope';status.setAttribute('role','status');root.append(status);
 const actions=document.createElement('div');actions.className='flame-basin-actions';
 const applyButton=document.createElement('button');applyButton.className='btn';applyButton.id='grid-tuning-apply';applyButton.textContent='Apply grids';applyButton.type='button';
 const reset=document.createElement('button');reset.className='btn';reset.id='grid-tuning-reset';reset.type='button';reset.textContent='Discard draft';actions.append(applyButton,reset);root.append(actions);
 const note=document.createElement('p');note.className='flame-scope';note.textContent='Dimension changes restart affected fields. Iterations do not resize them. Cell counts describe work, not measured frame time. Bounds below show the applied fields.';root.append(note);host.prepend(root);
 function refresh(){
  const current=read(),candidate={...current,...draft};let plan,error=null;
  try{plan=validate(candidate);}catch(e){error=e.message;}
  const fits=intermediateCoverageChoices(candidate);const nearest=fits.sort((a,b)=>Math.abs(a-Number(candidate.intermediateExtent))-Math.abs(b-Number(candidate.intermediateExtent)))[0];
  fit.hidden=!error?.includes('Intermediate')||nearest===undefined||candidate.worldSmokeIntermediate!=='fields';fit.textContent=`Fit intermediate coverage to ${Number(nearest?.toPrecision(5))}× fine width`;fit.onclick=()=>{draft.intermediateExtent=nearest;dirty=true;refresh();};
  const stale=dirty&&signature(current)!==signature(baseline);
  for(const [key,input] of fields){
   const independent=candidate.worldSmoke==='on'&&candidate.worldSmokeIntermediate==='fields';
   input.disabled=(key.startsWith('intermediate')&&!independent)||(key.startsWith('worldSmoke')&&key!=='worldSmoke'&&candidate.worldSmoke!=='on');
   if(['fineVelocity','finePressure','worldSmokePressure'].includes(key)){
    let choices=[];try{choices=gridWidthChoices(candidate,key);}catch{}
    const value=String(draft[key]??0);input.replaceChildren();
    const parent=key==='fineVelocity'?'material':key==='finePressure'?'velocity / legacy setting':'velocity';
    for(const n of [0,...choices,...(!choices.includes(Number(value))&&Number(value)!==0?[Number(value)]:[])]){
     const option=document.createElement('option');option.value=String(n);option.textContent=n===0?`Follow ${parent}`:`${n} cells${choices.includes(n)?'':' · incompatible'}`;input.append(option);
    }
    input.value=value;
   }else if(document.activeElement!==input)input.value=String(draft[key]??'');
   if(input._suggestions){input._suggestions.replaceChildren();let choices=[];try{choices=gridWidthChoices(candidate,key);}catch{}for(const n of choices){const o=document.createElement('option');o.value=String(n);input._suggestions.append(o);}}
  }
  for(const [name,out] of summaries){const row=plan?.rows.find(r=>r.name===name);out.textContent=row?gridTuningSummary(row,plan.fine.materialDims[0]):name==='Intermediate'&&candidate.worldSmokeIntermediate!=='fields'?candidate.worldSmokeIntermediate==='on'?'Legacy velocity collar; material is borrowed from World.':'Off':name==='World'&&candidate.worldSmoke!=='on'?'Off':'Dimensions pending correction';}
  status.textContent=stale?'Applied grid settings changed elsewhere. Discard this draft and edit the current values.':error?`${error}. The applied simulation is unchanged.`:dirty?'Draft is compatible. Apply to change the simulation.':`Applied settings${plan?.shape.mode==='requested-snapped'||plan?.shape.mode==='requested-clamped'?` · effective fine height / width ${plan.shape.ratio} (aligned to shared lattices)`:''}`;
  if(error?.includes('Intermediate dimensions'))status.textContent+=' These widths do not tile this coverage with cubic cells. Fit coverage above, or change the widths.';
  if(error?.includes('subdivision'))status.textContent+=' Choose a pressure width that divides velocity; fine velocity must divide material in every dimension.';
  status.dataset.state=error||stale?'invalid':dirty?'draft':'applied';applyButton.disabled=!dirty||!!error||stale||applying;reset.disabled=!dirty;
 }
 function sync(){if(applying)return;const current=read();if(!dirty){baseline=pick(current);draft={...baseline};}refresh();}
 reset.onclick=()=>{dirty=false;sync();};
 applyButton.onclick=()=>{
  if(applyButton.disabled)return;
  try{applying=true;apply({...draft});dirty=false;}
  catch(error){status.textContent=`${error.message}. Draft retained; correct it or discard.`;return;}
  finally{applying=false;}
  sync();
 };
 sync();return {sync,root};
}
