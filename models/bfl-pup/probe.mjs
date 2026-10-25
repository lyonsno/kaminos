// Actual browser/model computational witness, using the existing isolated CDP harness.
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateExpansion} from './witness-contract.mjs';
import {fileURLToPath} from 'node:url';
import {startServer,launchChrome,sourceIdentity} from '../flux2-klein/cdp-harness.mjs';
const args=process.argv.slice(2),get=(key)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1]};
const here=path.dirname(fileURLToPath(import.meta.url));
const out=get('--out');
if(!out)throw Error('--out is required');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.bfl-pup.browser-witness.v1',phase:'setup',source:sourceIdentity(here),
 requested:{backend:'transformers.js/onnx-webgpu',modelDir:get('--model'),prompt:get('--prompt'),reference:get('--image')??null},
 browserExecutable:get('--chrome')};
let browser,server,exit=1;
async function save(){await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
await save();
try{
 if(!report.requested.modelDir||!report.requested.prompt||!report.browserExecutable)throw Error('--model, --prompt and --chrome are required');
 const roots={'/model/':path.resolve(get('--model')),'/':here};
 if(get('--image'))roots['/reference/']=path.dirname(path.resolve(get('--image')));
 const serving=await startServer(roots);server=serving.server;report.origin=serving.origin;
 report.package=JSON.parse(await fs.readFile(path.join(get('--model'),'provenance.json'),'utf8'));
 browser=await launchChrome(get('--chrome'),[],report);
 report.phase='page';await save();
 await browser.navigate(serving.origin+'/probe.html','window.pupPageReady===true');
 report.phase='expand';await save();
 const options={modelUrl:serving.origin+'/model',prompt:get('--prompt'),images:get('--image')?[serving.origin+'/reference/'+encodeURIComponent(path.basename(get('--image')))]:[]};
 report.result=await browser.evaluate(`window.pupRun(${JSON.stringify(options)})`);
 const r=report.result;
 validateExpansion(r,options.images.length);
 await fs.writeFile(path.join(out,'caption.txt'),r.text+'\n');
 report.phase='done';exit=0;
}catch(error){report.error=String(error?.stack??error);report.failurePhase=report.phase;report.phase='failed';}
finally{
 await browser?.close();server?.close();report.finishedAt=new Date().toISOString();await save();
}
process.exit(exit);
