import {requireNativeStone} from './experiments/stone/stone-fracture.experiment.mjs';

// This borrows the accepted producer runtime. Shared Workbench scene mounting
// remains a separate host capability, not an iframe or a second simulation.
export function createStoneOwnerHost(api,{mountStone}={}){
 let leased=false;
 return {controls:{mountStone},stone:{async open(inputs={}){
  if(leased)throw Error('Stone runtime already has an experiment owner');
  for(const key of Object.keys(inputs))if(!['threshold','paused'].includes(key))throw Error(`Unsupported stone setup ${key}`);
  if(inputs.threshold!==undefined&&(!Number.isFinite(inputs.threshold)||inputs.threshold<=0))throw Error('Tension must be positive');
  if(inputs.paused!==undefined&&typeof inputs.paused!=='boolean')throw Error('Pause must be boolean');
  requireNativeStone(api.experimentStatus());leased=true;
  if(inputs.threshold!==undefined)api.threshold(inputs.threshold);
  if(inputs.paused!==undefined)api.pause(inputs.paused);
  let disposed=false;
  const active=()=>{if(disposed)throw Error('Stone owner handle is disposed');};
  return {
   read(){active();return api.experimentStatus();},
   async hold(){active();api.pause(true);await api.waitSubmitted();},
   resume(){active();api.pause(false);},
   reset(){active();return api.reset();},tension(value){active();api.threshold(value);},
   grip({pieceId,point,faceIndex}){active();return api.pick(pieceId,point,faceIndex);},
   move(value){active();api.move(value);},release(){active();return api.release();},
   async step(count){active();const before=api.experimentStatus();await api.waitSubmitted({gpu:false});for(let i=0;i<count;i++)await api.advance({evidence:false});const after=api.experimentStatus();if(after.runId!==before.runId||after.submittedSteps!==before.submittedSteps+count)throw Error('Stone did not submit the requested steps');},
   view(value){active();return api.camera(value);},
   async observe(){active();await api.settle();return api.witness();},
   async dispose(){if(disposed)return;disposed=true;try{await api.release();}finally{leased=false;}},
  };
 }}};
}
