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
  let disposed=false,closing=false,disposal;const pending=new Set();
  const active=()=>{if(disposed||closing)throw Error('Stone owner handle is disposed');};
  const run=work=>{active();const task=Promise.resolve().then(work);pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;};
  return {
   read(){if(disposed)throw Error('Stone owner handle is disposed');return api.experimentStatus();},
   hold:()=>run(async()=>{api.pause(true);await api.waitSubmitted();}),
   resume:()=>run(()=>api.pause(false)),
   reset:()=>run(()=>api.reset()),tension:value=>run(()=>api.threshold(value)),
   grip:({pieceId,point,faceIndex})=>run(async()=>{const receipt=await api.pick(pieceId,point,faceIndex);if(receipt?.status==='cancelled'){const error=Error('Stone grip was superseded or cancelled');error.code='STONE_OPERATION_CANCELLED';throw error;}if(receipt?.status!=='applied')throw Error('Native grip application receipt required');return receipt;}),
   move:value=>run(()=>api.move(value)),release:()=>run(()=>api.release()),
   step:count=>run(async()=>{const before=api.experimentStatus();await api.waitSubmitted({gpu:false});for(let i=0;i<count;i++)await api.advance({evidence:false});const after=api.experimentStatus();if(after.runId!==before.runId||after.submittedSteps!==before.submittedSteps+count)throw Error('Stone did not submit the requested steps');}),
   view:value=>run(()=>api.camera(value)),
   observe:()=>run(async()=>{await api.settle();return api.witness();}),
   dispose(){if(!disposal){closing=true;disposal=(async()=>{await Promise.allSettled([...pending]);try{await api.release();}finally{disposed=true;leased=false;}})();}return disposal;},
  };
 }}};
}
