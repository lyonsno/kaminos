// kaminos-test: node
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hill-efficiency-tools-'));let server;
const run=(tool,args)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[tool,...args],{stdio:'ignore'});p.on('error',reject);p.on('close',resolve);});
try{
 server=http.createServer((req,res)=>res.end('wrong source'));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 for(const name of ['hill-volume-profile','hill-contact-efficiency-witness']){const out=path.join(dir,name);await fs.mkdir(out);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'passed'}));const tool='tools/'+name+'.mjs';assert.equal(await run(tool,['',out,'']),1);let report=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(report.status,'failed');assert.equal(report.phase,'configuration');assert.equal(report.closed,false);assert.equal(await run(tool,[process.cwd(),out,`http://127.0.0.1:${server.address().port}`]),1);report=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(report.status,'failed');assert.equal(report.phase,'source');assert.match(report.error,/Wrong served source/);assert.equal(report.closed,false);}
}finally{if(server?.listening)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
