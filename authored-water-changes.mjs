// Describe authored changes against the run that actually owns the particles.
// Material has a separate live-step contract, so it never requires a restart.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function authoredWaterChanges(activeSetup,nextSetup,activeSources,nextSources){
 const changes=[];
 for(const [key,label] of [['particleCount','Additional particle slots'],['waterSampling','Initial sampling / bounds'],['support','Collision support']])
  if(!same(activeSetup?.[key],nextSetup?.[key]))changes.push({key,label,active:activeSetup?.[key]??null,edited:nextSetup?.[key]??null});
 const finite=rows=>(rows??[]).filter(r=>r.localLiquidEmitter.mode==='finite_drop').map(({id,type,transform,localLiquidEmitter})=>({id,type,transform,localLiquidEmitter}));
 if(!same(finite(activeSources),finite(nextSources)))changes.push({key:'sources',label:'Initial water shape / placement',active:finite(activeSources),edited:finite(nextSources)});
 // Adding the first inlet needs extra slots not allocated by a finite-only run.
 if(!activeSources?.some(r=>r.localLiquidEmitter.mode!=='finite_drop')&&nextSources?.some(r=>r.localLiquidEmitter.mode!=='finite_drop'))changes.push({key:'inlets',label:'Emitter allocation'});
 return changes;
}
