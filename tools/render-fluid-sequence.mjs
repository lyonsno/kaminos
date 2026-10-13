#!/usr/bin/env node
// Canonical invocation: --inputs caller-owned.json --out caller-owned-directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';
import {createFluidSequenceAdapter} from '../fluid-sequence-adapter.mjs';
import {renderSequence} from '../simulation-sequence.mjs';
import {createDirectorySequenceSink} from '../sequence-directory.mjs';
const {values:early}=parseArgs({options:{out:{type:'string'}},strict:false});
if(!early.out)throw Error('--out is required');
const out=path.resolve(early.out),sink=await createDirectorySequenceSink(out);
const abort=new AbortController();
let browser,page,closing,phase='inputs',failed=false,cancelled=false,sequenceFinished=false;
const close=()=>closing??=(browser?browser.close():Promise.resolve());
const cancel=signal=>{
 abort.abort(signal);
 // Startup waits and capture/step calls are released by closing only our browser.
 // Their rejection settles the runner before the terminal manifest is written.
 if(browser)void close().catch(()=>{});
};
const interrupt=()=>cancel('SIGINT'),terminate=()=>cancel('SIGTERM');
process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
const active=()=>{if(abort.signal.aborted)throw Error('Sequence cancelled: '+abort.signal.reason);};
try{
 await sink.begin({argv:process.argv.slice(2)});
 const {values}=parseArgs({options:{inputs:{type:'string'},out:{type:'string'}}});
 if(!values.inputs)throw Error('--inputs is required');
 const inputs=JSON.parse(await fs.readFile(values.inputs,{encoding:'utf8',signal:abort.signal}));
 if(!inputs.url||!inputs.repo||!inputs.browser||!inputs.playwright)throw Error('Inputs require url, repo, independent browser and playwright paths');
 const experiment=new URL(inputs.url).searchParams.get('experiment');
 if(!experiment)throw Error('Sequence URL must name an owner experiment');
 const viewport=inputs.viewport??{width:1600,height:1000};
 phase='source';active();
 const source=await fluidSourceIdentity(inputs.url,inputs.repo,{signal:abort.signal,additionalFiles:['experiments/lazarus-fluid/finite-pbf.experiment.mjs','experiments/lazarus-fluid/contributions.mjs','finger-fluid-box-clock.mjs','owner-experiment-entry.mjs','workbench-experiments.mjs']});
 phase='browser';active();
 const launch=fluidBrowserLaunch({executable:inputs.browser,debugPort:0,userDataDir:out,width:viewport.width,height:viewport.height});
 const {chromium}=await import(pathToFileURL(path.resolve(inputs.playwright)));active();
 // A pending launch must settle so a late-created browser is also owned/closed.
 browser=await chromium.launch({executablePath:launch.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 active();page=await browser.newPage({viewport});active();
 page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{
  window.__kaminosSequenceStartupErrors=[];
  window.addEventListener('error',e=>window.__kaminosSequenceStartupErrors.push(e.message));
  window.addEventListener('unhandledrejection',e=>window.__kaminosSequenceStartupErrors.push(String(e.reason)));
 });
 page.on('console',message=>{if(message.type()==='error')console.error('Browser:',message.text());});
 const resourceFailure=message=>{
  errors.push(message);console.error(message);
  void page.evaluate(message=>window.__kaminosSequenceStartupErrors?.push(message),message).catch(()=>{});
 };
 page.on('response',response=>{if(response.request().resourceType()==='script'&&response.status()>=400)resourceFailure('Required script HTTP '+response.status()+': '+response.url());});
 page.on('requestfailed',request=>{if(['script','document'].includes(request.resourceType()))resourceFailure('Required resource failed: '+request.url()+' '+request.failure()?.errorText);});
 phase='navigate';active();await page.goto(inputs.url);active();
 phase='owner-startup';await sink.begin({phase,inputsFile:path.resolve(values.inputs),url:page.url(),source});
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id||window.__kaminosSequenceStartupErrors?.length||window.kaminosFingerFluidBenchDebugState?.().status==='error'||document.querySelector('.owner-experiment-status')?.textContent?.startsWith('Unknown experiment:'));
 active();if(errors.length)throw Error(errors.join('\n'));
 const selected=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id);
 if(selected!==experiment)throw Error('Requested experiment was not opened: '+selected);
 phase='settle';await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));active();
 phase='render-sequence';
 await renderSequence({adapter:createFluidSequenceAdapter({page,source:{...source,url:page.url(),browser:browser.version(),executable:launch.executable,viewport}}),sink,request:inputs.sequence,signal:abort.signal});
 sequenceFinished=true;active();if(errors.length)throw Error(errors.join('\n'));
}catch(error){
 if(abort.signal.aborted)cancelled=true;
 else{
  failed=true;
  if(page)try{
   await fs.writeFile(path.join(out,'failure.png'),await page.screenshot());
   await fs.writeFile(path.join(out,'failure-state.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,owner:window.kaminosWorkbenchExperiments?.state(),clock:window.kaminosFingerFluidBenchSessionState?.(),errors:window.__kaminosSequenceStartupErrors,status:document.querySelector('.owner-experiment-status')?.textContent})),null,2));
  }catch(captureError){console.error('Failure capture:',String(captureError));}
  if(phase!=='render-sequence'||sequenceFinished)await sink.finish({status:'failed',complete:false,failurePhase:phase,failure:String(error.stack||error)});
  process.exitCode=1;console.error(String(error.stack||error));
 }
}finally{
 try{await close();}
 catch(error){failed=true;process.exitCode=1;await sink.finish({status:'failed',complete:false,failurePhase:'cleanup',failure:String(error.stack||error)});}
 // A cancellation races no further runner writes: startup/runner and owned close
 // have settled. Completed frame counts remain the sink's existing ledger.
 if(cancelled&&!failed){
  await sink.finish({status:'cancelled',complete:false,phase:'cancelled',cancelledDuring:phase,cancellation:abort.signal.reason,failure:null,failurePhase:null});
  process.exitCode=abort.signal.reason==='SIGTERM'?143:130;
 }
 process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
 console.log(JSON.stringify({out,manifest:path.join(out,'sequence.json'),failed,cancelled}));
}
