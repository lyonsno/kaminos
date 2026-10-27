import {GRID_TUNING_GROUPS,GRID_TUNING_FIELDS,gridTuningSummary,intermediateCoverageChoices} from './volume-grid-tuning.mjs';

export function createGridTuningInspector({document,host,read,validate,apply}) {
 const element=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const root=element('section','flame-grid-tuning');root.id='flame-grid-tuning';
 const openButton=element('button','btn','Edit simulation grids · Alt G');openButton.type='button';openButton.id='grid-tuning-open';root.append(openButton);host.prepend(root);
 // Keep the editor in the document while switching Material/Flow/Quality tabs.
 const panel=element('section','grid-editor');panel.id='grid-tuning-editor';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Simulation grids');
 const toolbar=element('div','grid-editor-toolbar');toolbar.append(element('strong',null,'Simulation grids'));
 const applyButton=element('button','btn','Apply · ⌘/Ctrl Enter');applyButton.type='button';applyButton.id='grid-tuning-apply';
 const reset=element('button','btn','Discard draft');reset.type='button';reset.id='grid-tuning-reset';
 const close=element('button','btn','Close · Esc');close.type='button';close.id='grid-tuning-close';toolbar.append(applyButton,reset,close);panel.append(toolbar);
 const status=element('p','grid-editor-status');status.id='grid-tuning-status';status.setAttribute('role','status');panel.append(status);
 const intro=element('p','flame-scope','Material holds detail; velocity carries motion; pressure corrects flow. Cell counts grow cubically. Edit together, then apply.');panel.append(intro);
 const fields=new Map(),summaries=new Map();let baseline=null,draft=null,dirty=false,applying=false,selected='Fine',layer='material',lastPreview='';
 const pick=c=>Object.fromEntries(GRID_TUNING_FIELDS.map(([key])=>[key,c[key]]));
 const signature=c=>JSON.stringify(pick(c));
 function field(key,label){
  const id=GRID_TUNING_FIELDS.find(f=>f[0]===key)?.[1];const input=element(['worldSmoke','worldSmokeIntermediate'].includes(key)?'select':'input','transform-input');input.id=`grid-draft-${key}`;input.setAttribute('aria-label',label);
  if(input.tagName==='SELECT')for(const option of document.getElementById(id)?.options||[])input.append(option.cloneNode(true));
  else {input.type='number';input.step=['intermediateExtent','worldSmokeExtent','worldSmokeTransition','gridHeightRatio'].includes(key)?'any':'1';input.min=['fineVelocity','finePressure','worldSmokePressure','worldSmokeTransition'].includes(key)||key.endsWith('Iterations')?'0':key==='resolution'?'4':key==='gridHeightRatio'?'1':key.endsWith('Extent')?'1.000000001':'2';}
  input.title=['fineVelocity','finePressure','worldSmokePressure'].includes(key)?'Cells across the region; 0 follows the parent grid. Ratios need not be integers.':key.endsWith('Iterations')?'Pressure correction sweeps per simulation step.':'Cells across the region; independent of the other resolutions.';
  input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{
   const previous={...read(),...draft};const reach=Number(previous.worldSmokeTransition||0)*Number(previous.worldSmokeExtent||3)/Number(previous.worldSmokeFlow||16);
   draft[key]=input.value===''?NaN:['worldSmoke','worldSmokeIntermediate'].includes(key)?input.value:Number(input.value);
   if(['worldSmokeFlow','worldSmokeExtent'].includes(key)&&Number.isFinite(draft[key])&&draft[key]>0){const next={...previous,...draft};draft.worldSmokeTransition=reach*Number(next.worldSmokeFlow)/Number(next.worldSmokeExtent);}
   dirty=true;refresh();
  });fields.set(key,input);return input;
 }
 const shape=element('label','grid-editor-shape');shape.append(element('span',null,'Fine height / width'),field('gridHeightRatio','Fine height / width'));panel.append(shape);
 const table=element('table','grid-editor-table');const head=element('thead'),headRow=element('tr');
 for(const name of ['Region','Coverage × Fine','Material','Velocity','Pressure','Iterations'])headRow.append(element('th',null,name));head.append(headRow);table.append(head);
 const body=element('tbody');
 const keys=[['resolution','fineVelocity','finePressure','pressureSolverIterations'],['intermediateMaterial','intermediateFlow','intermediatePressure','intermediateIterations'],['worldSmokeMaterial','worldSmokeFlow','worldSmokePressure','worldSmokeIterations']];
 for(const [i,group] of GRID_TUNING_GROUPS.entries()){
  const name=group.name.split(' ·')[0],row=element('tr');row.dataset.region=name;
  const label=element('td');const selectRegion=element('button','grid-region',name);selectRegion.type='button';selectRegion.onclick=()=>{selected=name;lastPreview='';refresh();};label.append(selectRegion);
  if(i>0)label.append(field(i===1?'worldSmokeIntermediate':'worldSmoke',`${name} mode`));row.append(label);
  const coverage=element('td');coverage.append(i===0?element('span',null,'1×'):field(i===1?'intermediateExtent':'worldSmokeExtent',`${name} coverage / Fine width`));row.append(coverage);
  for(const [j,key] of keys[i].entries()){const td=element('td');td.append(field(key,`${name}: ${['Material','Velocity','Pressure','Pressure iterations'][j]}`));row.append(td);}
  body.append(row);
 }table.append(body);panel.append(table);
 const collar=element('label','grid-editor-shape');const reach=element('input','transform-input');reach.id='grid-draft-collarReach';reach.type='number';reach.min='0';reach.step='any';reach.setAttribute('aria-label','Momentum collar reach / Fine width');
 const collarReadout=element('span','flame-scope');collar.append(element('span',null,'Momentum reach / Fine width'),reach,collarReadout);panel.append(collar);
 reach.addEventListener('input',()=>{const c={...read(),...draft};draft.worldSmokeTransition=reach.value===''?NaN:Number(reach.value)*Number(c.worldSmokeFlow)/Number(c.worldSmokeExtent);dirty=true;refresh();});
 const fit=element('button','btn');fit.type='button';fit.id='grid-tuning-fit';panel.append(fit);
 const previewControls=element('div','grid-editor-preview-controls');previewControls.append(element('span',null,'Front view · select a region above'));
 const mode=element('select','transform-input');mode.setAttribute('aria-label','Preview lattice');for(const value of ['material','velocity','pressure']){const o=element('option',null,value[0].toUpperCase()+value.slice(1));o.value=value;mode.append(o);}mode.value=layer;mode.addEventListener('change',()=>{layer=mode.value;lastPreview='';refresh();});previewControls.append(mode);panel.append(previewControls);
 const canvas=element('canvas','grid-editor-preview');canvas.width=720;canvas.height=240;canvas.setAttribute('aria-label','Orthographic region coverage and selected cell spacing');panel.append(canvas);
 const details=element('details','grid-editor-details');details.append(element('summary',null,'Dimensions and estimated work'));
 for(const name of ['Fine','Intermediate','World']){const out=element('p','flame-grid-summary');summaries.set(name,out);details.append(out);}panel.append(details);
 panel.append(element('p','flame-scope','Dimension changes restart affected fields. Iterations keep the field. Escape closes this editor and retains the draft. Zero velocity/pressure follows its parent.'));
 (document.body||root).append(panel);
 function draw(plan){
  const key=JSON.stringify([plan?.rows.map(r=>[r.name,r.materialDims,r.flowDims,r.pressureDims,r.min,r.max]),selected,layer]);if(key===lastPreview)return;lastPreview=key;
  const ctx=canvas.getContext?.('2d');if(!ctx)return;ctx.clearRect(0,0,720,240);ctx.fillStyle='#11191e';ctx.fillRect(0,0,720,240);if(!plan)return;
  const rows=plan.rows.map(r=>({...r,min:r.min||[-1,-1,-1],max:r.max||[1,2*plan.shape.ratio-1,1]}));const extent=Math.max(...rows.map(r=>r.max[0])),lo=Math.min(...rows.map(r=>r.min[1])),hi=Math.max(...rows.map(r=>r.max[1]));const scale=Math.min(650/(2*extent),190/(hi-lo));const px=x=>360+x*scale,py=y=>212-(y-lo)*scale;
  const colors={Fine:'#f1cc8f',Intermediate:'#8bcbb6',World:'#91b6df'};
  for(const r of [...rows].reverse()){
   const x=px(r.min[0]),y=py(r.max[1]),w=(r.max[0]-r.min[0])*scale,h=(r.max[1]-r.min[1])*scale;ctx.strokeStyle=colors[r.name];ctx.lineWidth=r.name===selected?2:1;ctx.strokeRect(x,y,w,h);
   if(r.name===selected){const d=layer==='material'?r.materialDims:layer==='velocity'?r.flowDims:r.pressureDims;if(d){ctx.save();ctx.globalAlpha=.25;ctx.beginPath();for(let i=1;i<d[0];i++){const p=x+w*i/d[0];ctx.moveTo(p,y);ctx.lineTo(p,y+h);}for(let i=1;i<d[1];i++){const p=y+h*i/d[1];ctx.moveTo(x,p);ctx.lineTo(x+w,p);}ctx.stroke();ctx.restore();}}
   ctx.fillStyle=colors[r.name];ctx.font='12px system-ui';ctx.fillText(r.name,x+5,y+14);
  }
  ctx.fillStyle='#cbd6df';ctx.fillText(`${selected} · ${layer} spacing · draft coverage`,14,232);
 }
 function refresh(){
  const current=read(),candidate={...current,...draft};let plan,error;
  try{plan=validate(candidate);}catch(e){error=e.message;}
  const stale=dirty&&signature(current)!==signature(baseline);
  for(const [key,input] of fields){
   const independent=candidate.worldSmoke==='on'&&candidate.worldSmokeIntermediate==='fields';input.disabled=key.startsWith('intermediate')&&!independent||key.startsWith('worldSmoke')&&key!=='worldSmoke'&&candidate.worldSmoke!=='on';
   if(document.activeElement!==input)input.value=String(draft[key]??'');
  }
  reach.disabled=candidate.worldSmoke!=='on';if(document.activeElement!==reach)reach.value=String(Number(candidate.worldSmokeTransition||0)*Number(candidate.worldSmokeExtent||3)/Number(candidate.worldSmokeFlow||16));
  collarReadout.textContent=`${Number(Number(candidate.worldSmokeTransition||0).toPrecision(4))} velocity cells · reach stays fixed when velocity detail changes`;
  const fits=error?.includes('tile')&&candidate.worldSmokeIntermediate==='fields'?intermediateCoverageChoices(candidate):[];const nearest=fits.sort((a,b)=>Math.abs(a-candidate.intermediateExtent)-Math.abs(b-candidate.intermediateExtent))[0];fit.hidden=nearest===undefined;fit.textContent=`Fit Intermediate coverage to ${Number(nearest?.toPrecision(5))}×`;fit.onclick=()=>{draft.intermediateExtent=nearest;dirty=true;refresh();};
  for(const [name,out] of summaries){const row=plan?.rows.find(r=>r.name===name);out.textContent=row?`${name}\n${gridTuningSummary(row,plan.fine.materialDims[0])}`:`${name}: ${error?'dimensions pending correction':'off'}`;}
  status.textContent=stale?'Applied grids changed elsewhere. Discard this draft to load them.':error?`${error}. Applied simulation retained.`:dirty?'Draft compatible · Apply to rebuild changed dimensions':'Applied grids';
  status.dataset.state=error||stale?'invalid':dirty?'draft':'applied';applyButton.disabled=!dirty||!!error||stale||applying;reset.disabled=!dirty;draw(plan);
 }
 function sync(){if(applying)return;if(!dirty){baseline=pick(read());draft={...baseline};}refresh();}
 function open(){panel.hidden=false;sync();fields.get('resolution').focus?.();}
 function hide(){panel.hidden=true;openButton.focus?.();}
 reset.onclick=()=>{dirty=false;for(const input of fields.values())if(document.activeElement===input)input.blur?.();sync();};
 applyButton.onclick=()=>{if(applyButton.disabled)return;try{applying=true;apply({...draft});dirty=false;}catch(e){status.textContent=`${e.message}. Draft retained.`;return;}finally{applying=false;}sync();};
 openButton.onclick=open;close.onclick=hide;
 const keyboard=e=>{if(e.altKey&&e.code==='KeyG'){e.preventDefault();open();}else if(!panel.hidden&&e.key==='Escape'){e.preventDefault();hide();}else if(!panel.hidden&&(e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();applyButton.onclick();}};
 document.addEventListener?.('keydown',keyboard);
 sync();return {sync,root,open,close:hide,dispose(){document.removeEventListener?.('keydown',keyboard);panel.remove?.();}};
}
