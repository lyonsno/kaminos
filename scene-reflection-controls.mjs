import {resolveReflectionSettings,REFLECTION_CONTROL_FIELDS,REFLECTION_COST_HELP} from './scene-reflection-settings.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
export function installSceneReflectionControls({document,host,edits,read,write}){
 const target='@scene-reflections',fields=[],lifetimes=[];
 const sync=()=>{const value=read();for(const {key,input}of fields)if(document.activeElement!==input||!edits.state().active){if(input.type==='checkbox')input.checked=value[key];else input.value=String(value[key]);}};
 edits.register(target,{read,check:resolveReflectionSettings,write(value){write(value);sync();}});
 const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Reflection quality';detail.append(summary);
 for(const {key,label,type,step,help,options,min,max}of REFLECTION_CONTROL_FIELDS){
  const row=document.createElement('label');row.className='field';const grip=document.createElement('span');grip.textContent=label;
  const input=document.createElement(type==='select'?'select':'input');
  if(options)for(const [value,label]of options){const option=document.createElement('option');option.value=value;option.textContent=label;input.append(option);}
  input.id='scene-reflections-'+key;if(type!=='select')input.type=type;input.className='transform-input';input.setAttribute('aria-label',label);row.title=grip.title=input.title=help;
  if(type==='number'){if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);input.step='any';}
  row.append(grip,input);(key==='enabled'?host:detail).append(row);fields.push({key,input});
  input.addEventListener(type==='checkbox'?'change':'input',()=>{
   input.setCustomValidity('');
   if(edits.state().active?.id!==target||input.value===''||!input.validity.valid)return;
   try{edits.preview({...read(),[key]:type==='checkbox'?input.checked:type==='select'?input.value:Number(input.value)});}
   catch(error){input.setCustomValidity(error.message);}
  });
  lifetimes.push(installSceneControlHistory({controls:[input],edits,id:target,label:'Edit '+label,onError:error=>{input.title=error.message;sync();}}));
  if(type==='number'){
   lifetimes.push(installRelativeNumberDrag({input,grip,step}));
   input.title=help+' '+input.title;
   const restoreInvalid=()=>{if(input.value===''||!input.validity.valid){input.setCustomValidity('');sync();}};
   input.addEventListener('change',restoreInvalid);input.addEventListener('blur',restoreInvalid);
  }
 }
 host.append(detail);
 const help=document.createElement('p');help.className='small';help.textContent=REFLECTION_COST_HELP+' Scene saving retains these settings.';host.append(help);sync();
 return {sync,set:value=>edits.apply(target,resolveReflectionSettings({...read(),...value}),'Edit screen reflections'),commit(){for(const x of lifetimes)x.commit?.();},cancel(){for(const x of lifetimes)x.cancel?.();},dispose(){for(const x of lifetimes)x.dispose();}};
}
