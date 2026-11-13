// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {makeTrainingRun} from './training.mjs';
import {q4Fixture} from './q4-reference.mjs';

// Only pre-browser failures. GPU integration is separately exercised against
// an independent Chrome and the actual Greenroom SDK, not faked here.
test('runner preserves phase report for missing data, fallback route and stale checkpoint',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'training-negative-'));
  const manifest=path.join(dir,'run.json'),out=path.join(dir,'report.json');
  const run=await makeTrainingRun({fixtures:[q4Fixture()],updates:1});
  for(const [name,configure,extra,phase]of [
    ['missing',async()=>{},[],'manifest'],
    ['route',async()=>fs.writeFile(manifest,JSON.stringify({...run,backend:'wasm'})),[],'manifest'],
    ['stale',async()=>{await fs.writeFile(manifest,JSON.stringify(run));await fs.writeFile(path.join(dir,'saved.json'),JSON.stringify({schema:'kaminos.training-checkpoint.v1',source:{}}));},['--resume',path.join(dir,'saved.json')],'resume-validation']
  ]){
    await configure();
    const child=spawnSync(process.execPath,['training-runner.mjs','--manifest',manifest,'--out',out,'--chrome','/missing/browser',...extra],{cwd:import.meta.dirname,encoding:'utf8'});
    assert.equal(child.status,1,name+child.stderr);
    const report=JSON.parse(await fs.readFile(out));assert.equal(report.status,'failed');assert.equal(report.phase,phase);assert.ok(report.error.message);
    assert.equal(report.browserPid,undefined);assert.equal(report.cleanup.browserClosed,true);
  }
});

test('report alias cannot overwrite the caller manifest',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'training-alias-')),file=path.join(dir,'run.json');
  const bytes=JSON.stringify(await makeTrainingRun({fixtures:[q4Fixture()],updates:1}));await fs.writeFile(file,bytes);
  const child=spawnSync(process.execPath,['training-runner.mjs','--manifest',file,'--out',file],{cwd:import.meta.dirname,encoding:'utf8'});
  assert.equal(child.status,1);assert.match(child.stderr,/output aliases/);assert.equal(await fs.readFile(file,'utf8'),bytes);
});

test('checkpoint symlink alias rejects before browser launch and preserves input',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'training-checkpoint-alias-'));
  const file=path.join(dir,'run.json'),checkpoint=path.join(dir,'saved.json'),out=path.join(dir,'report.json');
  const bytes=JSON.stringify(await makeTrainingRun({fixtures:[q4Fixture()],updates:1}));
  await fs.writeFile(file,bytes);await fs.symlink(file,checkpoint);
  const child=spawnSync(process.execPath,['training-runner.mjs','--manifest',file,'--out',out,'--checkpoint-out',checkpoint,'--chrome','/missing/browser'],{cwd:import.meta.dirname,encoding:'utf8'});
  assert.equal(child.status,1);const report=JSON.parse(await fs.readFile(out));
  assert.match(report.error.message,/checkpoint output aliases/);assert.equal(report.browserPid,undefined);
  assert.equal(await fs.readFile(file,'utf8'),bytes);
});
