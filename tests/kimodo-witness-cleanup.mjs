// Execute the actual CLI in a CPU-only VM. Browser/Greenroom and source
// admission are explicit fakes: these reports cannot establish live evidence.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const scenarios=['load-stall','generation-stall','never-started','download-stall','close-hangs','renew-fails'];
if(!process.argv[2]){
  const root=await fs.mkdtemp(path.join(tmpdir(),'kimodo-cleanup-'));
  for(const scenario of scenarios){
    const output=path.join(root,scenario);
    const child=spawnSync(process.execPath,['--experimental-vm-modules',import.meta.filename,scenario,output],{encoding:'utf8',timeout:10000});
    assert.equal(child.error,undefined,`${scenario}: child must finish without the test runner killing it`);
    const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
    assert.equal(report.evidenceAuthority,'cpu-only-fake-browser-greenroom');
    assert.equal(report.status,'failed',scenario);
    assert.ok(report.finishedAt,`${scenario}: terminal report must survive rejecting/hung close (${child.stderr})`);
    assert.equal(child.status,1,`${scenario}: failed witness exits nonzero`);
    assert.equal(report.leaseRelease,'fake-release',`${scenario}: release attempted`);
    assert.ok(report.lastTrustworthy,`${scenario}: observed state retained`);
    assert.ok(report.closeError,`${scenario}: teardown error retained`);
    assert.equal(report.browserFallback?.signal,'SIGKILL');
    const before=JSON.parse(await fs.readFile(path.join(output,'before-close.json'),'utf8'));
    assert.equal(before.status,'failed','failure is durable BEFORE fallible teardown');
    if(scenario==='renew-fails')assert.match(report.error.message,/renewal/);
    else {
      assert.equal(report.watchdogFailure.kind,'no-progress');
      assert.equal(report.failurePhase,scenario==='download-stall'?'motion-export':scenario==='generation-stall'||scenario==='never-started'?'generation':'weights');
    }
  }
  console.log(`CPU-only actual witness failure paths pass (${scenarios.length}); reports: ${root}`);
}else{
  const [scenario,output]=process.argv.slice(2),pin='a'.repeat(40);
  let now=0,watchdogTick,renewTick,stalled=false;
  const hung=()=>new Promise(()=>{});
  const state={status:'loaded',loadProgress:{loaded:7,total:10},source:{},producerIdentity:{model:{}},telemetry:{progress:{step:0},scheduler:{}},runs:[]};
  const cdp=new EventEmitter();cdp.send=async()=>{};
  const browser=new EventEmitter();
  const page=new EventEmitter();
  function stall(){
    stalled=true;
    setImmediate(async()=>{
      watchdogTick();await new Promise(setImmediate); // preserve actual observed state
      if(scenario==='generation-stall'){state.telemetry.progress.step=5;now+=1000;watchdogTick();await new Promise(setImmediate);}
      now+=121001;
      if(scenario==='renew-fails')renewTick();else watchdogTick();
    });
    return hung();
  }
  page.setViewport=page.setCacheEnabled=page.goto=async()=>{};
  page.url=()=>`http://fixture.invalid/volume.html`;
  page.$eval=async()=>false;
  page.screenshot=()=>stalled?hung():Promise.resolve();
  page.click=async selector=>{
    if(selector==='#kimodo-run'&&scenario!=='never-started')state.runs=[{status:'running'}];
    if(selector==='#kimodo-motion-download'){
      cdp.emit('Browser.downloadWillBegin',{guid:'fake',suggestedFilename:'motion.json'});
      cdp.emit('Browser.downloadProgress',{guid:'fake',receivedBytes:1,state:'inProgress'});
      void stall();
    }
  };
  page.evaluate=async fn=>{
    const s=String(fn);
    if(s.includes('kimodo-cancel'))return hung();
    if(s.includes('lastError:s.lastError'))return structuredClone(state);
    if(stalled)return hung(); // diagnostics must not strand cleanup
    if(s.includes('__kaminosVolumeSettingsPresetReceipt'))return {presetId:'fake',sourcePresetAuthority:'fake'};
    if(s.includes("status==='running'"))return false;
    if(s.endsWith('__kimodoLiveFlame.status'))return 'loaded';
    return structuredClone(state);
  };
  page.waitForFunction=async fn=>{
    const s=String(fn);
    if(s.includes("['loaded','failed']")&&['load-stall','close-hangs','renew-fails'].includes(scenario))return stall();
    if(s.includes('runs.length===1')&&scenario==='never-started')return stall();
    if(s.includes('progress?.step>=5')){
      if(scenario==='generation-stall'){state.telemetry.progress.step=5;return;}
      state.runs=[{status:'coexistence-observed'}];
    }
    if(s.includes("runs[0]?.status!=='running'")&&scenario==='generation-stall')return stall();
  };
  browser.newPage=async()=>page;browser.pages=()=>hung();
  browser.target=()=>({createCDPSession:async()=>cdp});
  browser.process=()=>({pid:424242,exitCode:null,signalCode:null,kill:signal=>{assert.equal(signal,'SIGKILL');return true;}});
  browser.disconnect=()=>{};
  browser.close=async()=>{
    await fs.copyFile(path.join(output,'report.json'),path.join(output,'before-close.json'));
    if(scenario==='close-hangs')return hung();
    throw new Error('injected browser.close rejection');
  };
  const fakeExec=(cmd,args)=>{
    if(cmd==='git')return args.includes('status')?'':pin;
    if(args.includes('renew'))throw new Error('injected renewal refusal');
    return args.includes('release')?'fake-release':'fake-claim';
  };
  const context=vm.createContext({console,URL,Buffer,process:{argv:['node','witness', '/fake-kimodo',output,'http://fixture.invalid',pin,pin],env:{GREENROOM_BIN:'fake-greenroom'},pid:424241,cwd:()=>process.cwd()},Date:class extends Date{static now(){return now;}},
    setInterval:(fn,ms)=>{if(ms===1000)watchdogTick=fn;else renewTick=fn;return 1;},clearInterval:()=>{},
    setTimeout:(fn,ms)=>setTimeout(fn,ms===5000?0:Math.min(ms,10)),clearTimeout});
  const mocks={
    'node:fs/promises':{...fs,
      writeFile:async(file,data,...args)=>fs.writeFile(file,String(file).endsWith('report.json')?JSON.stringify({...JSON.parse(data),evidenceAuthority:'cpu-only-fake-browser-greenroom'}):data,...args),
      readFile:async(file,...args)=>String(file).includes('manifest.json')?JSON.stringify({hostCommit:pin,sourceCommit:pin}):String(file).includes('package.json')?'{}':fs.readFile(file,...args)},
    'node:child_process':{execFileSync:fakeExec},
    'node:module':{createRequire:()=>({resolve:x=>`/fake/${x}`})},
    '../lib/kimodo-witness-contracts.mjs':{sha256:()=>'',verifyIdentity:()=>({status:'verified'}),verifyMotion:()=>{throw Error('incomplete download cannot validate');},ELFINBLUE_PRESET:'fake',PRESET_AUTHORITY:'fake'},
  };
  const synthetic=(values)=>new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});
  const modules=new Map();
  async function sourceModule(file){
    if(modules.has(file))return modules.get(file);
    const m=new vm.SourceTextModule(await fs.readFile(file,'utf8'),{context,identifier:pathToFileURL(file).href,importModuleDynamically:async()=>{const p=synthetic({default:{launch:async()=>browser}});await p.link(()=>{});await p.evaluate();return p;}});
    modules.set(file,m);
    await m.link(async spec=>mocks[spec]?synthetic(mocks[spec]):spec.startsWith('node:')?synthetic(await import(spec)):sourceModule(path.resolve(path.dirname(file),spec)));
    return m;
  }
  const main=await sourceModule(path.resolve('scripts/witness-kimodo-live-flame.mjs'));
  await main.evaluate();
  process.exitCode=context.process.exitCode;
}
