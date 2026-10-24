// Every owner gets its cleanup attempt even when a neighboring owner rejects.
export async function disposeAsh({controls,patch,session,device,onError}){
 const errors=[];
 for(const release of [...controls.map(control=>()=>control.dispose()),()=>patch?.dispose(),()=>session.dispose(),()=>device?.removeEventListener('uncapturederror',onError)]){
  try{await release();}catch(error){errors.push(error);}
 }
 if(errors.length)throw new AggregateError(errors,'Ash cleanup failed');
}
