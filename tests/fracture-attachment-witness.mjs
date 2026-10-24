// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {checkRefinement} from '../tools/fracture-refinement-check.mjs';

test('browser settlement keeps awaiting busy reads instead of accepting a truthy Promise',async()=>{
 const source=fs.readFileSync(new URL('../tools/fracture-attachment-witness.mjs',import.meta.url),'utf8');
 const start=source.indexOf('const settled='),end=source.indexOf('\n const type=',start);
 assert.ok(start>=0&&end>start,'settling helper must be available for replay');
 const frames=[];let reads=0,done=false;
 const scope={window:{kaminosWorkbenchExperiments:{read:async()=>({busy:++reads<3})}},requestAnimationFrame:fn=>frames.push(fn),page:{evaluate:fn=>fn(),
  // Observed Playwright1.63 polling behavior (coreBundle.js:24413): tests a
  // returned Promise for truthiness before awaiting its resolved value.
  waitForFunction:async predicate=>{const result=predicate();if(result)return result;throw Error('Synchronous predicate requires another poll');}}};
 const settled=vm.runInNewContext(source.slice(start,end)+';settled',scope);
 const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const waiting=settled().then(state=>{done=true;return state;});await drain();
 assert.equal(done,false,'a busy read cannot complete the wait');
 for(let i=1;i<=3;i++){assert.equal(frames.length,1);frames.shift()();await drain();assert.equal(reads,i);assert.equal(done,i===3);}
 assert.equal((await waiting).busy,false);
});

test('refinement witness accepts exhausted depth-2 branches and rejects hidden or merged grouping',()=>{
 const hierarchy={nodes:[{id:0,parent:null,depth:0},{id:1,parent:0,depth:1},{id:2,parent:1,depth:2},{id:3,parent:1,depth:2}],faceOwners:[0,2,3]};
 const finest={hierarchy,labels:[0,1,2],partition:{parts:[{nodeId:0},{nodeId:2},{nodeId:3}]}};
 const coarse={hierarchy,labels:[0,1,1],partition:{parts:[{nodeId:0},{nodeId:1}]}};
 assert.equal(checkRefinement(finest,structuredClone(finest),1).status,'saturated');
 assert.throws(()=>checkRefinement(coarse,coarse,1),/did not expose/);
 assert.equal(checkRefinement(coarse,finest,1).status,'refined');
 assert.throws(()=>checkRefinement(finest,coarse,1),/merged/);
});

test('source identification failure replaces stale success with a terminal report',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'fracture-witness-failure-'));
 try{
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:'passed',sourceCommit:'old'}));
  const run=spawnSync(process.execPath,[new URL('../tools/fracture-attachment-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out,'/unavailable-playwright','/unavailable-browser'],{env:{...process.env,PATH:'/nonexistent'},encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed','startup must overwrite an old success');assert.equal(report.phase,'terminal');assert.equal(report.lastPhase,'source-identification');assert.equal(report.sourceCommit,null);assert.match(report.failure.message,/git|ENOENT/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('an invalid object identity fails before browser launch with a durable report',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'fracture-witness-spec-'));
 try{
  const spec=path.join(out,'object.json');fs.writeFileSync(spec,JSON.stringify({triangles:12}));
  const run=spawnSync(process.execPath,[new URL('../tools/fracture-attachment-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out,'/unavailable-playwright','/unavailable-browser',spec],{encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed');assert.equal(report.lastPhase,'object-identity');assert.match(report.failure.message,/object identity/i);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('an invalid fixture click fails before browser launch with a durable report',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'fracture-witness-click-'));
 try{
  const spec=path.join(out,'object.json');fs.writeFileSync(spec,JSON.stringify({name:'fixture',triangles:12,sha256:'a'.repeat(64),source:'/fixture.glb',click:[2,.5]}));
  const run=spawnSync(process.execPath,[new URL('../tools/fracture-attachment-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out,'/unavailable-playwright','/unavailable-browser',spec],{encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.lastPhase,'object-identity');assert.match(report.failure.message,/fixture click/i);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('boundary witness refuses unchanged cuts and altered neighboring attachments',async()=>{
 const module=await import('../tools/fracture-refinement-check.mjs');
 assert.equal(typeof module.checkBoundaryChange,'function','local cut evidence must reject false closure');
 const before={triangleCount:4,labels:[0,1,2,2],candidateBranches:[{key:'target',status:'included',faces:[2,3]},{key:'neighbor',status:'included',faces:[0]}]};
 const after={...before,candidateBranches:[{key:'target',status:'included',faces:[1,2,3]},{key:'neighbor',status:'included',faces:[0]}]};
 assert.equal(module.checkBoundaryChange(before,after,'target').changedTriangles,1);
 assert.throws(()=>module.checkBoundaryChange(before,before,'target'),/did not move/);
 assert.throws(()=>module.checkBoundaryChange(before,{...after,candidateBranches:[after.candidateBranches[0],{key:'neighbor',status:'included',faces:[0,1]}]},'target'),/neighbor/);
 assert.throws(()=>module.checkBoundaryChange(before,{...after,labels:[0]},'target'),/source triangle/);
});
