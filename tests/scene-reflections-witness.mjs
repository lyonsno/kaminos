// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('early module failure terminates the real browser witness with a durable load report',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const out=process.env.KAMINOS_REFLECTION_FAILURE_OUT??await fs.mkdtemp(path.join(os.tmpdir(),'reflection-bootstrap-failure-'));
 await fs.mkdir(out,{recursive:true});
 let sawBootstrapError;
 const crashed=new Promise(resolve=>{sawBootstrapError=resolve;});
 const server=createServer((request,response)=>{
  if(request.url==='/api/runtime-config'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({source:{repoRoot:root}}));}
  else if(request.url==='/api/workbench-experiments'){response.setHeader('Content-Type','application/json');response.end('[]');}
  else if(request.url==='/bootstrap-error'){sawBootstrapError();response.end('observed');}
  else{response.setHeader('Content-Type','text/html');response.end(`<script>window.addEventListener('error',()=>fetch('/bootstrap-error'));</script><script type="module">throw Error('deliberate early module bootstrap failure');</script>`);}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const child=spawn(process.execPath,['tools/scene-reflections-witness.mjs',`http://127.0.0.1:${server.address().port}`,out,root],{cwd:root,detached:true,stdio:['ignore','pipe','pipe']});
 const terminal=once(child,'exit'),logs=[];
 child.stdout.on('data',x=>logs.push(x));child.stderr.on('data',x=>logs.push(x));
 try{
  await Promise.race([crashed,terminal.then(()=>{throw Error('witness exited before the deliberate browser failure');})]);
  // The checkpoint must already exist when the browser fails. This assertion
  // fails promptly on the old hanging witness, without imposing a runtime cap.
  const checkpoint=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
  assert.equal(checkpoint.phase,'load');
  const [code]=await terminal;
  assert.equal(code,1);
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed');assert.equal(report.phase,'load');
  assert.match(report.error,/deliberate early module bootstrap failure/);
  assert.ok(report.errors.some(x=>x.includes('deliberate early module bootstrap failure')));
 }finally{
  if(child.exitCode===null)try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  await fs.writeFile(path.join(out,'driver.log'),Buffer.concat(logs));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
