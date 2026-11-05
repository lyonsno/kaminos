// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const witness=process.env.FRACTURE_CONTACT_WITNESS_TEST_MODULE??path.join(root,'tools/fracture-convex-contact-witness.mjs');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fracture-contact-failure-'));
try{
 const preload=path.join(scratch,'deny-bind.mjs');
 fs.writeFileSync(preload,`import http from 'node:http';import {EventEmitter} from 'node:events';
 http.createServer=()=>{const server=new EventEmitter();server.listen=()=>{queueMicrotask(()=>server.emit('error',Object.assign(new Error('Injected bind denial'),{code:'EPERM'})));return server;};return server;};`);
 const out=path.join(scratch,'bind-denied');
 const bind=spawnSync(process.execPath,['--import',preload,witness,out,root],{cwd:root,encoding:'utf8'});
 assert.equal(bind.status,1);
 const denied=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
 assert.equal(denied.status,'failed','An emitted bind error must produce a terminal failure report');
 assert.equal(denied.failurePhase,'server-bind');
 assert.equal(denied.browserLaunched,false);
 assert.equal(denied.root,root.replace(/\/$/,''));
 assert.match(denied.revision,/^[0-9a-f]{40}$/);
 assert.match(denied.error,/Injected bind denial/);
 assert.deepEqual(denied.served,{});

 const setupOut=path.join(scratch,'bad-source');
 const setup=spawnSync(process.execPath,[witness,setupOut,scratch],{cwd:scratch,encoding:'utf8'});
 assert.equal(setup.status,1);
 const failed=JSON.parse(fs.readFileSync(path.join(setupOut,'report.json'),'utf8'));
 assert.equal(failed.status,'failed');
 assert.equal(failed.failurePhase,'source-identification');
 assert.equal(failed.revision,null,'Failed Git identity cannot become a default revision');
 assert.equal(failed.browserLaunched,false);
 assert.equal(fs.realpathSync(failed.root),fs.realpathSync(scratch));
 assert.deepEqual(failed.served,{});
 console.log('Denied bind and failed source identification retain terminal reports before browser launch');
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
