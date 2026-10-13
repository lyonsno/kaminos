import {loadExperimentContributions,openExperiment} from './workbench-experiments.mjs';
import {createInvestigationRecording,investigationOperations} from './investigation-recording.mjs';
import {createStoneOwnerHost} from './structural-material-owner-host.mjs';

export async function openStoneOwnerExperiment(api,{document,source,inputs={}}){
 const definitions=await loadExperimentContributions(['./experiments/stone/stone-fracture.experiment.mjs']);
 let current;
 const bindings=[];
 const bind=(node,field,value)=>{if(!node)throw Error('Stone control mount is incomplete');bindings.push([node,field,node[field]]);node[field]=value;};
 const restore=()=>{const errors=[];for(const [node,field,previous] of bindings.splice(0).reverse())try{node[field]=previous;}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stone control restoration failed');};
 const host=createStoneOwnerHost(api,{mountStone({invoke}){
  try{
  bind(document.getElementById('reset'),'onclick',()=>invoke('reset').catch(api.reportFailure));
  bind(document.getElementById('release'),'onclick',()=>invoke('release').catch(api.reportFailure));
  bind(document.getElementById('pause'),'onclick',()=>invoke(api.experimentStatus().paused?'resume':'hold').catch(api.reportFailure));
  bind(document.getElementById('threshold'),'oninput',event=>invoke('tension',Number(event.target.value)).catch(api.reportFailure));
  return {dispose:restore};
  }catch(error){try{restore();}catch(cleanup){throw new AggregateError([error,cleanup],'Stone mount and restoration failed');}throw error;}
 }});
 const initial=api.experimentStatus(),recording=createInvestigationRecording({id:crypto.randomUUID(),source,initial,startingConditions:{kind:'mounted-native-stone',runId:initial.runId,authoredSetup:inputs}});
 let mount;
 try{current=await openExperiment(definitions[0],{host,inputs});mount=await current.mount({});}
 catch(error){try{await current?.dispose();}finally{recording.finish();}throw error;}
 return Object.freeze({id:current.id,title:current.title,operationNames:current.operationNames,read:current.read,invoke:current.invoke,recording:()=>recording.snapshot(),finish:()=>recording.finish(),
  recordInput(kind,requested,effective){investigationOperations.emit({kind:`stone.input.${kind}`,phase:'applied',target:'stone',requested,effective,actor:'producer-input'});},
  async dispose(){try{await current.dispose();}finally{try{mount?.dispose();}finally{recording.finish();}}},
 });
}
