// kaminos-test: node
// Local control-flow fixture. No browser, GPU, or external-runtime claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync,watch} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const cancellationSignal=process.env.KAMINOS_SEQUENCE_TEST_SIGNAL??'SIGTERM';
assert.ok(['SIGTERM','SIGINT'].includes(cancellationSignal));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sequence-cancel-'));
const repo=new URL('..',import.meta.url).pathname;
const sourceFiles=new Set(['index.html','fluid-working-session.mjs','finger-fluid-webgpu-core.js','fluid-viewport-host.mjs','finger-fluid-pressure-controls.mjs','finger-fluid-pressure-cockpit.mjs','experiments/lazarus-fluid/finite-pbf.experiment.mjs','experiments/lazarus-fluid/contributions.mjs','finger-fluid-box-clock.mjs','owner-experiment-entry.mjs','workbench-experiments.mjs']);
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/api/runtime-config'){res.end(JSON.stringify({source:{repoRoot:await fs.realpath(repo),fixture:true}}));return;}
  const file=req.url.slice(1);if(!sourceFiles.has(file)){res.writeHead(404);res.end();return;}
  res.end(await fs.readFile(path.join(repo,file)));
 }catch(error){res.writeHead(500);res.end(String(error));}
});server.listen(0,'127.0.0.1');await once(server,'listening');
const shim=path.join(directory,'playwright.mjs');
await fs.writeFile(shim,`
import {writeFileSync} from 'node:fs';
let pendingReject;const liveBrowserReference=setInterval(()=>{},60000);
process.on(${JSON.stringify(cancellationSignal)},()=>writeFileSync(${JSON.stringify(path.join(directory,'signal'))},'seen'));
export const chromium={launch:async()=>({
 newPage:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(){},async addInitScript(){},async goto(){},url:()=> 'fixture://startup',
  waitForFunction:()=>{writeFileSync(${JSON.stringify(path.join(directory,'entered'))},'pending');return new Promise((resolve,reject)=>{pendingReject=reject;});},
  async screenshot(){throw Error('No fixture image');},async evaluate(){return {};}
 }),
 async close(){clearInterval(liveBrowserReference);writeFileSync(${JSON.stringify(path.join(directory,'closed'))},'closed');pendingReject?.(Error('Owned fixture browser closed'));}
})};
`);
const inputs=path.join(directory,'inputs.json');await fs.writeFile(inputs,JSON.stringify({url:`http://127.0.0.1:${server.address().port}/index.html?experiment=fixture`,repo,browser:process.execPath,playwright:shim,sequence:{startSeconds:0,endSeconds:1,fps:30}}));
const waitFile=file=>new Promise(resolve=>{
 const target=path.join(directory,file);if(existsSync(target)){resolve();return;}
 const watcher=watch(directory,()=>{if(existsSync(target)){watcher.close();resolve();}});
 if(existsSync(target)){watcher.close();resolve();}
});
let child;
try{
 child=spawn(process.execPath,[new URL('../tools/render-fluid-sequence.mjs',import.meta.url).pathname,'--inputs',inputs,'--out',path.join(directory,'output')],{stdio:'ignore'});
 await waitFile('entered');child.kill(cancellationSignal);await waitFile('signal');
 assert.ok(existsSync(path.join(directory,'closed')),cancellationSignal+' must close the owned browser while startup is pending');
 if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'output/sequence.json'),'utf8'));
 assert.equal(manifest.status,'cancelled');assert.equal(manifest.complete,false);assert.equal(manifest.completedFrames,0);
 console.log('Stalled startup cancellation closes the exact fixture browser and retains cancellation:',directory);
}finally{
 if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}
 await new Promise(resolve=>server.close(resolve));
}
