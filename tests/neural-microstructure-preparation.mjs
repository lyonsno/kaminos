// kaminos-test: node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'micro-preparation-')),source=path.join(directory,'source'),out=path.join(directory,'out');
fs.mkdirSync(source);const rows=new Float32Array([0,0,0,0,0,1,.5,.2,.1,0,.8,1, 2,0,0,0,0,1,.1,.2,.3,0,.8,1]);
const raw=Buffer.from(rows.buffer),sha=crypto.createHash('sha256').update(raw).digest('hex');
const writeMeta=patch=>fs.writeFileSync(path.join(source,'report.json'),JSON.stringify({ok:true,schema:'trellis-surfel-fields.v1',count:2,sourceCount:999,stride:12,radius:.1,dataSHA256:sha,...patch}));
fs.writeFileSync(path.join(source,'surfels.f32'),raw);fs.writeFileSync(path.join(source,'source-ids.u32'),Buffer.from(new Uint32Array([47,300]).buffer));writeMeta({});
const run=region=>spawnSync(process.execPath,['tools/prepare-microstructure.mjs',source,out,JSON.stringify(region),'.5'],{encoding:'utf8'});
const read=()=>JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
try{
  assert.equal(run([-1,-1,-1,1,1,1]).status,0);assert.equal(read().count,1);assert.equal(read().sourceCount,2);assert.equal(read().colorEncoding,'srgb');
  const bytes=fs.readFileSync(path.join(out,'rows.f32'));assert.deepEqual(Array.from(new Float32Array(bytes.buffer,bytes.byteOffset,12)),Array.from(rows.subarray(0,12)));
  const ids=fs.readFileSync(path.join(out,'source-ids.u32'));assert.equal(new Uint32Array(ids.buffer,ids.byteOffset,1)[0],47,'A crop must preserve the original upstream source ID');
  writeMeta({dataSHA256:'wrong'});assert.equal(run([-1,-1,-1,1,1,1]).status,1);assert.equal(read().ok,false);assert.equal(read().phase,'load');assert.match(read().error,/hash/);
  writeMeta({ok:false});assert.equal(run([-1,-1,-1,1,1,1]).status,1);assert.equal(read().ok,false);assert.match(read().error,/Successful observed/);
  writeMeta({});assert.equal(run([10,10,10,11,11,11]).status,1);assert.equal(read().phase,'crop');assert.match(read().error,/Empty/);
  assert.equal(run([1,1,1,-1,-1,-1]).status,1);assert.equal(read().ok,false);assert.match(read().error,/region/);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
console.log('microstructure preparation: exact spatial crop, raw channels, stale/failed source and empty-output refusals passed');
