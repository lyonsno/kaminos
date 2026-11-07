import {installRelativeNumberDrag} from '../scene-control-history.mjs';

export function installAshRefinementControls({document,panel,anchor}) {
  const group=document.createElement('details');group.dataset.ashRefinementControls='';
  const title=document.createElement('summary');title.textContent='Adaptive detail';group.append(title);
  const label=document.createElement('label');label.className='slider-row';label.textContent='Use local fine resolution';
  const enabled=document.createElement('input');enabled.type='checkbox';label.append(enabled);group.append(label);
  const description=document.createElement('p');description.className='hint';
  description.textContent='Collider detail places fine bricks automatically. The background uses twice the cell width. Extra detail halves that fine pitch at visible collider features. Both levels retain deposited history after objects move. A full pool keeps new demand coarse. Reset applies capacity edits and clears ash.';group.append(description);
  const mode=document.createElement('select');mode.className='transform-input';mode.dataset.ashRefinementMode='';
  for(const [value,text] of [['hierarchy','Budgeted hierarchy · collider detail'],['adaptive','Two / three levels · legacy'],['fixed','Fixed regions · debugging']]){const o=document.createElement('option');o.value=value;o.textContent=text;mode.append(o);}group.append(mode);
  const hierarchyFields=document.createElement('div');group.append(hierarchyFields);const hierarchyInputs={};
  for(const [key,text,value]of [['backgroundCellSize','Background cell width',.08],['budgetMiB','Material storage budget (MiB)',32],['targetPixels','Projected parent cell target (pixels)',3]]){
    const row=document.createElement('label');row.className='slider-row';row.textContent=text;const input=document.createElement('input');input.type='number';input.step='any';input.min='0';input.className='transform-input';input.dataset.ashHierarchy=key;input.value=String(value);row.append(input);hierarchyFields.append(row);hierarchyInputs[key]=input;installRelativeNumberDrag({input,grip:input,step:key==='budgetMiB'?1:.001});
  }
  const budgetRow=document.createElement('label');budgetRow.className='slider-row';budgetRow.textContent='Fine capacity (% of field)';
  const budget=document.createElement('input');budget.className='transform-input';budget.type='number';budget.min='0';budget.max='100';budget.step='any';budget.dataset.ashFineCapacity='';budgetRow.append(budget);group.append(budgetRow);
  const closeRow=document.createElement('label');closeRow.className='slider-row';closeRow.textContent='Extra detail near the camera';
  const close=document.createElement('input');close.type='checkbox';close.dataset.ashViewDetail='';closeRow.append(close);group.append(closeRow);
  const body=document.createElement('div');group.append(body);
  const select=document.createElement('select');select.className='transform-input';body.append(select);
  const inputs=[];
  for(const side of ['min','max'])for(const [axis,name]of ['X','Y','Z'].entries()) {
    const row=document.createElement('label');row.className='slider-row';row.textContent=`${side==='min'?'Min':'Max'} ${name}`;
    const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';
    input.dataset.ashFineBound=`${side}-${axis}`;row.append(input);body.append(row);
    installRelativeNumberDrag({input,grip:input,step:.01});inputs.push({side,axis,input});
  }
  const add=document.createElement('button');add.type='button';add.className='btn';add.textContent='Add fine region';
  const remove=document.createElement('button');remove.type='button';remove.className='btn';remove.textContent='Remove fine region';body.append(add,remove);
  anchor.parentElement?.after?.(group);
  let id=null,version=null,settings=null,regions=[],active=0;
  function defaultRegion() {
    const h=settings.cellSize*2;
    const height=Math.max(h,Math.min(settings.height,Math.ceil(.25/h)*h));
    return {min:[-settings.width/2,0,-settings.depth/2],max:[settings.width/2,height,settings.depth/2]};
  }
  function display() {
    body.hidden=!enabled.checked||mode.value!=='fixed';mode.hidden=!enabled.checked;budgetRow.hidden=!enabled.checked||mode.value!=='adaptive';closeRow.hidden=budgetRow.hidden;hierarchyFields.hidden=!enabled.checked||mode.value!=='hierarchy';
    description.textContent=mode.value==='hierarchy'?'Cell width sets the finest requested receiving detail. Background width stays independent. Collider features request children; screen size prioritizes them. Occupied history keeps its bricks. The material budget covers the grid and shared brick pool; collider caches and airborne parcels are reported separately. Reset clears all existing ash.':'Collider detail places fine bricks automatically. The background uses twice the cell width. Extra detail halves that fine pitch. Occupied history stays resident. Reset clears all existing ash.';
    select.replaceChildren(...regions.map((_,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`Fine region ${i+1}`;return option;}));
    select.value=String(active);remove.disabled=regions.length===0;
    for(const {side,axis,input}of inputs){input.disabled=!regions.length;input.value=String(regions[active]?.[side][axis]??0);}
  }
  enabled.addEventListener('change',()=>{if(enabled.checked&&!regions.length)regions=[defaultRegion()];display();});
  mode.addEventListener('change',display);
  select.addEventListener('change',()=>{active=Number(select.value);display();});
  for(const {side,axis,input}of inputs)input.addEventListener('input',()=>{
    if(regions[active]&&input.value.trim()!==''&&Number.isFinite(input.valueAsNumber))regions[active][side][axis]=input.valueAsNumber;
  });
  add.addEventListener('click',()=>{
    const region=defaultRegion();
    const lower=Math.max(0,...regions.map(r=>r.max[1]));
    if(lower+region.max[1]<=settings.height){region.min[1]=lower;region.max[1]+=lower;}
    regions.push(region);active=regions.length-1;display();
  });
  remove.addEventListener('click',()=>{regions.splice(active,1);active=Math.max(0,active-1);display();});
  return {element:group,
    sync(nextId,nextSettings) {
      settings=nextSettings;const nextVersion=JSON.stringify(settings.refinement??null);
      if(id===nextId&&version===nextVersion)return;
      id=nextId;version=nextVersion;enabled.checked=!!settings.refinement;mode.value=['adaptive','hierarchy'].includes(settings.refinement?.mode)?settings.refinement.mode:'fixed';budget.value=String((settings.refinement?.fineFraction??.125)*100);
      hierarchyInputs.backgroundCellSize.value=String(settings.refinement?.backgroundCellSize??settings.cellSize*2);hierarchyInputs.budgetMiB.value=String(settings.refinement?.budgetMiB??32);hierarchyInputs.targetPixels.value=String(settings.refinement?.targetPixels??3);
      close.checked=settings.refinement?.levels===3;regions=structuredClone(settings.refinement?.regions??[]);active=0;display();
    },
    read(nextSettings) {
      if(!enabled.checked)return null;
      if(mode.value==='hierarchy')return {ratio:2,mode:'hierarchy',backgroundCellSize:hierarchyInputs.backgroundCellSize.valueAsNumber,budgetMiB:hierarchyInputs.budgetMiB.valueAsNumber,targetPixels:hierarchyInputs.targetPixels.valueAsNumber};
      if(mode.value==='adaptive'){const fineFraction=budget.valueAsNumber/100;if(!Number.isFinite(fineFraction)||fineFraction<=0||fineFraction>1)throw Error('Fine capacity must lie between 0 and 100 percent');return {ratio:2,mode:'adaptive',fineFraction,...(close.checked?{levels:3}:{})};}
      const h=nextSettings.cellSize*2;
      const origin=[-nextSettings.width/2,0,-nextSettings.depth/2];
      const extents=[nextSettings.width,nextSettings.height,nextSettings.depth];
      return {ratio:2,regions:regions.map(region=>Object.fromEntries(['min','max'].map(side=>[side,region[side].map((value,axis)=>{
        const limit=Math.ceil(extents[axis]/h)*h;
        return origin[axis]+Math.max(0,Math.min(limit,Math.round((value-origin[axis])/h)*h));
      })])))};
    },
  };
}
