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
const {values}=parseArgs({options:{inputs:{type:'string'},out:{type:'string'}}});
if(!values.out)throw Error('--out is required');
const out=path.resolve(values.out),sink=await createDirectorySequenceSink(out);
let browser,phase='inputs',sequenceFinished=false;const abort=new AbortController();
const cancel=()=>abort.abort();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
try{
 await sink.begin({inputsFile:values.inputs?path.resolve(values.inputs):null});
 if(!values.inputs)throw Error('--inputs is required');
 const inputs=JSON.parse(await fs.readFile(values.inputs,'utf8'));
 if(!inputs.url||!inputs.repo||!inputs.browser||!inputs.playwright)throw Error('Inputs require url, repo, independent browser and playwright paths');
 const viewport=inputs.viewport??{width:1600,height:1000};
 phase='source';const source=await fluidSourceIdentity(inputs.url,inputs.repo,{additionalFiles:['experiments/lazarus-fluid/finite-pbf.experiment.mjs','experiments/lazarus-fluid/contributions.mjs','finger-fluid-box-clock.mjs','owner-experiment-entry.mjs','workbench-experiments.mjs']});
 phase='browser';
 const launch=fluidBrowserLaunch({executable:inputs.browser,debugPort:0,userDataDir:out,width:viewport.width,height:viewport.height});
 const {chromium}=await import(pathToFileURL(path.resolve(inputs.playwright)));
 browser=await chromium.launch({executablePath:launch.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage({viewport});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.__kaminosSequenceStartupErrors?.lengths=[];window.addEventListener('error',e=>window.__kaminosSequenceStartupErrors?.lengths.push(e.message));window.addEventListener('unhandledrejection',e=>window.__kaminosSequenceStartupErrors?.lengths.push(String(e.reason)));});
 await page.goto(inputs.url);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id||window.__kaminosSequenceStartupErrors?.length);
 if(errors.length)throw Error(errors.join('\n'));
 // Allow the existing host camera/projection to settle before its frozen view.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 phase='render-sequence';
 await renderSequence({adapter:createFluidSequenceAdapter({page,source:{...source,url:page.url(),browser:browser.version(),executable:launch.executable,viewport}}),sink,request:inputs.sequence,signal:abort.signal});
 sequenceFinished=true;
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({out,manifest:path.join(out,'sequence.json'),cancelled:abort.signal.aborted}));
}catch(error){
 // The runner retains its own precise phase. Startup has no primary frame yet.
 if(phase!=='render-sequence'||sequenceFinished)await sink.finish({status:'failed',complete:false,failurePhase:phase,failure:String(error.stack||error)});
 process.exitCode=1;console.error(String(error.stack||error));
}finally{
 await browser?.close();process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
}
