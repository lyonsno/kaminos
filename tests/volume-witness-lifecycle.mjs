// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const preload=`import net from 'node:net';import cp from 'node:child_process';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';import fs from 'node:fs';
net.createServer=()=>{const s=new EventEmitter();s.listen=(_port,_host,done)=>{queueMicrotask(()=>{if(process.env.WITNESS_FAULT==='bind')s.emit('error',Object.assign(new Error('denied test bind'),{code:'EPERM'}));else done();});return s;};s.address=()=>({port:1234});s.close=done=>done();return s;};
cp.spawn=()=>{const c=new EventEmitter();c.pid=process.env.WITNESS_FAULT==='spawn'?undefined:12345;c.exitCode=null;c.signalCode=null;c.kill=()=>{fs.writeFileSync(process.env.WITNESS_STOP_MARKER,'stopped');queueMicrotask(()=>{c.signalCode='SIGTERM';c.emit('exit',null,'SIGTERM');});return true;};queueMicrotask(()=>c.emit(process.env.WITNESS_FAULT==='spawn'?'error':'spawn',new Error('failed test spawn')));return c;};
globalThis.fetch=async()=>({ok:true,json:async()=>({source:{repoRoot:process.cwd()},sharedBasinStore:null})});syncBuiltinESMExports();`;
for(const script of ['world-calibration','automatic-coverage','live-domain'])for(const fault of ['bind','spawn','cleanup'])test(`${script} preserves ${fault} failure and independently cleans owned resources`,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fire-witness-failure-'));const out=path.join(dir,'out'),preset=path.join(dir,'observed-input.json'),loader=path.join(dir,'preload.mjs'),fake=path.join(dir,'browser.mjs'),marker=path.join(dir,'server-stopped');
 await fs.writeFile(preset,'{}');await fs.writeFile(loader,preload);await fs.writeFile(fake,`export const chromium={launchPersistentContext:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},newPage:async()=>{throw Error('fixture stops before scene');},close:async()=>{throw Error('fixture browser close rejected');}})};`);
 const child=spawnSync(process.execPath,['--import',loader,path.join(root,`tools/${script}-witness.mjs`),out,preset],{cwd:root,encoding:'utf8',env:{...process.env,WITNESS_FAULT:fault,WITNESS_STOP_MARKER:marker,CHROME_EXECUTABLE:'/isolated/Google Chrome for Testing/fixture',PLAYWRIGHT_MODULE:fake}});
 assert.notEqual(child.status,0);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.ok(report.commit);assert.ok(Object.keys(report.source??{}).length>0,'computed source identity must survive setup failure');
 if(fault==='bind'){assert.equal(report.phase,'port-reservation');assert.match(report.error,/denied test bind/);}
 if(fault==='spawn'){assert.equal(report.phase,'server-spawn');assert.match(report.error,/failed test spawn/);}
 if(fault==='cleanup'){assert.ok(report.cleanupErrors.some(x=>x.phase==='browser-close'&&x.error.includes('fixture browser close rejected')));assert.equal(await fs.readFile(marker,'utf8'),'stopped');assert.equal(report.serverClosed,true);}
 assert.doesNotMatch(child.stderr,/Unhandled 'error' event/);
});
