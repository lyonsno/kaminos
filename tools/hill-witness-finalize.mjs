// Closure is evidence too. A cleanup failure must never hide the primary
// outcome or prevent the final report from being attempted.
export async function finishHillWitness(report,{close,postflight=async()=>{},save}){
 if(close)try{await close();report.closed=true;}catch(error){report.cleanupError=error.stack??String(error);if(report.status!=='failed'){report.lastTrustworthyPhase=report.phase;report.phase='cleanup';}report.status='failed';}
 if(report.status==='passed')try{await postflight();}catch(error){report.lastTrustworthyPhase=report.phase;report.phase='source-postflight';report.status='failed';report.error=error.stack??String(error);}
 await save();
}
