// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('actual converter preserves all parents and fails with a durable phase report on source corruption',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'adaptive-converter-')),source=path.join(dir,'source');fs.mkdirSync(source);
 try{
 const rows=new Float32Array([0,0,0,0,0,1,.5,.5,.5,0,.5,1, .1,0,0,0,0,1,.5,.5,.5,0,.5,1, 0,.1,0,0,0,1,.5,.5,.5,0,.5,1]),triangles=new Uint32Array([0,1,2]);
 const metadata={ok:true,count:3,stride:12,gridSize:1,radius:.1,dataSHA256:hash(new Uint8Array(rows.buffer)),triangles:{file:'triangles.u32',count:1,sha256:hash(new Uint8Array(triangles.buffer))}};
 fs.writeFileSync(path.join(source,'surfels.f32'),Buffer.from(rows.buffer));fs.writeFileSync(path.join(source,'triangles.u32'),Buffer.from(triangles.buffer));fs.writeFileSync(path.join(source,'report.json'),JSON.stringify(metadata));
 const run=out=>spawnSync(process.execPath,['tools/prepare-adaptive-splats.mjs',source,out,'2'],{encoding:'utf8'});
 const good=path.join(dir,'good');const success=run(good);assert.equal(success.status,0,success.stderr);
 const report=JSON.parse(fs.readFileSync(path.join(good,'report.json')));assert.equal(report.ok,true);assert.equal(report.sourceDataSHA256,metadata.dataSHA256);assert.equal(fs.statSync(path.join(good,'parent.u32')).size,12);
 fs.writeFileSync(path.join(source,'triangles.u32'),Buffer.from(new Uint32Array([0,1,90]).buffer));
 const bad=path.join(dir,'bad');assert.equal(run(bad).status,1);const failure=JSON.parse(fs.readFileSync(path.join(bad,'report.json')));assert.equal(failure.ok,false);assert.equal(failure.phase,'load');assert.match(failure.error,/hash mismatch/);assert.ok(!fs.existsSync(path.join(bad,'surfels.f32')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
