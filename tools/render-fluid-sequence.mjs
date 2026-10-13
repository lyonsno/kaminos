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
const values={...early};
if(!values.out)throw Error('--out is required');
const out=path.resolve(values.out),sink=await createDirectorySequenceSink(out);
let browser,page,phase='inputs',sequenceFinished=false;const abort=new AbortController();
const cancel=()=>abort.abort();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
try{
 await sink.begin({argv:process.argv.slice(2)});
 Object.assign(values,parseArgs({options:{inputs:{type:'string'},out:{type:'string'}}}).values);
 if(!values.inputs)throw Error('--inputs is required');
 const inputs=JSON.parse(await fs.readFile(values.inputs,'utf8'));
 if(!inputs.url||!inputs.repo||!inputs.browser||!inputs.playwright)throw Error('Inputs require url, repo, independent browser and playwright paths');
 const experiment=new URL(inputs.url).searchParams.get('experiment');
 if(!experiment)throw Error('Sequence URL must name an owner experiment');
 const viewport=inputs.viewport??{width:1600,height:1000};
 phase='source';const source=await fluidSourceIdentity(inputs.url,inputs.repo,{additionalFiles:['experiments/lazarus-fluid/finite-pbf.experiment.mjs','experiments/lazarus-fluid/contributions.mjs','finger-fluid-box-clock.mjs','owner-experiment-entry.mjs','workbench-experiments.mjs']});
 phase='browser';
 const launch=fluidBrowserLaunch({executable:inputs.browser,debugPort:0,userDataDir:out,width:viewport.width,height:viewport.height});
 const {chromium}=await import(pathToFileURL(path.resolve(inputs.playwright)));
 browser=await chromium.launch({executablePath:launch.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.__kaminosSequenceStartupErrors=[];window.addEventListener('error',e=>window.__kaminosSequenceStartupErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__kaminosSequenceStartupErrors.push(String(e.reason)));});
 page.on('console',message=>{if(message.type()==='error')console.error('Browser:',message.text());});
 const resourceFailure=message=>{errors.push(message);console.error(message);void page.evaluate(message=>window.__kaminosSequenceStartupErrors?.push(message),message).catch(()=>{});};
 page.on('response',response=>{if(response.request().resourceType()==='script'&&response.status()>=400)resourceFailure('Required script HTTP '+response.status()+': '+response.url());});
 page.on('requestfailed',request=>{if(['script','document'].includes(request.resourceType()))resourceFailure('Required resource failed: '+request.url()+' '+request.failure()?.errorText);});
 phase='navigate';await page.goto(inputs.url);
 await sink.begin({phase:'owner-startup',inputsFile:path.resolve(values.inputs),url:page.url(),source});
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id||window.__kaminosSequenceStartupErrors?.length||window.kaminosFingerFluidBenchDebugState?.().status==='error'||(document.querySelector('.owner-experiment-status')?.textContent?.startsWith('Unknown experiment:')));
 if(errors.length)throw Error(errors.join('\n'));
 const selected=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id);
 if(selected!==experiment)throw Error('Requested experiment was not opened: '+selected);
 // Allow the existing host camera/projection to settle before its frozen view.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 phase='render-sequence';
 await renderSequence({adapter:createFluidSequenceAdapter({page,source:{...source,url:page.url(),browser:browser.version(),executable:launch.executable,viewport}}),sink,request:inputs.sequence,signal:abort.signal});
 sequenceFinished=true;
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({out,manifest:path.join(out,'sequence.json'),cancelled:abort.signal.aborted}));
}catch(error){
 // The runner retains its own precise phase. Startup has no primary frame yet.
 if(page){try{await fs.writeFile(path.join(out,'failure.png'),await page.screenshot());await fs.writeFile(path.join(out,'failure-state.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,owner:window.kaminosWorkbenchExperiments?.state(),clock:window.kaminosFingerFluidBenchSessionState?.(),errors:window.__kaminosSequenceStartupErrors,status:document.querySelector('.owner-experiment-status')?.textContent})),null,2));}catch(captureError){console.error('Failure capture:',String(captureError));}}
 if(phase!=='render-sequence'||sequenceFinished)await sink.finish({status:'failed',complete:false,failurePhase:phase,failure:String(error.stack||error)});
 process.exitCode=1;console.error(String(error.stack||error));
}finally{
 await browser?.close();process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
}
