import {resolveReflectionSettings} from './scene-reflections.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
export function installSceneReflectionControls({document,host,edits,read,write}){
 const target='@scene-reflections',fields=[],lifetimes=[];
 const sync=()=>{const value=read();for(const {key,input}of fields)if(document.activeElement!==input||!edits.state().active){if(input.type==='checkbox')input.checked=value[key];else input.value=String(value[key]);}};
 edits.register(target,{read,check:resolveReflectionSettings,write(value){write(value);sync();}});
 const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Reflection quality';detail.append(summary);
 for(const [key,label,type,step]of [['enabled','Screen reflections','checkbox',0],['resolutionScale','Resolution scale','number',.05],['steps','Trace steps','number',1],['maxDistance','Reflection distance','number',.1]]){
  const row=document.createElement('label');row.className='field';const grip=document.createElement('span');grip.textContent=label;const input=document.createElement('input');input.id='scene-reflections-'+key;input.type=type;input.className='transform-input';if(type==='number'){input.min=key==='steps'?'1':'0';if(key==='resolutionScale')input.max='1';input.step='any';}row.append(grip,input);(key==='enabled'?host:detail).append(row);fields.push({key,input});
  input.addEventListener(type==='checkbox'?'change':'input',()=>{if(edits.state().active?.id!==target||input.value===''||!input.validity.valid)return;edits.preview({...read(),[key]:type==='checkbox'?input.checked:Number(input.value)});});
  lifetimes.push(installSceneControlHistory({controls:[input],edits,id:target,label:'Edit '+label,onError:error=>{input.title=error.message;sync();}}));
  if(type==='number')lifetimes.push(installRelativeNumberDrag({input,grip,step}));
 }
 host.append(detail);
 const help=document.createElement('p');help.className='small';help.textContent='Preview reflections on opaque materials. Off-screen regions use environment lighting. Scene saving retains these reflection settings.';host.append(help);sync();
 return {sync,set:value=>edits.apply(target,resolveReflectionSettings({...read(),...value}),'Edit screen reflections'),commit(){for(const x of lifetimes)x.commit?.();},cancel(){for(const x of lifetimes)x.cancel?.();},dispose(){for(const x of lifetimes)x.dispose();}};
}
