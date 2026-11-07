// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),script=process.env.KAMINOS_PREFERENCES_WITNESS??new URL('./user-preferences-browser.mjs',import.meta.url).pathname;
test('an early witness argument failure replaces a stale success with a phase-bearing failure',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'preferences-witness-'));
 try{
  const target=path.join(out,'preferences-browser-report.json');await fs.writeFile(target,JSON.stringify({status:'passed',phase:'complete'}));
  await assert.rejects(execute(process.execPath,[script,'http://localhost',out,'/fixture/repo']));
  const report=JSON.parse(await fs.readFile(target,'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'arguments');assert.match(report.error,/independent-browser/);
 }finally{await fs.rm(out,{recursive:true,force:true});}
});

test('profile setup failure still produces a fresh terminal report',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'preferences-setup-'));
 try{
  const preload=path.join(out,'fail-profile.mjs');await fs.writeFile(preload,"import fs from 'node:fs/promises';fs.mkdtemp=async()=>{throw Error('injected profile setup failure');};");
  await assert.rejects(execute(process.execPath,['--import',preload,script,'http://localhost',out,'/fixture/repo','/fake/playwright.mjs','/fake/browser']));
  const report=JSON.parse(await fs.readFile(path.join(out,'preferences-browser-report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'profile-setup');assert.match(report.error,/injected profile setup/);
 }finally{await fs.rm(out,{recursive:true,force:true});}
});

test('browser launch failure records its phase after successful argument and profile setup',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'preferences-launch-'));
 try{
  const preload=path.join(out,'fetch-fixture.mjs'),backend=path.join(out,'browser-fixture.mjs');
  await fs.writeFile(preload,`globalThis.fetch=async url=>({status:200,json:async()=>String(url).endsWith('/api/runtime-config')?{source:{repoRoot:'/fixture/repo'}}:{revision:null,preferences:{},storePath:${JSON.stringify(out+'/preferences.json')}}});`);
  await fs.writeFile(backend,"export const chromium={launchPersistentContext:async()=>{throw Error('injected browser launch failure');}};");
  await assert.rejects(execute(process.execPath,['--import',preload,script,'http://fixture',out,'/fixture/repo',backend,'/fixture/browser']));
  const report=JSON.parse(await fs.readFile(path.join(out,'preferences-browser-report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'browser-launch');assert.match(report.error,/injected browser launch/);
  assert.deepEqual((await fs.readdir(out)).filter(name=>name.startsWith('browser-')&&!name.endsWith('.mjs')),[],'owned profile must be cleaned after a failed launch');
 }finally{await fs.rm(out,{recursive:true,force:true});}
});

test('console-only SSGI compilation failure is retained and refused before UI success',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'preferences-compiler-'));
 const diagnostic='THREE.TSL: Invalid generated code, expected a "vec3".';
 try{
  const preload=path.join(out,'fetch-fixture.mjs'),backend=path.join(out,'browser-fixture.mjs'),closed=path.join(out,'closed');
  await fs.writeFile(preload,`globalThis.fetch=async url=>({status:200,json:async()=>String(url).endsWith('/api/runtime-config')?{source:{repoRoot:'/fixture/repo'}}:{revision:null,preferences:{},storePath:${JSON.stringify(out+'/preferences.json')}}});`);
  await fs.writeFile(backend,`import fs from 'node:fs/promises';const handlers=new Map();const page={setDefaultTimeout(){},async addInitScript(){},on(name,handler){handlers.set(name,handler);},async goto(){handlers.get('console')?.({type:()=> 'error',text:()=>${JSON.stringify(diagnostic)}});},async waitForFunction(){},keyboard:{async press(){}},locator(){return {count:async()=>0};}};export const chromium={launchPersistentContext:async()=>({pages:()=>[page],close:async()=>fs.writeFile(${JSON.stringify(closed)},'closed')})};`);
  await assert.rejects(execute(process.execPath,['--import',preload,script,'http://fixture',out,'/fixture/repo',backend,'/fixture/browser']));
  const report=JSON.parse(await fs.readFile(path.join(out,'preferences-browser-report.json'),'utf8'));
  assert.deepEqual(report.errors,[],'the compiler signal must be independent of page exceptions');
  assert.deepEqual(report.shaderErrors,[diagnostic],'terminal evidence must retain the actual console compiler signal');
  assert.equal(report.status,'failed');assert.equal(report.phase,'open');assert.match(report.error,/SSGI compiler diagnostics/);
  assert.equal(await fs.readFile(closed,'utf8'),'closed');
  assert.deepEqual((await fs.readdir(out)).filter(name=>name.startsWith('browser-')&&!name.endsWith('.mjs')),[]);
 }finally{await fs.rm(out,{recursive:true,force:true});}
});
