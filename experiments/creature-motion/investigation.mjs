import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readObservationSession} from '../../observation-session.mjs';
import {withHeldCreatureFrame} from './held-capture.mjs';

// The common mount is injected from the actual shared-tooling revision. This
// adapter owns creature context/hold/reopen, not another retention framework.
export async function mountCreatureInvestigation({page,out,source,guide={},frame,mountInvestigation}) {
 assert.equal(typeof mountInvestigation,'function','Pass the actual common investigation mount');
 const entry={
  state:()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.state()),
  read:()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read()),
  invoke:(name,input)=>page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input}),
 };
 const handle=await mountInvestigation({page,out,source,captureKind:'held-source-frame',
  async install({id,binding}){
   await page.evaluate(async({id,binding,source,guide})=>{
    const {installCreatureInvestigation}=await import('./experiments/creature-motion/investigation-browser.mjs');
    await installCreatureInvestigation({id,source,guide,request:value=>window[binding](value)});
   },{id,binding,source,guide});
   const call=(method,value)=>page.evaluate(async({id,method,value})=>window.__kaminosInvestigations.get(id)[method](value),{id,method,value});
   return {read:()=>call('read'),finish:()=>call('finish'),disconnect:message=>call('disconnect',message),
    saveFailed:message=>call('saveFailed',message),isPresent:()=>call('isPresent')};
  },
  async aroundCapture(retain){
   const transaction=await withHeldCreatureFrame({entry,frame,
    present:()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),
    capture:async()=>{
     const retained=await retain();
     assert.equal(retained.status,'passed','Shared image retention did not pass');
     const image=retained.observations?.[0]?.image;assert.equal(typeof image,'string','Shared retained image path missing');
     return {report:path.join(path.dirname(image),'report.json')};
    }});
   if(!['resumed','not-needed'].includes(transaction.restore.status)){
    const error=Error(`Creature image retained, but playback restoration ${transaction.restore.status}: ${transaction.restore.error??'instance changed'}`);
    error.retained=transaction.retained;error.restore=transaction.restore;throw error;
   }
  },
 });
 return {...handle,async reopen(reportPath){
  const retained=await readObservationSession(reportPath);
  assert.equal(retained.status,'passed','Cannot reopen failed image retention');
  assert.equal(retained.result?.interval,'no-observed-change','Captured pose/view changed during image retention');
  const observed=retained.result.after;
  assert.equal(observed.recording.complete,true,'Cannot reopen an incomplete operation recording');
  const recipe=observed.context.recipe,domain=observed.context.domain;
  assert.equal(recipe?.id,'marionette/retained-creature','Wrong captured experiment');
  assert.equal(recipe.inputs.source_sha256,source.rawMotionSha256,'Captured motion source differs');
  assert.equal(retained.source.bodySha256,source.bodySha256,'Captured body source differs');
  assert.equal(recipe.inputs.frame,domain.frame,'Captured recipe/frame mismatch');
  assert.notEqual(domain.status,'playing','Reopen requires a held source sample');
  assert.ok(Math.abs(domain.time-domain.frame/domain.source.fps)<1e-5,'Captured time is not a native source sample');
  const current=JSON.parse(await fs.readFile(handle.reportPath,'utf8'));
  if(current.status!=='finished')await handle.finish('Continue from the retained creature pose');
  // The retained prefix remains history; applying it again would double edits.
  const state=await page.evaluate(({id,inputs})=>window.kaminosWorkbenchExperiments.open(id,inputs),recipe);
  return {recipe,state,history:reportPath,recording:handle.reportPath};
 }};
}
