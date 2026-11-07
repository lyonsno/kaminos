// kaminos-test: node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hill-volume-witness-'));
const run=argv=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tools/hill-volume-witness.mjs',...argv],{stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('error',reject);p.on('close',code=>resolve({code,output}));});
let server;
try{
 const out=path.join(dir,'stale');await fs.mkdir(out);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'passed',phase:'complete',closed:true}));
 const missing=await run(['--out',out]);assert.equal(missing.code,1);const r=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(r.status,'failed');assert.equal(r.phase,'configuration');assert.equal(r.closed,false);assert.match(r.error,/--root required/);
 server=http.createServer((req,res)=>{res.writeHead(200);res.end('wrong checkout');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const wrong=path.join(dir,'wrong');const result=await run(['--out',wrong,'--root',process.cwd(),'--url',`http://127.0.0.1:${server.address().port}/?experiment=hill-volume`,'--browser',process.execPath,'--playwright','missing']);assert.equal(result.code,1);const w=JSON.parse(await fs.readFile(path.join(wrong,'report.json')));assert.equal(w.status,'failed');assert.equal(w.phase,'source');assert.match(w.error,/Wrong served source/);assert.equal(w.closed,false);
 console.log('missing config overwrites stale pass; wrong effective source fails before browser launch; both retain failure reports');
}finally{if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
