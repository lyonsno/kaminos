// Caller owns browser/profile; preserve both primary and cleanup outcomes.
export async function finishGiCostReport(report,{close,removeProfile,save}){
 const before={status:report.status,phase:report.phase};
 report.browserClosed=false;report.profileRemoved=false;report.cleanupErrors=[];
 const failed=(phase,error)=>{report.cleanupErrors.push({phase,error:String(error.stack??error)});report.preCleanupOutcome??=before;report.status='failed';report.phase='cleanup:'+phase;};
 try{
  if(close){try{await close();report.browserClosed=true;}catch(error){failed('browser-close',error);}}
  report.browserCleanup=close?(report.browserClosed?'closed':'unconfirmed'):'not-started';
  // An active/unknown browser can still hold the private profile. Retain it.
  if(removeProfile&&(!close||report.browserClosed)){try{await removeProfile();report.profileRemoved=true;}catch(error){failed('profile-remove',error);}}
  else if(removeProfile)report.profileRemovalDeferred='browser closure unconfirmed';
 }finally{await save();}
 return report.cleanupErrors.length===0;
}
