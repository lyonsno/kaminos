// Playwright 1.63 polls predicate truthiness, not an async predicate's resolved
// Boolean. Await each read separately, then expose only a synchronous Boolean.
export function restoredBodyPoll(){
 const probe=window.__skeletonOpenProbe;
 if(probe.error)throw Error(probe.error);
 if(probe.state?.joints?.length===probe.jointCount&&probe.state.objectId!==probe.previousId)return true;
 if(!probe.pending){
  probe.pending=true;
  Promise.resolve().then(()=>window.kaminosWorkbenchExperiments.read()).then(state=>{
   probe.reads++;
   if(probe.reads<=probe.delayReads){probe.state=null;return;}
   probe.state=probe.forcePreviousIdentity&&state?{...state,objectId:probe.previousId}:state;
  }).catch(error=>{probe.error=String(error?.message??error);}).finally(()=>{probe.pending=false;});
 }
 return false;
}
export async function waitForRestoredBody(page,{previousId,jointCount,delayReads=0,forcePreviousIdentity=false}){
 if(!Number.isInteger(delayReads)||delayReads<0)throw Error('Nonnegative delayed-read count required');
 await page.evaluate(config=>{window.__skeletonOpenProbe={...config,pending:false,state:null,reads:0,error:null};},{previousId,jointCount,delayReads,forcePreviousIdentity});
 await page.waitForFunction(restoredBodyPoll);
 return page.evaluate(()=>({reads:window.__skeletonOpenProbe.reads,objectId:window.__skeletonOpenProbe.state.objectId,jointCount:window.__skeletonOpenProbe.state.joints.length}));
}
