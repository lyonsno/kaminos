import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {BURN_TABLE_ASSET} from '../burn-table-core.mjs';
import {startWitnessServer} from './witness-server.mjs';
import {createOwnedBrowserReveal,greenroomProcessStarts,greenroomRevealBinding} from './owned-browser-reveal.mjs';

export function operatorColdState(state,assetSha) {
  assert.equal(state.status,'cold');assert.equal(state.paused,true);assert.equal(state.burner,false);
  assert.equal(state.fluid.active,true);assert.match(state.fluid.backend,/^WebGPU:/);assert.equal(state.fluid.grid,48);
  assert.ok(state.fields.length);assert.ok(state.fields.every(f=>f.steps===0&&f.runtimeReadbacks===0));
  assert.equal(state.asset.sha256,assetSha);return state;
}

export async function runOperator(output,env=process.env) {
  output=path.resolve(output);await fs.mkdir(output,{recursive:true});
  const repoRoot=path.resolve(import.meta.dirname,'..');
  const report={status:'starting',phase:'preflight',repoRoot,executable:env.CHROME_EXECUTABLE,
    requestId:env.KAMINOS_SMOKE_ID,queueDir:env.GPU_GREENROOM_DIR,errors:[],sources:[],
    claim:'Operator exploration; startup conformance is not heating, cooling or performance acceptance.'};
  const save=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  let browser,browserServer,page,reveal,server,timer,primaryError,resolveEnd,finished=false;
  let recordingWrites=Promise.resolve(),recordingReads=Promise.resolve();
  const ended=new Promise(resolve=>{resolveEnd=resolve;});
  const terminate=()=>resolveEnd('signal');
  try {
    await save();
    for(const name of ['CHROME_EXECUTABLE','PLAYWRIGHT_MODULE','KAMINOS_SMOKE_ID','GPU_GREENROOM_DIR','GREENROOM_PYTHON'])assert.ok(env[name],name+' required');
    assert.ok(!env.CHROME_EXECUTABLE.includes('/Applications/Google Chrome.app/'),'Independent browser required');
    report.phase='server-launch';await save();
    server=await startWitnessServer({repoRoot,output,python:env.PYTHON_EXECUTABLE||'python3'});
    report.server=server.evidence;report.url=server.url;
    const {chromium}=await import(pathToFileURL(path.resolve(env.PLAYWRIGHT_MODULE)));
    browserServer=await chromium.launchServer({executablePath:env.CHROME_EXECUTABLE,headless:false,
      args:['--enable-unsafe-webgpu','--use-angle=metal','--window-size=1440,1000']});
    browser=await chromium.connect(browserServer.wsEndpoint());report.browserPid=browserServer.process().pid;
    browser.on('disconnected',()=>resolveEnd('browser-closed'));
    page=await browser.newPage({viewport:null});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
    page.on('pageerror',error=>{report.errors.push(String(error));});
    page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    page.on('close',()=>resolveEnd('page-closed'));
    report.phase='load';await save();await page.goto(server.url);
    await page.waitForFunction(()=>['mounted','failed'].includes(window.kaminosLiveLogEntry?.status));
    report.entry=await page.evaluate(()=>window.kaminosLiveLogEntry);
    assert.equal(report.entry.status,'mounted',report.entry.error);
    report.effectiveUrl=page.url();report.browserVersion=browser.version();
    for(const name of ['index.html','volume-core.js','burn-table-material.mjs','burn-table.css','basin-fire-fixture.mjs','flame-authoring.mjs','scene-persistence-core.js','live-log-heat-core.mjs',
      'live-log-heat-gpu.mjs','live-log-experiment.mjs','experiments/sinter/live-log-heat.experiment.mjs',
      'workbench-experiments.mjs','investigation-recording.mjs']){
      const response=await page.request.get(new URL(name,server.url).href,{timeout:0});assert.equal(response.status(),200);
      const sha=createHash('sha256').update(await response.body()).digest('hex');
      assert.equal(sha,createHash('sha256').update(await fs.readFile(path.join(repoRoot,name))).digest('hex'));
      report.sources.push({name,sha256:sha});
    }
    report.cold=operatorColdState(await page.evaluate(()=>window.kaminosLiveLog.read()),BURN_TABLE_ASSET.sha256);
    const asset=await page.request.get(new URL(report.cold.source,server.url).href,{timeout:0});
    assert.equal(asset.status(),200);report.assetSha256=createHash('sha256').update(await asset.body()).digest('hex');
    assert.equal(report.assetSha256,BURN_TABLE_ASSET.sha256);assert.deepEqual(report.errors,[]);
    const retain=recording=>{recordingWrites=recordingWrites.then(()=>fs.writeFile(path.join(output,'recording.json'),JSON.stringify(recording,null,2)));return recordingWrites;};
    await page.exposeBinding('__retainLogRecording',(_source,recording)=>retain(recording));
    await page.exposeBinding('__finishLogSession',async()=>{
      if(finished)return;clearInterval(timer);await recordingReads;
      report.phase='operator-finish';
      report.final=await page.evaluate(()=>window.kaminosLiveLog.read());
      await retain(await page.evaluate(()=>window.__logOperatorRecording.finish()));
      await page.screenshot({path:path.join(output,'final.png')});await save();finished=true;resolveEnd('finished');
    });
    await page.evaluate(async ({id,source})=>{
      const {createInvestigationRecording}=await import('./investigation-recording.mjs');
      window.__logOperatorRecording=createInvestigationRecording({id,source,
        initial:await window.kaminosLiveLog.read(),startingConditions:{kind:'cold-local-heat-log'}});
      const button=document.createElement('button');button.type='button';button.className='btn';
      button.textContent='Finish session';button.id='live-log-finish-session';
      button.onclick=async()=>{button.disabled=true;try{await window.__finishLogSession();}catch(error){button.disabled=false;console.error(error);}};
      document.getElementById('live-log-heat').append(button);
    },{id:report.requestId,source:{repoRoot,url:report.effectiveUrl,sources:report.sources,assetSha256:report.assetSha256}});
    await retain(await page.evaluate(()=>window.__logOperatorRecording.snapshot()));
    await page.screenshot({path:path.join(output,'cold.png')});
    // Persist the shared recorder without sampling or reading GPU material state.
    timer=setInterval(()=>{recordingReads=recordingReads.then(()=>page.evaluate(()=>window.__logOperatorRecording.snapshot())).then(retain).catch(error=>{
      if(!page.isClosed())report.recordingError=String(error);
    });},500);
    process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
    report.phase='publication';await save();
    const binding=await greenroomRevealBinding(env.GREENROOM_PYTHON,report.queueDir,report.requestId,report.effectiveUrl);
    reveal=await createOwnedBrowserReveal({page,browser,browserPid:report.browserPid,binding,
      socketPath:env.KAMINOS_REVEAL_SOCKET||null,readStarts:pids=>greenroomProcessStarts(env.GREENROOM_PYTHON,pids),
      record:receipt=>fs.appendFile(path.join(output,'reveal-receipts.jsonl'),JSON.stringify(receipt)+'\n')});
    report.browserReveal=reveal.identity;
    const publication=spawn(env.GREENROOM_PYTHON,['-c',
      'import sys,json; from gpu_queue.smoke_session import publish; print(json.dumps(publish(sys.argv[1],queue_dir=sys.argv[2],browser_url=sys.argv[3],browser_reveal=json.loads(sys.argv[4]),label="Cold log accepting input")))',
      report.requestId,report.queueDir,report.effectiveUrl,JSON.stringify(reveal.identity)],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';publication.stdout.on('data',chunk=>stdout+=chunk);publication.stderr.on('data',chunk=>stderr+=chunk);
    const exit=await new Promise((resolve,reject)=>{publication.once('error',reject);publication.once('close',resolve);});
    report.publication={exit,stdout,stderr};assert.equal(exit,0,'Greenroom usable publication failed: '+stderr);
    report.status='interactive';report.phase='operator';await save();
    report.endReason=await ended;
    report.status=finished?'completed':'ended-without-finish';report.phase='cleanup';
    if(report.recordingError)throw Error(report.recordingError);
    assert.deepEqual(report.errors,[]);
  }catch(error){primaryError=error;report.status='failed';report.error=String(error?.stack||error);}
  finally {
    clearInterval(timer);process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);
    const shutdownErrors=[];
    try{if(reveal)await reveal.dispose();}catch(error){shutdownErrors.push(String(error));}
    try{await recordingReads;}catch(error){shutdownErrors.push(String(error));}
    try{if(page&&!page.isClosed())await page.evaluate(()=>window.kaminosLiveLog?.dispose());}catch(error){shutdownErrors.push(String(error));}
    try{if(browser)await browser.close();}catch(error){shutdownErrors.push(String(error));}
    try{if(browserServer)await browserServer.close();}catch(error){shutdownErrors.push(String(error));}
    try{if(server)await server.stop();}catch(error){shutdownErrors.push(String(error));}
    try{await recordingWrites;}catch(error){shutdownErrors.push(String(error));}
    report.shutdownComplete=!shutdownErrors.length;report.shutdownErrors=shutdownErrors;
    if(shutdownErrors.length){report.status='failed';if(!primaryError)report.phase='shutdown';}
    report.finishedAt=new Date().toISOString();await save();
    if(primaryError)throw primaryError;if(shutdownErrors.length)throw Error(shutdownErrors.join('\n'));
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Explicit output path required');
  await runOperator(process.argv[2]);
}
