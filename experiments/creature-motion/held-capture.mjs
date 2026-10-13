// Creature-side observation manipulation. The injected capture owns existing
// image/recording retention; this module neither renders nor writes another store.
const expect=(condition,message)=>{if(!condition)throw Error(message);};
const viewKeys=['position','target','up','fov','zoom','near','far'];
const viewIdentity=view=>JSON.stringify(viewKeys.map(key=>view?.[key]));
export function sameCreatureBody(a,b){return !!a&&!!b&&a.rootUuid===b.rootUuid&&a.asset?.id===b.asset?.id
 &&a.asset?.bodySha256===b.asset?.bodySha256&&a.source?.source_sha256===b.source?.source_sha256&&a.clipName===b.clipName;}
export function sameHeldCreatureFrame(a,b){return sameCreatureBody(a,b)&&a.frame===b.frame&&a.status===b.status&&viewIdentity(a.view)===viewIdentity(b.view)&&JSON.stringify(a.transform)===JSON.stringify(b.transform);}
const sameBody=sameCreatureBody,sameHeld=sameHeldCreatureFrame;

export async function withHeldCreatureFrame({entry,frame,present,capture}) {
 expect(typeof entry?.read==='function'&&typeof entry?.invoke==='function'&&typeof entry?.state==='function','Creature observation requires the actual experiment entry');
 expect(typeof present==='function'&&typeof capture==='function','Creature observation requires presentation and existing retention callbacks');
 const id=(await entry.state()).id;
 expect(id==='marionette/retained-creature','Creature experiment is not open');
 const before=await entry.read();
 expect(typeof before.rootUuid==='string'&&typeof before.asset?.id==='string','Creature observation requires actual root and registration identity');
 expect(frame===undefined||(Number.isInteger(frame)&&frame>=0&&frame<before.source.frames),'Creature capture frame is outside the source');
 let held,retained,failure,restore={status:'not-needed'};
 try {
  held=await entry.invoke('hold',{expected:before,...(frame===undefined?{}:{frame})});
  expect(sameBody(before,held.state),'Creature body changed before hold');
  expect(held.inputs?.frame===held.state.frame&&held.inputs?.source_sha256===before.source.source_sha256,'Creature held recipe differs from the observed source');
  if(frame!==undefined)expect(held.state.frame===frame,'Creature held frame differs from the chosen source frame');
  await present(held);
  expect((await entry.state()).id===id&&sameHeld(held.state,await entry.read()),'Creature held state changed before capture');
  retained=await capture(held);
  expect(typeof retained?.report==='string'&&retained.report.length>0,'Creature retention did not return its report path');
  expect((await entry.state()).id===id&&sameHeld(held.state,await entry.read()),'Creature held state changed during capture');
 } catch(error){failure=error instanceof Error?error:Error(String(error),{cause:error});}
 finally {
  if(held?.priorStatus==='playing'){
   try {
    let current;
    if((await entry.state()).id===id){try{current=await entry.read();}catch{}}
    if(!sameBody(before,held.state)||!current||!sameHeld(held.state,current))restore={status:'skipped-changed'};
    else {
     // Identity validation and mutation happen together inside the actual
     // queued creature operation; another passive read cannot close this race.
     restore=await entry.invoke('restore',{expected:held.state});
    }
   }catch(error){restore={status:'failed',error:String(error?.message||error)};}
  }
 }
 if(failure){failure.held=held;failure.retained=retained;failure.restore=restore;throw failure;}
 return {held,retained,restore};
}
