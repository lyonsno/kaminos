import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {launchChrome,openPage} from '../../models/supermat/chrome-cdp.mjs';
import {validateEpisode} from './witness-checks.js';
import {decodeExample} from './included-examples.js';
import {readRawEvidence} from './witness-raw.mjs';

const {values}=parseArgs({options:Object.fromEntries(['repo-root','expected-commit','chrome','output','port'].map(key=>[key,{type:'string'}]))});
const output=path.resolve(values.output??'material-photo-examples');
const report={status:'failed',phase:'arguments',requested:values,examples:[],command:process.argv};
const persist=async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));};
let browser,server;
try{
  await persist();
  for(const key of ['repo-root','expected-commit','chrome','output'])if(!values[key])throw Error(`--${key} required`);
  const root=await fs.realpath(values['repo-root']),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const revision=git(['rev-parse','HEAD']);report.source={root,revision};
  if(revision!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo','models/supermat','lib','webgpu-inference-kit/src']))throw Error('Exact clean source required');
  const base=`http://127.0.0.1:${values.port??18750}`;report.phase='server';await persist();
  server=spawn('/usr/bin/python3',['-u','serve.py',values.port??'18750'],{cwd:root,stdio:'ignore'});
  for(;;){if(server.exitCode!==null)throw Error('Server exited');try{const r=await fetch(`${base}/demos/material-photo/main.js`);if(r.ok){if(await r.text()!==await fs.readFile(path.join(root,'demos/material-photo/main.js'),'utf8'))throw Error('Wrong served source');break;}}catch(error){if(error.message==='Wrong served source')throw error;}await new Promise(r=>setTimeout(r,100));}
  report.phase='browser';await persist();browser=await launchChrome({chrome:values.chrome});
  report.browser={executable:browser.executable,version:browser.version,pid:browser.child.pid};
  const session=await openPage(browser.cdp,`${base}/demos/material-photo/index.html?sample=orb`);
  const evaluate=async expression=>{const r=await browser.cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await evaluate("new Promise(resolve=>{const check=()=>window.__materialPhotoActions&&!document.getElementById('run').disabled?resolve():setTimeout(check,100);check()})");
  for(const [sample,label]of [['orb','Metal & glow'],['celebration','Celebration'],['bag','Backpack']]){
    report.phase=`generate-${sample}`;await persist();
    await evaluate(`(async()=>{document.getElementById('material-size').value='512';await window.__materialPhotoActions.sample(${JSON.stringify(sample)});await window.__materialPhotoActions.infer()})()`);
    const state=await evaluate('window.__materialPhoto');validateEpisode(state,label,512);
    const row={sample,state};report.examples.push(row);await persist();
    report.phase=`export-${sample}`;
    const length=await evaluate(`(async()=>{const {encodeExample}=await import('./included-examples.js');const e=window.__materialPhotoActions.exampleEvidence();
      if(e.sample!==${JSON.stringify(sample)}||e.record.source!==e.source)throw Error('Wrong example source');
      window.__exampleJson=JSON.stringify(encodeExample({depth:e.geometry,output:e.materials,provenance:{source:'included-example',inputKey:e.imageKey,sample:e.sample,size:512,revision:${JSON.stringify(revision)},record:e.record,identity:e.identity}}));return window.__exampleJson.length;})()`);
    let json='';
    // Same 1 MiB CDP transport batching as the existing raw-map witness; no data cap.
    for(let offset=0;offset<length;offset+=1024*1024)json+=await evaluate(`window.__exampleJson.slice(${offset},${Math.min(length,offset+1024*1024)})`);
    if(json.length!==length)throw Error('Incomplete example export');
    const pack=JSON.parse(json);decodeExample(pack,pack.provenance.inputKey);
    const bytes=gzipSync(json),file=path.join(output,`${sample}.json.gz`);await fs.writeFile(file,bytes);
    row.pack={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),inputKey:pack.provenance.inputKey};
    row.raw={};
    for(const name of ['image','plane-albedo','plane-orm']){
      const raw=await readRawEvidence(evaluate,name),file=path.join(output,`${sample}-${name}.raw`);await fs.writeFile(file,raw.bytes);
      row.raw[name]={file,sha256:createHash('sha256').update(raw.bytes).digest('hex'),width:raw.width,height:raw.height,type:raw.type};
    }
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot=await browser.cdp.call('Page.captureScreenshot',{format:'png'},session);row.frame=path.join(output,`${sample}.png`);await fs.writeFile(row.frame,Buffer.from(shot.data,'base64'));
    await persist();
  }
  if(git(['rev-parse','HEAD'])!==revision)throw Error('Source moved during capture');
  report.status='passed';report.phase='complete';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{
  await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}
  await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(output,'report.json')}));
}
