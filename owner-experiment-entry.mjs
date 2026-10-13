import {loadExperimentContributions,openExperiment} from './workbench-experiments.mjs';

// Owner setup is frontend state. Recovery carries it in the hash so the
// immutable recipe wrapper keeps its own strict query parameters.
export function readOwnerExperimentAddress({search='',hash=''}={}) {
 const query=new URLSearchParams(search),fragment=new URLSearchParams(hash.replace(/^#/,''));
 const params=query.has('experiment')?query:fragment;
 return {id:params.get('experiment'),inputsText:params.get('experiment_inputs')??'{}'};
}

export function writeOwnerExperimentAddress(href,{id,inputs}) {
 const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1));
 for(const key of ['experiment','experiment_inputs']){url.searchParams.delete(key);hash.delete(key);}
 if(id){url.searchParams.set('experiment',id);url.searchParams.set('experiment_inputs',JSON.stringify(inputs));}
 url.hash=hash.toString();return url.href;
}

/** Discovery is metadata only; opening is explicit and serialized with disposal. */
export async function installOwnerExperimentEntry({document,root,host,discover,onOpen=()=>{},onChange=()=>{}}) {
 const section=document.createElement('section');section.className='owner-experiment-entry';
 section.innerHTML='<label>Experiment<select aria-label="Workbench experiment"><option value="">Choose an experiment…</option></select></label><button type="button">Refresh experiments</button><div class="owner-experiment-status" role="status"></div><div class="owner-experiment-content"></div>';
 root.append(section);
 const select=section.querySelector('select'),refresh=section.querySelector('button'),status=section.querySelector('[role=status]'),content=section.querySelector('.owner-experiment-content');
 let definitions=[],current=null,pending=Promise.resolve(),selected=null;
 const serial=action=>{const result=pending.then(action);pending=result.catch(()=>{});return result;};
 const fail=error=>{status.textContent=error.message||String(error);};
 async function close(){if(current){const old=current;current=null;selected=null;await old.dispose();}content.replaceChildren();}
 const api={
  list:()=>definitions.map(({id,title,moduleUrl})=>({id,title,moduleUrl})),
  state:()=>({id:current?.id??null,selected,moduleUrl:definitions.find(d=>d.id===selected)?.moduleUrl??null}),
  refresh(){return serial(async()=>{const urls=await discover();definitions=await loadExperimentContributions(urls);select.replaceChildren(new Option('Choose an experiment…',''),...definitions.map(d=>new Option(d.title,d.id)));select.value=current?.id??'';status.textContent=definitions.length?'':'No owner experiments found';return api.list();});},
  open(id,inputs={}){return serial(async()=>{
   const definition=definitions.find(d=>d.id===id);if(!definition)throw Error('Unknown experiment: '+id);
   await close();status.textContent='Opening '+definition.title+'…';await onOpen(definition,inputs);
   try{current=await openExperiment(definition,{host,inputs});selected=id;await current.mount({root:content,document});select.value=id;status.textContent=definition.title;onChange({id,inputs,moduleUrl:definition.moduleUrl});return current.read();}
   catch(error){await close();fail(error);throw error;}
  });},
  read:()=>{if(!current)throw Error('No experiment open');return current.read();},
  invoke:(name,input)=>serial(async()=>{if(!current)throw Error('No experiment open');return current.invoke(name,input);}),
  close:()=>serial(async()=>{await close();select.value='';status.textContent='';onChange({id:null,inputs:null});}),
 };
 select.addEventListener('change',()=>{if(select.value)api.open(select.value).catch(fail);else api.close().catch(fail);});
 refresh.addEventListener('click',()=>api.refresh().catch(fail));
 await api.refresh();return api;
}
