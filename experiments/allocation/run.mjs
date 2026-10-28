import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fixtures,validateSignal,appendSignal} from './model.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=path.resolve(process.argv[2]);
await fs.mkdir(out,{recursive:true});
const report={status:'failed',phase:'setup',root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:{},scope:'Controlled moving material allocation only; prescribed activity and velocity; no rendering, velocity/pressure solve, production fire detector or whole-frame claim.'};
let browser,server;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
try {
 for(const f of ['model.mjs','kernels.mjs','gpu.mjs','run.mjs','export.mjs'])report.sourceHashes[f]=createHash('sha256').update(await fs.readFile(new URL(f,import.meta.url))).digest('hex');
 const configs=process.argv[3]?JSON.parse(await fs.readFile(process.argv[3],'utf8')):fixtures().flatMap(c=>[4,8,16].map(brick=>({...c,brick})));
 if(!Array.isArray(configs)||!configs.length)throw Error('Nonempty config array required');
 report.configs=configs;
 server=http.createServer(async(req,res)=>{try{if(req.method==='POST'&&/^\/raw\/[a-zA-Z0-9_-]+\.bin$/.test(req.url)){const target=path.join(out,path.basename(req.url)),offset=Number(req.headers['x-byte-offset']);if(!Number.isSafeInteger(offset)||offset<0)throw Error('offset');if(offset>0&&(await fs.stat(target)).size!==offset)throw Error('offset mismatch');await pipeline(req,createWriteStream(target,{flags:offset===0?'w':'a'}));res.end('stored');return;}const f=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root))throw Error('path');if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<title>Allocation computation</title>');return;}res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(f));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 report.executable=process.env.ALLOCATION_CHROMIUM;
 if(!report.executable||!process.env.ALLOCATION_PLAYWRIGHT)throw Error('Explicit independent Chromium executable and Playwright module required');
 if(!/Chrome for Testing|chromium|headless_shell/i.test(report.executable)||/Google Chrome.app/.test(report.executable))throw Error('Independent automation browser required');
 const {chromium}=await import(process.env.ALLOCATION_PLAYWRIGHT);
 browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=browser.pages()[0];page.setDefaultTimeout(0);
 await page.goto(`http://127.0.0.1:${server.address().port}/`);report.origin=page.url();report.phase='gpu';report.status='running';await save();
 // Export each completed configuration before starting the next, preserving partial results on failure.
 const signal={rows:[]};
 for(const c of configs){
  const r=await page.evaluate(async c=>{const {run}=await import('/experiments/allocation/gpu.mjs');const {exportRaw}=await import('/experiments/allocation/export.mjs');return await run([c],exportRaw);},c);
  const row=r.rows[0],name=`${c.name}-${c.brick}`;
  for(const [field,bytes] of Object.entries(row.rawBytes))if((await fs.stat(path.join(out,`${name}-${field}.bin`))).size!==bytes)throw Error('Raw export size mismatch');
  appendSignal(signal,r);
  await fs.writeFile(path.join(out,'signal.json'),JSON.stringify(signal,null,2));
  report.completedConfigurations=signal.rows.length;await save();
  console.log(JSON.stringify({case:name,parity:row.samples[0].parity,completed:signal.rows.length}));
 }
 validateSignal(signal,configs);
 report.status='passed';report.phase='complete';report.adapter=signal.adapter;
 report.summary=signal.rows.map(row=>{const mean=k=>row.samples.flatMap(s=>s[k]).reduce((a,b)=>a+b,0)/(row.config.repeats*row.config.steps);const dense=mean('denseMs'),allocation=mean('allocationMs'),update=mean('sparseUpdateMs');return {name:row.config.name,brick:row.config.brick,activeFraction:row.activeSchedule.slice(1).reduce((a,b)=>a+b,0)/row.config.steps/(row.config.size/row.config.brick)**3,denseMs:dense,allocationMs:allocation,sparseUpdateMs:update,sparseToDense:(allocation+update)/dense,fieldMemoryFraction:row.reservedFieldBytes/row.denseFieldBytes,maxError:Math.max(...row.samples.map(s=>s.parity.maxError))};});
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));report.resourcesClosed=true;await save();console.log(JSON.stringify(report.summary??{status:report.status,error:report.error}));}
