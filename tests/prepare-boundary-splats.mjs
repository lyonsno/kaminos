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
const run=(out,...args)=>spawnSync(process.execPath,['tools/prepare-boundary-splats.mjs',source,level,out,...args],{encoding:'utf8'});
function pairedMesh(y){
 const b=Buffer.alloc(48);new Float32Array(b.buffer,b.byteOffset,9).set([-.04,0,0,0,0,0,.04,0,0]);new Uint32Array(b.buffer,b.byteOffset+36,3).set([0,1,2]);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:48}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-.04,0,0],max:[.04,0,0]},{bufferView:1,componentType:5125,count:3,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0,translation:[0,y,0]}],scenes:[{nodes:[0]}],scene:0};
 const text=Buffer.from(JSON.stringify(doc)),n=(text.length+3)&~3,out=Buffer.alloc(28+n+48,32);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(n,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);out.writeUInt32LE(48,20+n);out.writeUInt32LE(0x004e4942,24+n);b.copy(out,28+n);return out;
}
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
 fs.writeFileSync(level+'/report.json',JSON.stringify(l));const reference=root+'/paired.glb';fs.writeFileSync(reference,pairedMesh(-.04));
 const shared=root+'/shared',s=run(shared,reference);assert.equal(s.status,0,s.stdout+s.stderr);
 const sharedReport=JSON.parse(fs.readFileSync(shared+'/conversion.json'));assert.equal(sharedReport.changedGroups,3);assert.equal(sharedReport.pairedMesh.sharedVertices,3);assert.equal(sharedReport.pairedMesh.sha256,hash(fs.readFileSync(reference)));
 assert.deepEqual(fs.readFileSync(shared+'/footprints.f32').subarray(3*32),bytes(baseline).subarray(3*32));
 fs.writeFileSync(reference,pairedMesh(.5));const mismatch=root+'/unrelated';assert.notEqual(run(mismatch,reference).status,0);assert.match(JSON.parse(fs.readFileSync(mismatch+'/conversion.json')).error,/shares no source vertices/);assert.equal(fs.existsSync(mismatch+'/report.json'),false);
 console.log('Boundary refit preserves rows/interior; wrong source, partial payload, hash mismatch and aliases reject');
}finally{fs.rmSync(root,{recursive:true});}
