// Replays the CPU reference in a private native browser. Every exit retains a report.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {launchChrome,startServer,sourceIdentity} from '../flux2-klein/cdp-harness.mjs';
import {validateReferenceWitness} from './reference-witness.js';
const {values:v}=parseArgs({options:{model:{type:'string',default:'flux3'},weights:{type:'string'},ref:{type:'string'},chrome:{type:'string'},out:{type:'string'}}});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!v.out)throw Error('--out is required for a durable witness');
await fs.mkdir(v.out,{recursive:true});
const r={ok:false,phase:'setup',source:sourceIdentity(root),requested:v};const write=()=>fs.writeFile(path.join(v.out,'report.json'),JSON.stringify(r,null,2));
let server,browser;await write();
try{
 if(!v.chrome||!v.weights||!v.ref)throw Error('--chrome, --weights and --ref are required');
 const served=await startServer({'/weights/':path.resolve(v.weights),'/ref/':path.resolve(v.ref),'/':root});server=served.server;r.origin=served.origin;
 r.phase='browser';await write();browser=await launchChrome(v.chrome,[],r);
 await browser.navigate(served.origin+'/models/flux3-klein/transformer-witness.html','window.transformerWitnessReady');
 r.phase='native';await write();
 r.witness=await browser.evaluate(`import('./reference-witness.js').then(m=>m.runReferenceWitness(${JSON.stringify(v.model)}))`);
 validateReferenceWitness(r.witness);r.ok=true;r.phase='done';
}catch(e){r.error=String(e.stack||e);process.exitCode=1;}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await write();}
process.exit(process.exitCode||0);
