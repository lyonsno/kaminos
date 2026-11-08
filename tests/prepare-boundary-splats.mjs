// kaminos-test: node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'boundary-splats-')),source=path.join(root,'source'),level=path.join(root,'level');
fs.mkdirSync(source);fs.mkdirSync(level);
const data=new Float32Array([-.04,0,.04].flatMap(y=>[-.04,0,.04].flatMap(x=>[x,y,0,0,0,1,.2,.3,.4,.5,.6,1]))),parent=Uint32Array.from({length:9},(_,i)=>i),indices=[];
for(let y=0;y<2;y++)for(let x=0;x<2;x++){const a=y*3+x;indices.push(a,a+1,a+4,a,a+4,a+3);}
const triangles=new Uint32Array(indices),baseline=fitSurfaceFootprints(data,data,parent,.01),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=a=>Buffer.from(a.buffer);
for(const [dir,name,value]of [[source,'surfels.f32',data],[source,'triangles.u32',triangles],[level,'surfels.f32',data],[level,'parent.u32',parent],[level,'footprints.f32',baseline]])fs.writeFileSync(path.join(dir,name),bytes(value));
const m={ok:true,stride:12,count:9,sourceCount:9,radius:.01,dataSHA256:hash(bytes(data)),triangles:{file:'triangles.u32',count:8,sha256:hash(bytes(triangles))}};
const l={...m,sourceDataSHA256:m.dataSHA256,parentSHA256:hash(bytes(parent)),footprints:{file:'footprints.f32',stride:8,sha256:hash(bytes(baseline))}};
fs.writeFileSync(source+'/report.json',JSON.stringify(m));fs.writeFileSync(level+'/report.json',JSON.stringify(l));
const run=out=>spawnSync(process.execPath,['tools/prepare-boundary-splats.mjs',source,level,out],{encoding:'utf8'});
try{
 const out=root+'/valid',r=run(out);assert.equal(r.status,0,r.stdout+r.stderr);
 const report=JSON.parse(fs.readFileSync(out+'/conversion.json'));assert.equal(report.ok,true);assert.equal(report.count,9);assert.equal(report.changedGroups,8);assert.equal(report.unchangedGroups,1);
 assert.deepEqual(fs.readFileSync(out+'/surfels.f32'),bytes(data));assert.deepEqual(fs.readFileSync(out+'/parent.u32'),bytes(parent));
 const fitted=fs.readFileSync(out+'/footprints.f32');assert.deepEqual(fitted.subarray(4*32,5*32),bytes(baseline).subarray(4*32,5*32));
 for(const [name,patch,pattern]of [['wrong-source',{sourceDataSHA256:'wrong'},/belong/],['wrong-field',{dataSHA256:'wrong'},/hash mismatch/],['partial',{count:10},/shape mismatch/]]){
  fs.writeFileSync(level+'/report.json',JSON.stringify({...l,...patch}));const out=root+'/'+name,result=run(out);assert.notEqual(result.status,0);
  const failed=JSON.parse(fs.readFileSync(out+'/conversion.json'));assert.equal(failed.ok,false);assert.match(failed.error,pattern);assert.equal(fs.existsSync(out+'/report.json'),false);
 }
 const before=fs.readFileSync(source+'/report.json');const alias=root+'/alias';fs.symlinkSync(source,alias);assert.notEqual(run(alias).status,0);assert.deepEqual(fs.readFileSync(source+'/report.json'),before);
 console.log('Boundary refit preserves rows/interior; wrong source, partial payload, hash mismatch and aliases reject');
}finally{fs.rmSync(root,{recursive:true});}
