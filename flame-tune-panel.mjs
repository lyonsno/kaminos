import {FLAME_PROPERTY_GROUPS,authoredFlameShapeOptions} from './flame-authoring.mjs';
import {installRelativeNumberDrag} from './scene-control-history.mjs';
import {KILN_FLOW_RANGE} from './kiln-cue-tunes.mjs';

const hero=['volume-input-radius','volume-flow-rate','volume-speed','volume-physical-temperature',
  'volume-physical-thermal','volume-physical-exposure','volume-physical-smoke-extinction'];

export function createFlameTunePanel({document,host,read,set,onError}) {
  const fields=[];
  const named=new Map(FLAME_PROPERTY_GROUPS.flatMap(group=>group.fields));
  const groups=[{name:'Flame tune',open:true,fields:hero.map(id=>[id,named.get(id)])},
    ...FLAME_PROPERTY_GROUPS.filter(group=>group.name!=='Simulation').map(group=>({...group,open:false,fields:group.fields.filter(([id])=>!hero.includes(id))}))];
  for(const group of groups) {
    const section=document.createElement('details');section.open=!!group.open;
    const title=document.createElement('summary');title.textContent=group.name;section.append(title);
    for(const [id,label] of group.fields) {
      const source=document.getElementById(id);if(!source)continue;
      const row=document.createElement('div');row.className='slider-row';
      const grip=document.createElement('label');grip.className='slider-label';grip.textContent=label;
      const input=document.createElement(source.tagName==='SELECT'?'select':'input');
      input.id=`cue-${id}`;input.className='transform-input';input.setAttribute('aria-label',`Cue ${label}`);grip.htmlFor=input.id;
      if(source.tagName==='SELECT')for(const option of id==='emitter-assay-family'?authoredFlameShapeOptions(source.options):source.options)input.append(option.cloneNode(true));
      else {
        input.type=source.type==='range'?'number':source.type;input.step='any';
        for(const bound of ['min','max'])if(source[bound]!=='')input[bound]=source[bound];
        if(id==='volume-flow-rate'){input.min=KILN_FLOW_RANGE.min;input.max=KILN_FLOW_RANGE.max;}
      }
      const value=()=>{const state=read();const control=state?.domControls[id]||state?.rendererControls[id];return control?.rawValue??control?.value;};
      const show=()=>{const current=value();input.disabled=current===undefined;if(input.type==='checkbox')input.checked=!!current;else input.value=current??'';};
      let before;
      const remember=()=>{before=value();};
      const change=()=>{
        if(input.type==='number' && (!input.value.trim()||!input.validity.valid))return;
        try {set(id,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value);}
        catch(error){show();onError(error);}
      };
      input.addEventListener('focus',remember);
      input.addEventListener(input.type==='checkbox'||input.tagName==='SELECT'?'change':'input',change);
      input.addEventListener('pointercancel',()=>{if(before!==undefined){try{set(id,before);}catch(error){onError(error);}show();}});
      input.addEventListener('blur',show);
      fields.push({show});row.append(grip,input);section.append(row);
      if(input.type==='number')installRelativeNumberDrag({grip,input,step:Number.isFinite(Number(source.step))&&Number(source.step)>0?Number(source.step):.01,onStart:remember});
    }
    host.append(section);
  }
  return {sync:()=>fields.forEach(field=>field.show())};
}
