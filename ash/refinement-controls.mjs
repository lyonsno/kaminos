import {installRelativeNumberDrag} from '../scene-control-history.mjs';

export function installAshRefinementControls({document,panel,anchor}) {
  const group=document.createElement('details');
  const title=document.createElement('summary');title.textContent='Coarse and fine regions';group.append(title);
  const label=document.createElement('label');label.className='slider-row';label.textContent='Use local fine resolution';
  const enabled=document.createElement('input');enabled.type='checkbox';label.append(enabled);group.append(label);
  const description=document.createElement('p');description.className='hint';
  description.textContent='The background uses twice the cell width. Fine regions use the cell width above. Reset applies region edits and clears ash.';group.append(description);
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
    body.hidden=!enabled.checked;
    select.replaceChildren(...regions.map((_,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`Fine region ${i+1}`;return option;}));
    select.value=String(active);remove.disabled=regions.length===0;
    for(const {side,axis,input}of inputs){input.disabled=!regions.length;input.value=String(regions[active]?.[side][axis]??0);}
  }
  enabled.addEventListener('change',()=>{if(enabled.checked&&!regions.length)regions=[defaultRegion()];display();});
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
  return {
    sync(nextId,nextSettings) {
      settings=nextSettings;const nextVersion=JSON.stringify(settings.refinement??null);
      if(id===nextId&&version===nextVersion)return;
      id=nextId;version=nextVersion;enabled.checked=!!settings.refinement;
      regions=structuredClone(settings.refinement?.regions??[]);active=0;display();
    },
    read(nextSettings) {
      if(!enabled.checked)return null;
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
