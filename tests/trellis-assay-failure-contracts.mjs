// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn,execFileSync}from 'node:child_process';import {createHash}from 'node:crypto';import {fileURLToPath}from 'node:url';
const sourceRepo=process.env.TRELLIS_ASSAY_REPO_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await fs.realpath(await fs.mkdtemp(path.join(process.env.TRELLIS_ASSAY_NEGATIVE_OUTPUT??os.tmpdir(),'trellis-assay-negative-')));
// Other suite entries mutate their checkout while running. Execute the actual
// admitted SHA in a clean sparse snapshot; never relax the production guard.
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRepo,encoding:'utf8'}).trim(),repo=path.join(root,'source');
execFileSync('git',['clone','--quiet','--shared','--no-checkout',sourceRepo,repo]);
execFileSync('git',['sparse-checkout','init','--no-cone'],{cwd:repo});
const files=execFileSync('git',['ls-tree','-r','--name-only',revision],{cwd:sourceRepo,encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.py')||['.gitignore','finger-fluid-browser-launch.mjs','tools/trellis-frame-yield-assay.mjs','models/trellis2/frame-yield-checks.js'].includes(f));
await fs.writeFile(path.join(repo,'.git/info/sparse-checkout'),files.map(f=>'/'+f).join('\n')+'\n');
execFileSync('git',['checkout','--quiet','--detach',revision],{cwd:repo});
await fs.writeFile(path.join(root,'fixture-source.json'),JSON.stringify({sourceRepo,revision,repo,files},null,2));
const sha=b=>createHash('sha256').update(b).digest('hex');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=server.address().port;await new Promise(r=>server.close(r));return p;}
async function config(name){const dir=path.join(root,name);await fs.mkdir(dir);const fixture=path.join(dir,'fixture');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'manifest.json'),'{}');const chrome=path.join(dir,'chrome-headless-shell');await fs.writeFile(chrome,'non-executable browser launch fixture\n',{mode:0o600});const cfg={repoRoot:repo,expectedCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),output:path.join(dir,'output'),fixtureRoots:{block:fixture},fixtureManifestHashes:{block:sha('{}')},chrome,python:process.env.KAMINOS_TEST_PYTHON??'python3',port:await port(),debugPort:await port()};const file=path.join(dir,'config.json');await fs.writeFile(file,JSON.stringify(cfg));return {cfg,file,dir};}
function owned(argv,cwd=repo){const child=spawn(argv[0],argv.slice(1),{cwd,detached:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const terminal=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});return {child,terminal,log:()=>log,stop(){if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}};}
for(const which of ['server','browser'])test(which+' launch failure writes a terminal report and closes owned children',async()=>{
 const {cfg,file,dir}=await config(which);if(which==='server'){cfg.python=path.join(dir,'missing-python');await fs.writeFile(file,JSON.stringify(cfg));}
 const run=owned([process.execPath,path.join(repo,'tools/trellis-frame-yield-assay.mjs'),file]);
 try{assert.equal(await run.terminal,1);await fs.writeFile(path.join(dir,'cli.log'),run.log());const report=JSON.parse(await fs.readFile(path.join(cfg.output,'report.json'),'utf8'));assert.match(report.error?.message??'',which==='server'?/ENOENT/:/EACCES/);assert.equal(report.phase,which);assert.equal(report.cleanup.ownedServerClosed,true);assert.equal(report.cleanup.ownedBrowserClosed,true);assert.equal(report.cleanup[which].status,'failed-to-spawn');}
 finally{run.stop();}
});
async function request(port,header){return new Promise((resolve,reject)=>{let raw='';const socket=net.connect(port,'127.0.0.1',()=>socket.end('POST /__frame_yield/state.json HTTP/1.0\r\nHost: localhost\r\n'+header+'\r\n'));socket.on('data',d=>raw+=d);socket.once('error',reject);socket.once('end',()=>resolve(raw));});}
test('actual HTTP evidence endpoint rejects missing and malformed lengths without overwriting evidence',async()=>{
 const {cfg,file,dir}=await config('headers');await fs.mkdir(cfg.output);await fs.writeFile(path.join(cfg.output,'state.json'),'retained');const run=owned([cfg.python,path.join(repo,'tools/trellis-frame-yield-server.py'),file]);let exited=false;run.terminal.then(()=>exited=true);
 try{while(true){if(exited)throw Error('server exited: '+run.log());try{if((await fetch('http://127.0.0.1:'+cfg.port+'/api/runtime-config')).ok)break;}catch{}await sleep(25);}
  for(const [header,code]of [['',411],['Content-Length: nonsense\r\n',400],['Content-Length: -1\r\n',400],['Content-Length: '+('9'.repeat(5000))+'\r\n',400],['Content-Length: '+('9'.repeat(30))+'\r\n',400]]){const raw=await request(cfg.port,header);await fs.writeFile(path.join(dir,'response-'+code+'-'+header.length+'.txt'),raw);assert.match(raw,new RegExp('^HTTP/1\\.[01] '+code));assert.equal(await fs.readFile(path.join(cfg.output,'state.json'),'utf8'),'retained');}
 }finally{run.stop();await run.terminal;await fs.writeFile(path.join(dir,'server.log'),run.log());}
});
