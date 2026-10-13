import {bindPaperPressureOperations} from './contributions.mjs';

/** Domain wrapper over Minion entry and Hotwet capabilities, with no host allocation on import. */
export function paperFluidExperiment({id,title,setup:build,inputs:accepted}) {
 const fields=new Set(accepted);
 return {id,title,
  async create({host,inputs={},record}) {
   if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw new TypeError('Paper setup inputs require an object');
   for(const key of Object.keys(inputs))if(!fields.has(key))throw new RangeError('Unknown Paper setup input: '+key);
   if(typeof host?.fluid?.open!=='function'||!host.fluid.rendererModes?.includes('screen_space_refraction'))throw new Error('Shared Fluid host capability unavailable');
   const initialSetup=build(inputs);
   // Shared entry selects the host's declared water view; standalone glyph viewing remains separate.
   const standaloneRenderer=initialSetup.solver.rendererMode;
   initialSetup.solver={...initialSetup.solver,rendererMode:'screen_space_refraction'};
   const presentation={standaloneRenderer,requestedSharedRenderer:'screen_space_refraction'};
   const water=await host.fluid.open(initialSetup);let mounted=null,reference=null;
   try {
    for(const name of ['read','getSolver','applyPressure','setPaused','advanceTo','restart','dispose'])if(typeof water?.[name]!=='function')throw new Error('Missing owner water capability: '+name);
    const pressure=bindPaperPressureOperations({getSolver:water.getSolver,applyPressure:water.applyPressure});pressure.read();
    const emit=(kind,phase,effective,requested)=>record({kind:'paper.fluid.'+kind,phase,target:id,effective,...(requested===undefined?{}:{requested})});
    const refresh=()=>mounted?.update();
    return {
     read:()=>({...water.read(),initialSetup,presentation,reference:reference?{...reference,current:pressure.referenceCurrent(reference)}:null}),
     operations:{
      edit({id:control,value,linkDamping=false}) {const result=pressure.edit(control,value,{linkDamping});emit('edit',result.generation===result.effectiveGeneration?'applied':'requested',result.effective,result.requested);refresh();return result;},
      deriveRange() {reference=pressure.deriveSoftness();emit('range','observed',reference);refresh();return reference;},
      pause(value) {if(typeof value!=='boolean')throw new TypeError('Pause requires boolean');const result=water.setPaused(value);emit('pause','applied',result,value);refresh();return result;},
      advance(step) {const result=water.advanceTo(step);emit('advance','applied',result,step);refresh();return result;},
      async restart() {const result=await water.restart();reference=null;emit('restart','applied',result);refresh();return result;},
     },
     mount({root,document=host.controls?.document,invoke}) {
      mounted?.dispose();
      if(!root||!document||typeof invoke!=='function')throw new Error('Shared extension mount requires root, document and invoke');
      const node=document.createElement('section');node.className='paper-fluid-experiment';
      const heading=document.createElement('h3');heading.textContent=initialSetup.guide.question;node.append(heading);
      for(const [label,text]of [['Try This',initialSetup.guide.tryThis],['Why This Matters',initialSetup.guide.whyThisMatters]]){
       const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');summary.textContent=label;body.textContent=text;details.append(summary,body);node.append(details);
      }
      const button=document.createElement('button');button.type='button';button.textContent='Record pressure reference';
      const output=document.createElement('output');output.setAttribute('aria-live','polite');
      const note=document.createElement('p');note.textContent='Pressure controls and playback use the shared Fluid instruments. This is a recorded reference; record again after changing inputs. Recording changes no water setting.';
      node.append(button,output,note);root.append(node);let disposed=false;
      const update=()=>{if(disposed)return;try{output.textContent=reference
       ?'Recorded reference · '+reference.brackets.map(b=>`${b.alternativeCompliance.toPrecision(5)}: ${Math.round(b.updateFraction*100)}% of hard correction`).join(' · ')+' · local compressed lattice, not basin motion.'
       :'No pressure reference recorded for this experiment.';}catch(error){output.textContent=error.message;}};
      const click=async()=>{button.disabled=true;try{await invoke('deriveRange');update();}catch(error){output.textContent=error.message;}finally{if(!disposed)button.disabled=false;}};
      button.addEventListener('click',click);update();
      mounted={update,dispose(){disposed=true;button.removeEventListener('click',click);node.remove();}};return mounted;
     },
     async dispose(){mounted?.dispose();await water.dispose();},
    };
   }catch(error){try{await water?.dispose?.();}catch(cleanup){throw new AggregateError([error,cleanup],'Paper experiment initialization and cleanup failed');}throw error;}
  },
 };
}
