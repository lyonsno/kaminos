// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const root=new URL('../',import.meta.url).pathname,asset=path.join(root,'assets/arch-stones/03-bedded-stone-500-normal.glb');
const hash=b=>createHash('sha256').update(b).digest('hex');
const directory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'stone-prepare-contract-'));
const write=(p,value)=>{const b=Buffer.from(JSON.stringify(value));fs.writeFileSync(p,b);return hash(b);};
const run=args=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
const mesh={status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6};

test('a graph-only preparation does not execute the unused peridynamic contender',()=>{
 const dir=directory(),input=path.join(dir,'mesh.json'),config=path.join(dir,'config.json'),out=path.join(dir,'prepared');write(input,mesh);write(config,{kinds:['graph'],young:100000,poisson:.25,density:1000,damageLaw:'event-frozen-isotropic-degradation-v1'});
 const result=run(['structural-material-solid-prepare.mjs',input,out,config]);
 assert.equal(result.status,0,result.stdout+result.stderr);const r=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
 assert.equal(r.status,'passed');assert.deepEqual(r.models.map(m=>m.kind),['graph']);assert.equal(r.models[0].buffers.coefficients.byteLength,36*4);
});
test('an explicit invalid material selection fails with a durable report',()=>{
 for(const kinds of [null,[],['graph','graph'],['unknown']]){
  const dir=directory(),input=path.join(dir,'mesh.json'),config=path.join(dir,'config.json'),out=path.join(dir,'prepared');write(input,mesh);write(config,{kinds,damageLaw:'event-frozen-isotropic-degradation-v1'});
  const result=run(['structural-material-solid-prepare.mjs',input,out,config]);
  assert.notEqual(result.status,0);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.match(report.failure.message,/material kinds/);assert.deepEqual(report.models,[]);
 }
});
test('live preparation carries its source asset, base support and geometry preparation',()=>{
 const dir=directory(),prepared=path.join(dir,'prepared'),out=path.join(dir,'live');fs.mkdirSync(prepared);
 const sourceSha256=hash(fs.readFileSync(asset)),exterior=path.join(dir,'source.json'),interior=path.join(dir,'interior.json'),setup=path.join(dir,'setup.json');
 // Synthetic producer records exercise local identity/copy policy, not mesher conformance.
 const inputSha256=write(exterior,{status:'passed',sourceSha256,size:[2.4,.6,.6]});
 const interiorHash=write(interior,{...mesh,sourceSha256,source:exterior,inputSha256});
 write(path.join(prepared,'report.json'),{status:'passed',input:interior,inputSha256:interiorHash,sourceSha256,config:{young:100000,poisson:.25,density:1000},models:[{kind:'graph',volume:1/6,buffers:{}}]});
 const support={kind:'clamp-min',axis:1,band:.035};write(setup,{id:'kiln-control',label:'Kiln control',support});
 const result=run(['structural-material-shard-live-prepare.mjs',prepared,asset,out,setup]);assert.equal(result.status,0,result.stdout+result.stderr);
 const r=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));assert.equal(r.sourceAsset?.sha256,sourceSha256,'The selected source must not fall back to the bar material');
 assert.equal(r.sourceAsset.url,'./source.glb');assert.equal(r.sourceAsset.triangles,500);assert.deepEqual(r.support,support);
 assert.equal(hash(fs.readFileSync(path.join(out,'source.glb'))),sourceSha256);assert.equal(r.mechanicalPreparation.surfaceTolerance,0);
 write(setup,{id:'kiln-control',label:'Kiln control'});
 const rejected=run(['structural-material-shard-live-prepare.mjs',prepared,asset,out,setup]);assert.notEqual(rejected.status,0);
 const failure=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));assert.equal(failure.status,'failed');assert.equal(failure.phase,'input');assert.match(failure.failure.message,/support/i);
});
