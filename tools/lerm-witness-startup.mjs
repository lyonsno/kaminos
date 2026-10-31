export {waitForLermState} from './lerm-witness-state.mjs';
export async function waitForLermScene(page, recordedErrors=[]) {
  const fatal=text=>text.startsWith('initScene failed:');
  const prior=recordedErrors.find(fatal);
  if(prior)throw Error(prior);
  let listener;
  const failed=new Promise((resolve,reject)=>{
    listener=message=>{if(message.type()==='error'&&fatal(message.text()))reject(Error(message.text()));};
    page.on?.('console',listener);
  });
  try{return await Promise.race([failed,page.waitForFunction(() => {
    if (window.kaminosWorkbenchExperimentError) throw Error(window.kaminosWorkbenchExperimentError);
    const state = window.kaminosWorkbenchExperiments?.state();
    if (document.body.innerText.includes('Experiments unavailable')) throw Error(document.body.innerText);
    return state?.id === 'lerms/hand-goin';
  }, undefined, {timeout: 0})]);}
  finally{page.off?.('console',listener);}
}
