// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkRestoredLogSource} from '../tools/live-log-witness-contracts.mjs';
import {runInNewContext} from 'node:vm';

test('scene restoration completing before owner discovery cannot satisfy the actual wait',async()=>{
  const source=await fs.readFile(new URL('../tools/live-log-current-witness.mjs',import.meta.url),'utf8');
  const start=source.lastIndexOf('await page.waitForFunction(()=>{')+'await page.waitForFunction('.length;
  const end=source.indexOf('\n  });',start)+4;
  const window={kaminosFlameEmitterState:()=>({registered:true})};
  const document={querySelector:()=>null,getElementById:()=>({textContent:'Scene loaded: 2 objects'})};
  const settled=runInNewContext('('+source.slice(start,end)+')',{window,document});
  assert.equal(Boolean(settled()),false);
  window.kaminosWorkbenchExperiments={state:()=>({id:null})};
  assert.equal(Boolean(settled()),true);
});

test('restoration evidence rejects early registration, reenabled state and experiment masking',()=>{
  const observed={source:{registered:true,authoredPresent:true,emissionEnabled:false},experiment:{id:null},info:'Scene loaded: 2 objects'};
  assert.doesNotThrow(()=>checkRestoredLogSource(observed));
  assert.throws(()=>checkRestoredLogSource({...observed,source:{...observed.source,registered:false}}),/registered/);
  for(const emissionEnabled of [true,undefined])assert.throws(()=>checkRestoredLogSource({...observed,source:{...observed.source,emissionEnabled}}),/remain disabled/);
  assert.throws(()=>checkRestoredLogSource({...observed,experiment:{id:'live-log-heat'}}),/mask/);
  assert.throws(()=>checkRestoredLogSource({...observed,experiment:undefined}),/mask/);
  assert.throws(()=>checkRestoredLogSource({...observed,info:'Loading'}),/finish loading/);
});

test('witness launch refusal leaves a durable failure and no implied browser/backend',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-witness-refusal-'));
  const child=spawnSync(process.execPath,['tools/live-log-current-witness.mjs','http://127.0.0.1:1',out],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,CHROME_EXECUTABLE:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',PLAYWRIGHT_MODULE:'/missing/driver'}});
  assert.equal(child.status,1);
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'launch');assert.match(report.error,/Independent browser required/);
  assert.equal(report.browserVersion,undefined);assert.equal(report.effective,undefined);assert.deepEqual(report.frames,[]);
});

test('absolute-path invocation binds Git identity to source root rather than caller cwd',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-witness-caller-'));
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/live-log-current-witness.mjs',import.meta.url)),'http://127.0.0.1:1',out],{
    cwd:out,encoding:'utf8',env:{...process.env,CHROME_EXECUTABLE:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}});
  assert.equal(child.status,1);
  const reportPath=path.join(out,'report.json');
  assert.ok(await fs.stat(reportPath).catch(()=>null),'startup failure must preserve a report before Git inspection');
  const report=JSON.parse(await fs.readFile(reportPath));
  assert.match(report.sourceCommit,/^[0-9a-f]{40}$/);assert.match(report.error,/Independent browser required/);
});

test('Git identity failure retains its phase and no browser evidence',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-witness-git-'));
  await fs.writeFile(path.join(out,'git'),'#!/bin/sh\necho deliberate-git-failure >&2\nexit 7\n',{mode:0o755});
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/live-log-current-witness.mjs',import.meta.url)),'http://127.0.0.1:1',out],{
    cwd:out,encoding:'utf8',env:{...process.env,PATH:out}});
  assert.equal(child.status,1);
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'source-identity');assert.match(report.error,/deliberate-git-failure/);
  assert.equal(report.sourceCommit,undefined);assert.equal(report.browserVersion,undefined);assert.deepEqual(report.frames,[]);
});
