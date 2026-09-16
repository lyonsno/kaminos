import {mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {sha256,verifyIdentity,verifyMotion,ELFINBLUE_PRESET,PRESET_AUTHORITY} from '../lib/kimodo-witness-contracts.mjs';
import {createWitnessWatchdog} from '../lib/kimodo-witness-watchdog.mjs';

const [kimodoRoot, output, url='http://127.0.0.1:8096/kimodo-elfinblue.html',expectedHostCommit,expectedProducerCommit] = process.argv.slice(2);
if(!kimodoRoot||!output)throw new Error('Usage: node scripts/witness-kimodo-live-flame.mjs <kimodo-checkout> <output-directory> [url]');
await mkdir(output,{recursive:true});
const report={schema:'kimodo.flame-browser-witness.v1',status:'started',phase:'preflight',url,startedAt:new Date().toISOString(),errors:[],console:[],resources:[]};
const persist=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
let browser, interval, watchdogInterval, lease;
const greenroom=process.env.GREENROOM_BIN;
const leaseId=`kimodo-flame-${process.pid}`;
try{
  if(!greenroom)throw new Error('GREENROOM_BIN must name the inspected Greenroom CLI');
  if(!/^[a-f0-9]{40}$/.test(expectedHostCommit??'')||!/^[a-f0-9]{40}$/.test(expectedProducerCommit??''))throw new Error('Explicit full expected host and producer commit arguments required after URL');
  report.revisionPins={host:expectedHostCommit,producer:expectedProducerCommit,source:'caller-arguments'};
  report.hostCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(report.hostCommit!==expectedHostCommit)throw new Error('Host checkout differs from caller revision pin');
  if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw new Error('Witness host source must be committed');
  const expected=JSON.parse(await readFile('artifacts/kimodo-live-flame/manifest.json','utf8'));
  if(expected.hostCommit!==report.hostCommit)throw new Error('Rebuild library manifest at the current host commit');
  if(expected.sourceCommit!==expectedProducerCommit||expectedProducerCommit!==execFileSync('git',['-C',kimodoRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim())throw new Error('Producer build/checkout differs from caller revision pin');
  const resolve=createRequire(path.join(path.resolve(kimodoRoot),'package.json'));
  report.driver={entry:resolve.resolve('puppeteer-core'),version:JSON.parse(await readFile(resolve.resolve('puppeteer-core/package.json'),'utf8')).version};
  const {default:puppeteer}=await import(pathToFileURL(report.driver.entry));
  report.expected=expected;
  // Claim failure stops launch; no inference may run after a refused claim.
  report.leaseClaim=execFileSync(greenroom,['lease','claim','--lease-id',leaseId,'--owner','marionette-gut-splicer','--agent-id','marionette-flame-witness','--repo-root',process.cwd(),'--pid',String(process.pid),'--effective-route',url,'--backend','metal','--device','apple-gpu','--profile','browser-smoke','--supports-checkpoints','--ttl-seconds','900'],{encoding:'utf8'});
  lease=true;report.phase='browser-launch';await persist();
  interval=setInterval(()=>{try{execFileSync(greenroom,['lease','renew',leaseId,'--ttl-seconds','900'],{encoding:'utf8'});}catch(error){report.errors.push(`lease renewal failed: ${error.message}`);void browser?.close();}},60000);
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  const watchdog=createWitnessWatchdog(Date.now());let sampling=false;
  watchdogInterval=setInterval(()=>{
    if(report.watchdogFailure)return;
    const expired=watchdog.check(Date.now());
    if(expired){
      report.watchdogFailure=expired;
      void page.evaluate(()=>document.getElementById('kimodo-cancel')?.click()).catch(()=>{});
      void browser.close();return;
    }
    if(sampling)return;sampling=true;
    void page.evaluate(()=>{const s=window.__kimodoLiveFlame;return s?{status:s.status,loadProgress:s.loadProgress,telemetry:s.telemetry,lastError:s.lastError}:null;})
      .then(s=>{report.lastTrustworthy=s;if(report.phase!=='motion-export')watchdog.observe(report.phase,[s?.status,s?.loadProgress?.loaded,s?.telemetry?.currentStage,s?.telemetry?.progress?.step,s?.telemetry?.scheduler?.observedForegroundBoundaryCount],Date.now());})
      .catch(()=>{}).finally(()=>sampling=false);
  },1000);
  await page.setCacheEnabled(false);
  const responses=[];
  page.on('response',response=>{
    const resource=new URL(response.url());
    if(resource.origin!==new URL(url).origin||resource.pathname.startsWith('/api/')||resource.pathname.endsWith('/kimodo.bin'))return;
    const file=decodeURIComponent(resource.pathname.slice(1))||'index.html';
    // These selector documents unload before CDP can reliably retain bodies.
    // They own no runtime claim: admit the final URL/preset and actual loaded
    // host/producer instead. Keep their request identity without a byte claim.
    if(['kimodo-elfinblue.html','sf3d-elfinblue.html'].includes(file)){
      (report.entryRequests??=[]).push({url:response.url(),status:response.status(),authority:'navigation-only'});return;
    }
    if(!/\.(?:html|js|mjs|css|json|wgsl|glsl)$/.test(file))return;
    responses.push((async()=>{
      const record={path:file,status:response.status()};report.resources.push(record);
      try{
        record.sha256=sha256(await response.buffer());
        if(file.startsWith('artifacts/kimodo-live-flame/assets/'))record.expectedSha256=expected.assets[path.basename(file)]?.sha256;
        else if(file.startsWith('artifacts/kimodo-live-flame/lib/'))record.expectedSha256=expected.bundles[path.basename(file)];
        else if(file==='artifacts/kimodo-live-flame/manifest.json')record.expectedSha256=sha256(await readFile(file));
        else record.expectedSha256=sha256(execFileSync('git',['show',`${report.hostCommit}:${file}`],{maxBuffer:Infinity}));
        if(record.sha256!==record.expectedSha256)record.error='served bytes differ from expected source';
      }catch(error){record.error=error.message;}
    })());
  });
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warn')report.console.push({type:msg.type(),text:msg.text()});});
  report.phase='page-load';await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.samples.some(s=>s.active&&s.frameCount>5),{timeout:120000});
  report.phase='weights';await persist();await page.click('#kimodo-load');
  await page.waitForFunction(()=>['loaded','failed'].includes(window.__kimodoLiveFlame?.status),{timeout:0});
  if(await page.evaluate(()=>window.__kimodoLiveFlame.status)!=='loaded')throw new Error(await page.evaluate(()=>JSON.stringify(window.__kimodoLiveFlame.lastError)));
  // Fail substituted routes before spending an inference run.
  await Promise.all(responses);
  const loaded=await page.evaluate(()=>window.__kimodoLiveFlame);
  verifyIdentity({expected,effective:loaded.source,resources:report.resources,weightsHash:loaded.producerIdentity?.model?.weightsHash,url:page.url(),expectedHostCommit,expectedProducerCommit});
  const loadedPreset=await page.evaluate(()=>window.__kaminosVolumeSettingsPresetReceipt);
  if(loadedPreset?.presetId!==ELFINBLUE_PRESET||loadedPreset?.sourcePresetAuthority!==PRESET_AUTHORITY)throw new Error('Effective preset failed before generation');
  report.phase='baseline';await persist();
  await new Promise(r=>setTimeout(r,5000));
  await page.screenshot({path:path.join(output,'baseline.png')});
  await page.$eval('#kimodo-duration',el=>el.value='6');
  await page.$eval('#kimodo-steps',el=>el.value='100');
  report.phase='generation';await persist();await page.click('#kimodo-run');
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.runs.length===1,{timeout:15000});
  // Capture one in-progress frame after sampling begins; preserve terminal even if this fails.
  try{
    await page.waitForFunction(()=>window.__kimodoLiveFlame?.telemetry?.progress?.step>=5 || window.__kimodoLiveFlame?.runs[0]?.status!=='running',{timeout:120000});
    if(await page.evaluate(()=>window.__kimodoLiveFlame.runs[0].status==='running'))await page.screenshot({path:path.join(output,'during.png')});
  }catch(error){report.captureError=error.message;}
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.runs[0]?.status!=='running',{timeout:0});
  await page.waitForFunction(()=>document.querySelector('#kimodo-stage')?.textContent.startsWith('succeeded')||window.__kimodoLiveFlame.status!=='succeeded',{timeout:15000});
  report.evidence=await page.evaluate(()=>window.__kimodoLiveFlame);
  report.effectiveUrl=page.url();
  report.phase='identity';await persist();await Promise.all(responses);
  if(report.resources.some(r=>r.error))throw new Error('Served-resource identity failed; see resources');
  report.presetReceipt=await page.evaluate(()=>window.__kaminosVolumeSettingsPresetReceipt);
  if(report.presetReceipt?.presetId!==ELFINBLUE_PRESET||report.presetReceipt?.sourcePresetAuthority!==PRESET_AUTHORITY)throw new Error('Effective flame preset receipt mismatch');
  report.identity=verifyIdentity({expected,effective:report.evidence.source,resources:report.resources,weightsHash:report.evidence.producerIdentity?.model?.weightsHash,url:report.effectiveUrl,expectedHostCommit,expectedProducerCommit});
  await page.screenshot({path:path.join(output,'complete.png')});
  // Exercise actual exported motion via the same download used by the operator.
  report.phase='motion-export';await persist();
  watchdog.observe('motion-export','waiting-for-download',Date.now());
  const downloadDir=path.join(output,'downloads');await mkdir(downloadDir); // Reuse is an error: stale artifacts cannot pass.
  const before=await readdir(downloadDir);
  const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.resolve(downloadDir),eventsEnabled:true});
  let download;
  const completed=new Promise((resolve,reject)=>{
    cdp.on('Browser.downloadWillBegin',event=>{download=event;watchdog.observe('motion-export',event.guid,Date.now());});
    cdp.on('Browser.downloadProgress',event=>{if(event.guid===download?.guid){watchdog.observe('motion-export',[event.guid,event.receivedBytes,event.state],Date.now());if(event.state==='completed')resolve();if(event.state==='canceled')reject(new Error('Motion download canceled'));}});
    browser.once('disconnected',()=>reject(new Error('Browser disconnected before download completion')));
  });
  if(await page.$eval('#kimodo-motion-download',el=>el.disabled))throw new Error('No motion export available');
  await page.click('#kimodo-motion-download');await completed;
  const files=(await readdir(downloadDir)).filter(f=>!before.includes(f));
  if(files.length!==1||files[0]!==download.suggestedFilename||files[0].endsWith('.crdownload'))throw new Error('Motion download incomplete or ambiguous');
  const file=path.join(downloadDir,files[0]);report.motionExport={...verifyMotion(await readFile(file),report.evidence.runs[0]),path:file,downloadGuid:download.guid};
  report.status=report.evidence.runs[0].status==='coexistence-observed'&&report.errors.length===0&&report.identity?.status==='verified'&&report.motionExport?.status==='verified'?'passed':'failed';
  report.phase='terminal';
}catch(error){report.status='failed';report.failurePhase=report.phase;report.error={message:error.message,stack:error.stack};
  if(browser){const pages=await browser.pages().catch(()=>[]);const page=pages.at(-1);if(page){report.evidence=await page.evaluate(()=>window.__kimodoLiveFlame??null).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}}
}finally{
  clearInterval(interval);
  clearInterval(watchdogInterval);
  await browser?.close().catch(error=>report.closeError=error.message);
  if(lease)try{report.leaseRelease=execFileSync(greenroom,['lease','release',leaseId,'--released-by','marionette-gut-splicer','--reason','browser witness terminated'],{encoding:'utf8'});}catch(error){report.leaseReleaseError=error.message;report.status='failed';}
  report.finishedAt=new Date().toISOString();await persist();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,run:report.evidence?.runs?.[0],report:path.join(output,'report.json')},null,2));
process.exitCode=report.status==='passed'?0:1;
