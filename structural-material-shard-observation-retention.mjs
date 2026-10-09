import assert from 'node:assert/strict';
import path from 'node:path';

// Keep every full observation in the shared kit, without aggregating dense
// fracture histories into one repeatedly serialized JavaScript string.
export function createShardObservationWork({out,source,observationSession,experiment,runtime,capture,record}){
 return {async observe(name,options){
  const directory=path.join(out,name),reference={name,report:path.join(directory,'report.json'),status:'running'};
  record({...reference});
  try{
   const session=await observationSession({out:directory,source,capture,exercise:async({retain})=>experiment({runtime,retain}).observe(name,options)});
   assert.ok(session.status==='passed'&&session.result?.status==='verified'&&session.result.observed,'Shared observation was not verified');
   record({...reference,status:'passed'});return session.result;
  }catch(error){record({...reference,status:'failed',error:error.message});throw error;}
 }};
}
