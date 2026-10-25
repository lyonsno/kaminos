import {loadExperimentContributions,openExperiment} from './workbench-experiments.mjs';

// Owner setup is frontend state. Recovery carries it in the hash so the
// immutable recipe wrapper keeps its own strict query parameters.
export function readOwnerExperimentAddress({search='',hash=''}={}) {
 const query=new URLSearchParams(search),fragment=new URLSearchParams(hash.replace(/^#/,''));
 const params=query.has('experiment')?query:fragment;
 return {id:params.get('experiment'),inputsText:params.get('experiment_inputs')??'{}'};
}

// A saved-basin page's query is a strict settings-preset recipe that admission
// validates exactly, so its owner setup lives in the hash; ordinary pages keep
// a shareable query.
export function writeOwnerExperimentAddress(href,{id,inputs}) {
 const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1));
 for(const key of ['experiment','experiment_inputs']){url.searchParams.delete(key);hash.delete(key);}
 const target=url.searchParams.has('settings_preset')?hash:url.searchParams;
 if(id){target.set('experiment',id);target.set('experiment_inputs',JSON.stringify(inputs));}
 url.hash=hash.toString();return url.href;
}

/** Discovery is metadata only; opening is explicit and serialized with disposal. */
export async function installOwnerExperimentEntry({document,root,host,discover,onOpen=()=>{},onChange=()=>{}}) {
 const section=document.createElement('section');section.className='owner-experiment-entry';
 section.innerHTML='<label>Experiment<select aria-label="Workbench experiment"><option value="">Choose an experiment…</option></select></label><button type="button">Refresh experiments</button><div class="owner-experiment-status" role="status"></div><div class="owner-experiment-diagnostics"></div><div class="owner-experiment-content"></div>';
 root.append(section);
 const select=section.querySelector('select'),refresh=section.querySelector('button'),status=section.querySelector('[role=status]'),content=section.querySelector('.owner-experiment-content');
 const diagnostics=section.querySelector('.owner-experiment-diagnostics');
 let definitions=[],current=null,pending=Promise.resolve(),selected=null,currentModuleUrl=null;
 const serial=action=>{const result=pending.then(action);pending=result.catch(()=>{});return result;};
 const fail=error=>{status.textContent=error.message||String(error);};
 async function close(){if(current){const old=current;current=null;selected=null;currentModuleUrl=null;await old.dispose();}content.replaceChildren();}
 const api={
  list:()=>definitions.map(({id,title,moduleUrl,error})=>({id,title,moduleUrl,...(error?{error}:{})})),
  state:()=>({id:current?.id??null,selected,moduleUrl:currentModuleUrl}),
  refresh(){return serial(async()=>{const entries=await discover();definitions=await loadExperimentContributions(entries);select.replaceChildren(new Option('Choose an experiment…',''),...definitions.map(d=>{const option=new Option(d.title??d.moduleUrl??'Unavailable experiment',d.id??'');option.disabled=Boolean(d.error);return option;}));diagnostics.textContent=definitions.filter(d=>d.error).map(d=>d.error).join('\n');select.value=current?.id??'';status.textContent=definitions.length?'':'No owner experiments found';return api.list();});},
  open(id,inputs={}){return serial(async()=>{
   const definition=definitions.find(d=>d.id===id);if(!definition)throw Error('Unknown experiment: '+id);if(definition.error)throw Error(definition.error);
   await close();status.textContent='Opening '+definition.title+'…';
   try{await onOpen(definition,inputs);current=await openExperiment(definition,{host,inputs,onInputsChange:value=>onChange({id,inputs:value,moduleUrl:definition.moduleUrl})});selected=id;currentModuleUrl=definition.moduleUrl;await current.mount({root:content,document});select.value=id;status.textContent=definition.title;onChange({id,inputs,moduleUrl:definition.moduleUrl});return current.read();}
   catch(error){await close();select.value='';onChange({id:null,inputs:null});fail(error);throw error;}
  });},
  read:()=>{if(!current)throw Error('No experiment open');return current.read();},
  invoke:(name,input)=>serial(async()=>{if(!current)throw Error('No experiment open');return current.invoke(name,input);}),
  close:()=>serial(async()=>{await close();select.value='';status.textContent='';onChange({id:null,inputs:null});}),
 };
 select.addEventListener('change',()=>{if(select.value)api.open(select.value).catch(fail);else api.close().catch(fail);});
 refresh.addEventListener('click',()=>api.refresh().catch(fail));
 await api.refresh();return api;
}
