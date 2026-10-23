// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8');
assert.match(source,/basin\.open=false/, 'basin library starts collapsed so Material controls remain visible');
const handler=source.slice(source.indexOf('  const byId=id=>document.getElementById(id);',source.indexOf('export function createFlameInspector')),source.indexOf('  const aliases=[];'));
class Select {
  options=[];selected='';
  get value(){return this.selected;}
  set value(value){this.selected=this.options.some(o=>o.value===value)?value:'';}
  replaceChildren(){this.options=[];this.selected='';}
  append(option){this.options.push(option);if(!this.selected)this.selected=option.value;}
}
async function exercise(index,result,{fail=false}={}) {
  const elements=new Map();
  for(const id of ['flame-basin-search','flame-basin-refresh','flame-basin-save','flame-basin-label','flame-basin-apply','flame-basin-status'])
    elements.set(id,{value:'',disabled:false,addEventListener(){},focus(){}});
  elements.set('flame-basin-select',new Select());
  elements.get('flame-basin-label').value='Fire';
  const applied=[],errors=[];
  vm.runInNewContext(handler,{
    document:{getElementById:id=>elements.get(id),createElement:()=>({})},
    listBasins:async()=>index,saveBasin:async()=>{if(fail)throw Error('Save failed');return result;},
    applyBasin:async id=>{applied.push(id);return {};},
    describeVolumeSettingsSaveOutcome:()=>({text:''}),onError:error=>errors.push(error.message),sync(){},
  });
  await elements.get('flame-basin-save').onclick();
  if(!fail){
    assert.equal(elements.get('flame-basin-select').value,result.effective.presetId,'select exact immutable saved version');
    await elements.get('flame-basin-apply').onclick();
    assert.deepEqual(applied,[result.effective.presetId]);
  } else {
    assert.equal(elements.get('flame-basin-status').textContent,'Save failed');
    assert.deepEqual(errors,['Save failed']);
  }
  assert.equal(elements.get('flame-basin-save').disabled,false);
}
const saved={presetId:'saved',label:'Fire'};
await exercise({entries:[saved]},{effective:saved});
await exercise({entries:[{presetId:'previous',label:'Fire'}],earlierVersions:[{...saved,reason:'held-label'}]},
  {effective:saved,aliasHeld:{reason:'would-replace-values'}});
await exercise({entries:[]},{effective:saved},{fail:true});
console.log('Properties save selects and applies exact ordinary and held-label versions; failures remain visible');
