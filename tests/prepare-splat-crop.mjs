// kaminos-test: node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'splat-crop-')),source=path.join(root,'source');fs.mkdirSync(source);
const rows=new Float32Array([0,0,0,0,1,0,.2,.4,.1,0,.7,1, .001,0,0,0,1,0,.2,.4,.1,0,.7,1, 0,0,.001,0,1,0,.2,.4,.1,0,.7,1]);
const indices=new Uint32Array([0,1,2]),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.writeFileSync(source+'/surfels.f32',Buffer.from(rows.buffer));fs.writeFileSync(source+'/triangles.u32',Buffer.from(indices.buffer));
const meta={ok:true,count:3,sourceCount:3,stride:12,radius:.0015625,gridSize:512,bounds:[[-.5,-.5,-.5],[.5,.5,.5]],sourceHashes:{fixture:'local-only'},dataSHA256:hash(Buffer.from(rows.buffer)),triangles:{file:'triangles.u32',count:1,sha256:hash(Buffer.from(indices.buffer))}};
fs.writeFileSync(source+'/report.json',JSON.stringify(meta));
const run=(input,out)=>spawnSync(process.execPath,['tools/prepare-splat-crop.mjs',input,out,'[[-0.1,-0.1,-0.1],[0.1,0.1,0.1]]'],{encoding:'utf8'});
try{
 const alias=path.join(root,'alias');fs.symlinkSync(source,alias);const before=fs.readFileSync(source+'/report.json');
 assert.notEqual(run(source,alias).status,0);assert.deepEqual(fs.readFileSync(source+'/report.json'),before);
 meta.dataSHA256='wrong';fs.writeFileSync(source+'/report.json',JSON.stringify(meta));
 const failed=path.join(root,'failed');assert.notEqual(run(source,failed).status,0);const failure=JSON.parse(fs.readFileSync(failed+'/report.json'));assert.equal(failure.ok,false);assert.equal(failure.phase,'load');assert.match(failure.error,/hash mismatch/);
 meta.dataSHA256=hash(Buffer.from(rows.buffer));fs.writeFileSync(source+'/report.json',JSON.stringify(meta));
 const out=path.join(root,'out'),r=run(source,out);assert.equal(r.status,0,r.stdout+r.stderr);
 const report=JSON.parse(fs.readFileSync(out+'/report.json'));assert.equal(report.ok,true);assert.equal(report.variants.length,9);assert.equal(report.count,3);
 for(const name of ['source','uniform','adaptive']){
  const v=report.variants.filter(v=>v.name===name);assert.equal(new Set(v.map(v=>v.dataSHA256)).size,1);assert.equal(new Set(v.map(v=>v.count)).size,1);assert.equal(new Set(v.map(v=>v.footprintSHA256)).size,3);
 }
 assert.deepEqual(fs.readFileSync(out+'/source-1.000/surfels.f32'),Buffer.from(rows.buffer));
 // Connectivity can make the adaptive target unattainable: preserve both
 // triangles, but do not label one uniform sample versus two adaptive as equal.
 const disconnected=new Float32Array([[0,0,0],[.0004,0,0],[0,0,.0004],[.001,0,.001],[.0014,0,.001],[.001,0,.0014]].flatMap(p=>[...p,0,1,0,.2,.4,.1,0,.7,1]));
 const faces=new Uint32Array([0,1,2,3,4,5]);
 fs.writeFileSync(source+'/surfels.f32',Buffer.from(disconnected.buffer));fs.writeFileSync(source+'/triangles.u32',Buffer.from(faces.buffer));
 fs.writeFileSync(source+'/report.json',JSON.stringify({...meta,count:6,sourceCount:6,dataSHA256:hash(Buffer.from(disconnected.buffer)),triangles:{file:'triangles.u32',count:2,sha256:hash(Buffer.from(faces.buffer))}}));
 const unequal=path.join(root,'unequal'),u=run(source,unequal);assert.equal(u.status,0,u.stdout+u.stderr);
 assert.deepEqual(JSON.parse(fs.readFileSync(unequal+'/report.json')).reducedComparison,{uniformCount:1,adaptiveCount:2,equalCount:false});
 console.log('Wrong source rejects with durable report; aliases preserved; scale variants keep identical samples');
}finally{fs.rmSync(root,{recursive:true});}
