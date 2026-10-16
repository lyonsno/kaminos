// Preserve the existing control, events, source identity and owner transactions.
// Only its presentation changes; settings collectors can still find the range.
export function bindRangeNumber(source,input) {
  let owner=source,descriptor;
  while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'value');owner=Object.getPrototypeOf(owner);}
  let value=source.value;
  const read=()=>descriptor?.get?descriptor.get.call(source):value;
  const sync=(force=false)=>{
    if(force||input.ownerDocument?.activeElement!==input||input.readOnly)input.value=read();
  };
  Object.defineProperty(source,'value',{configurable:true,get:read,set(next){
    if(descriptor?.set)descriptor.set.call(source,next);else value=String(next);
    sync();
  }});
  const forward=type=>source.dispatchEvent(new Event(type,{bubbles:true}));
  input.addEventListener('input',()=>{
    if(input.value===''||!Number.isFinite(Number(input.value)))return;
    source.value=input.value;forward('input');
  });
  input.addEventListener('change',()=>{sync(true);forward('change');});
  for(const type of ['focusin','beforeinput','blur'])input.addEventListener(type,()=>forward(type));
  input.addEventListener('pointercancel',()=>{forward('pointercancel');sync(true);});
  input.addEventListener('keydown',event=>{
    if(['Enter','Escape'].includes(event.key)) {
      source.dispatchEvent(new KeyboardEvent('keydown',{key:event.key,bubbles:true}));
      input.blur?.();
    }
  });
  source.addEventListener('input',()=>sync());source.addEventListener('change',()=>sync());
  sync(true);
}

export function installLegacyRangeFields({root,installNumberDrag,beforeEdit=()=>{}}) {
  const installed=[];
  for(const source of root.querySelectorAll('input[type="range"]')) {
    if(source.dataset.scrubField)continue;
    const row=source.closest('.slider-row,.burner-field');
    if(!row)continue;
    const paired=row.querySelector('input[type="number"]');
    // Existing paired controls already have their owner's binding and history.
    if(paired?.classList.contains('authoring-number')) {
      source.style.display='none';source.dataset.scrubField=paired.id;
      continue;
    }
    // A paired field whose owner hasn't installed its interactions is left to
    // that owner rather than gaining a second conflicting edit binding.
    if(paired)continue;
    const doc=source.ownerDocument,input=doc.createElement('input');
    input.type='number';input.id='legacy-number-'+source.id;input.className='legacy-range-number';
    const label=row.querySelector('label'),labelText=label?.textContent?.trim()||source.getAttribute('aria-label')||source.id;
    input.setAttribute('aria-label',labelText);input.step='any';
    for(const key of ['min','max','disabled'])input[key]=source[key];
    source.before(input);bindRangeNumber(source,input);
    const scrub=installNumberDrag({input,grip:label,step:Number(source.step)||.01,onStart:beforeEdit});
    source.style.display='none';source.dataset.scrubField=input.id;
    for(const output of row.querySelectorAll('output,.slider-val'))output.hidden=true;
    new doc.defaultView.MutationObserver(()=>{
      for(const key of ['min','max','disabled'])input[key]=source[key];
    }).observe(source,{attributes:true,attributeFilter:['min','max','disabled']});
    installed.push({source,input,scrub});
  }
  return installed;
}
