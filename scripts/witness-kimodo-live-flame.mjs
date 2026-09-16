import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const [kimodoRoot, output, url='http://127.0.0.1:8096/kimodo-elfinblue.html'] = process.argv.slice(2);
if(!kimodoRoot||!output)throw new Error('Usage: node scripts/witness-kimodo-live-flame.mjs <kimodo-checkout> <output-directory> [url]');
await mkdir(output,{recursive:true});
const report={schema:'kimodo.flame-browser-witness.v1',status:'started',phase:'preflight',url,startedAt:new Date().toISOString(),errors:[],console:[],hostCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
const persist=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
let browser, interval, lease;
const greenroom=process.env.GREENROOM_BIN;
if(!greenroom)throw new Error('GREENROOM_BIN must name the inspected Greenroom CLI');
const leaseId=`kimodo-flame-${process.pid}`;
try{
  // Claim failure stops launch; no inference may run after a refused claim.
  report.leaseClaim=execFileSync(greenroom,['lease','claim','--lease-id',leaseId,'--owner','marionette-gut-splicer','--agent-id','marionette-flame-witness','--repo-root',process.cwd(),'--pid',String(process.pid),'--effective-route',url,'--backend','metal','--device','apple-gpu','--profile','browser-smoke','--supports-checkpoints','--ttl-seconds','900'],{encoding:'utf8'});
  lease=true;report.phase='browser-launch';await persist();
  const {default:puppeteer}=await import(pathToFileURL(path.join(kimodoRoot,'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')));
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-unsafe-webgpu','--use-angle=metal','--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warn')report.console.push({type:msg.type(),text:msg.text()});});
  report.phase='page-load';await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.samples.some(s=>s.active&&s.frameCount>5),{timeout:120000});
  report.phase='weights';await persist();await page.click('#kimodo-load');
  await page.waitForFunction(()=>['loaded','failed'].includes(window.__kimodoLiveFlame?.status),{timeout:600000});
  if(await page.evaluate(()=>window.__kimodoLiveFlame.status)!=='loaded')throw new Error(await page.evaluate(()=>JSON.stringify(window.__kimodoLiveFlame.lastError)));
  report.phase='baseline';await persist();
  await new Promise(r=>setTimeout(r,5000));
  await page.screenshot({path:path.join(output,'baseline.png')});
  await page.$eval('#kimodo-duration',el=>el.value='6');
  await page.$eval('#kimodo-steps',el=>el.value='100');
  report.phase='generation';await persist();await page.click('#kimodo-run');
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.runs.length===1,{timeout:15000});
  // Capture one in-progress frame after sampling begins; preserve terminal even if this fails.
  try{
    await page.waitForFunction(()=>window.__kimodoLiveFlame?.telemetry?.progress?.step>=5,{timeout:120000});
    await page.screenshot({path:path.join(output,'during.png')});
  }catch(error){report.captureError=error.message;}
  await page.waitForFunction(()=>window.__kimodoLiveFlame?.runs[0]?.status!=='running',{timeout:600000});
  report.evidence=await page.evaluate(()=>window.__kimodoLiveFlame);
  report.effectiveUrl=page.url();
  report.status=report.evidence.runs[0].status==='coexistence-observed'&&report.errors.length===0?'passed':'failed';
  report.phase='terminal';await page.screenshot({path:path.join(output,'complete.png')});
  // Exercise actual exported motion via the same download used by the operator.
  const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:path.resolve(output)});
  await page.click('#kimodo-motion-download');await new Promise(r=>setTimeout(r,1000));
}catch(error){report.status='failed';report.failurePhase=report.phase;report.error={message:error.message,stack:error.stack};
  if(browser){const pages=await browser.pages().catch(()=>[]);const page=pages.at(-1);if(page){report.evidence=await page.evaluate(()=>window.__kimodoLiveFlame??null).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}}
}finally{
  clearInterval(interval);
  await browser?.close().catch(error=>report.closeError=error.message);
  if(lease)try{report.leaseRelease=execFileSync(greenroom,['lease','release',leaseId,'--released-by','marionette-gut-splicer','--reason','browser witness terminated'],{encoding:'utf8'});}catch(error){report.leaseReleaseError=error.message;report.status='failed';}
  report.finishedAt=new Date().toISOString();await persist();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,run:report.evidence?.runs?.[0],report:path.join(output,'report.json')},null,2));
process.exitCode=report.status==='passed'?0:1;
