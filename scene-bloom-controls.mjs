import {checkedSceneBloom} from './scene-bloom.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
export function installSceneBloomControls({document,host,edits,read,write}){
 const target='@scene-bloom',fields=[],lifetimes=[];
 const sync=()=>{const value=read();for(const {key,input}of fields)if(document.activeElement!==input||!edits.state().active){if(input.type==='checkbox')input.checked=value[key];else input.value=String(value[key]);}};
 edits.register(target,{read,check:checkedSceneBloom,write(value){write(value);sync();}});
 const title=document.createElement('h3');title.textContent='Emission bloom';host.append(title);
 for(const [key,label,type,max,step]of [['enabled','Bloom','checkbox',null,0],['strength','Bloom strength','number',1,.001],['radius','Glow width','number',1,.001]]){
  const row=document.createElement('label');row.className='field';const grip=document.createElement('span');grip.textContent=label;const input=document.createElement('input');input.id='scene-bloom-'+key;input.type=type;input.className='transform-input';if(type==='number'){input.min='0';input.max=String(max);input.step='any';}row.append(grip,input);host.append(row);fields.push({key,input});
  input.addEventListener(type==='checkbox'?'change':'input',()=>{if(edits.state().active?.id!==target||input.value===''||!input.validity.valid)return;edits.preview({...read(),[key]:type==='checkbox'?input.checked:Number(input.value)});});
  lifetimes.push(installSceneControlHistory({controls:[input],edits,id:target,label:'Edit '+label,onError:error=>{input.title=error.message;sync();}}));
  if(type==='number'){const scrub=installRelativeNumberDrag({input,grip,step});lifetimes.push(scrub);lifetimes.push({dispose:edits.subscribe(()=>{if(!edits.state().active)scrub.stop();})});input.addEventListener('blur',sync);}
 }
 const help=document.createElement('p');help.className='flame-scope';help.textContent='Width 0 adds no halo. Increase through fine to broad glow. Strength adjusts only emitted light.';host.append(help);sync();
 return {sync,commit(){for(const lifetime of lifetimes)lifetime.commit?.();},cancel(){for(const lifetime of lifetimes)lifetime.cancel?.();},set:value=>edits.apply(target,checkedSceneBloom({...read(),...value}),'Edit emission bloom'),dispose(){for(const lifetime of lifetimes)lifetime.dispose();}};
}
