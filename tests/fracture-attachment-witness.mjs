// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkRefinement} from '../tools/fracture-refinement-check.mjs';

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
