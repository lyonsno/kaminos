import {createStoneOwnerHost} from './structural-material-owner-host.mjs';
export {admitStoneSource,stoneSupportNodes} from './structural-material-source-setup.mjs';

export function stoneMaterialParameters(search){
 const query=new URLSearchParams(search),mesh=query.get('stoneMesh')??'fine',fragments=query.get('stoneFragments')??'fine';
 if(!['fine','coarse'].includes(mesh))throw Error('Stone granularity must be fine or coarse');
 if(!['fine','grains'].includes(fragments))throw Error('Stone fragments must be fine or grains');
 const response=query.get('stoneResponse')??'stiff-brittle-v2';
 if(!['stiff-brittle-v1','stiff-brittle-v2'].includes(response))throw Error('Unknown stone response');
 const fixture=query.get('stoneFixture');if(fixture!==null&&fixture!=='axial-chunks')throw Error('Unknown stone fixture');
 const motion=query.get('stoneMotion');if(motion!==null&&motion!=='coherent-translation')throw Error('Unknown stone motion');
 const parameters=new URLSearchParams({fracture:'bounded',connectivity:'elastic-support',inputs:mesh==='fine'?'./scratch/bounded-fine-inputs':'./scratch/shard-live-inputs',fragments,material:response});
 const preparedInput=query.get('stoneInputs');if(preparedInput!==null){if(!preparedInput.trim())throw Error('Explicit prepared input path required');parameters.set('inputs',preparedInput);}
 if(query.has('stoneGrainScale'))parameters.set('grainScale',query.get('stoneGrainScale'));
 if(fixture!==null)parameters.set('fixture',fixture);
 if(motion!==null)parameters.set('motion',motion);
 return parameters;
}

function stoneControls(document){
 const node=document.createElement('section'),nodes=new Map();node.className='stone-experiment-controls';node.style.cssText='display:grid;gap:10px;min-width:0';
 const make=(tag,id)=>{const item=document.createElement(tag);nodes.set(id,item);return item;};
 const commands=document.createElement('div');commands.style.cssText='display:flex;gap:8px';
 for(const [id,title] of [['reset','Reset stone'],['pause','Pause material'],['release','Release grip']]){const button=make('button',id);button.type='button';button.title=title;button.setAttribute('aria-label',title);button.style.cssText='width:36px;height:36px;display:grid;place-items:center;border-radius:4px';commands.append(button);}
 const label=document.createElement('label');label.textContent='Tension';label.style.cssText='display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center';
 const output=make('output','thresholdValue'),input=make('input','threshold');input.type='range';input.min='2';input.max='720';input.step='1';input.value='180';input.setAttribute('aria-label','Tension');input.style.cssText='width:100%;grid-column:1 / -1';output.value='180';label.append(output,input);node.append(commands,label);
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Runtime';details.append(summary);
 for(const id of ['route','stats','timing','failure']){const item=make('output',id);item.style.cssText='display:block;overflow-wrap:anywhere;font:12px ui-monospace,monospace;margin-top:6px';details.append(item);}
 node.append(details);return {node,nodes,getElementById:id=>nodes.get(id)??null};
}

export function createStoneWorkbenchCapability(viewport,{createRuntime=async options=>(await import('./structural-material-shard-view.js')).createStoneRuntime(options)}={}){
 let current=null,panel=null,opening=false;
 return {stone:{async open(inputs={}, {record}={}){
  if(current||opening)throw Error('Close the current stone before opening another');
  for(const key of Object.keys(inputs))if(!['threshold','paused'].includes(key))throw Error(`Unsupported stone setup ${key}`);
  if(inputs.threshold!==undefined&&(!Number.isFinite(inputs.threshold)||inputs.threshold<=0))throw Error('Tension must be positive');
  if(inputs.paused!==undefined&&typeof inputs.paused!=='boolean')throw Error('Pause must be boolean');
  opening=true;let api;
  try{
  panel=stoneControls(viewport.document);
  const parameters=stoneMaterialParameters(globalThis.location?.search??'');
  api=await createRuntime({host:viewport,ui:panel,parameters,onInput:({kind,data,effective})=>record?.({kind:`stone.input.${kind}`,target:'stone',phase:'applied',requested:data,effective,actor:'producer-input'})});
  api.object.userData.kaminosExperiment={id:'stone/fracture',source:api.experimentStatus().sourceSha256};
  const owner=createStoneOwnerHost(api),handle=await owner.stone.open(inputs);
  current=api;
  return {...handle,read:()=>({...handle.read(),viewport:api.viewport}),async dispose(){try{await handle.dispose();}finally{try{await api.dispose();}finally{if(api.disposalStatus()?.complete){panel?.node.remove();current=null;panel=null;}else api.reportFailure(new Error('Stone cleanup incomplete; runtime retained'));}}},api};
  }catch(error){await api?.dispose();panel?.node.remove();current=null;panel=null;throw error;}finally{opening=false;}
 }},controls:{mountStone({root,invoke}){
  if(!panel)throw Error('Stone controls require an opened material');const mounted=panel;root.append(mounted.node);
  const fields=[['reset','onclick',()=>invoke('reset')],['release','onclick',()=>invoke('release')],['pause','onclick',()=>invoke(current.experimentStatus().paused?'resume':'hold')],['threshold','oninput',event=>invoke('tension',Number(event.target.value))]];
  const previous=fields.map(([id,field,handler])=>{const item=mounted.getElementById(id),old=item[field];item[field]=event=>handler(event).catch(error=>current?.reportFailure(error));return[item,field,old];});
  return {dispose(){for(const [item,field,old] of previous)item[field]=old;mounted.node.remove();}};
 }},current:()=>current};
}
