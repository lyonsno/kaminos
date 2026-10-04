import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [url, out, executablePath] = process.argv.slice(2);
const live = process.argv[5] === 'live';
if (!url || !out || !executablePath) throw new Error('Usage: node kiln-cinematic-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_BROWSER');
await fs.mkdir(out, {recursive:true});
const report = {url, executablePath, mode:live?'live':'preview', status:'running', phase:'launch', errors:[], frames:[]};
let browser, page;
async function pixels() {
  return page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
    const source=document.getElementById('kaminos-host-renderer-canvas');
    if(!source) return resolve({nonblack:0,missing:true});
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let nonblack=0;for(let i=0;i<data.length;i+=4)if(data[i+3] && data[i]+data[i+1]+data[i+2]>0)nonblack++;
    resolve({width:canvas.width,height:canvas.height,nonblack});
  })));
}
try {
  if (!/Chrome for Testing|chromium|headless_shell/i.test(executablePath)) throw new Error('An independent browser is required');
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '/Users/noahlyons/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  browser = await chromium.launch({executablePath,headless:true});
  report.browserVersion = browser.version();
  page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('response', response=>{if(response.status()>=400)report.errors.push(`${response.status()} ${response.url()}`);});
  page.on('requestfailed', request=>report.errors.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => {if(['warning','error'].includes(message.type()))report.errors.push(message.text());});
  report.phase='load';
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosCinematic?.state().armed && window.kaminosSceneObjectDebugState?.().some(row=>row.id==='kiln') && window.__kaminosVolumePrototype?.debugState().frameCount > 15);
  report.effectiveUrl=page.url();
  report.before = await page.evaluate(()=>({route:window.__kaminosCompositionSetup,objects:window.kaminosSceneObjectDebugState(),camera:window.kaminosCameraDebugState(),cues:window.kaminosCinematic.read()}));
  assert.equal(report.before.route.status,'mounted');
  assert.match(report.effectiveUrl,/kiln-cinematic/);
  await page.screenshot({path:path.join(out,'before.png')});
  if (live) {
    report.phase='live-inference';
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    const inference=page.evaluate(()=>window.kaminosCinematic.fire());
    await page.waitForFunction(()=>['work','extinguish','failed'].includes(window.kaminosCinematic.state().phase),null,{timeout:0});
    await page.screenshot({path:path.join(out,'live-work.png')});
    await inference;
    report.live=await page.evaluate(()=>{
      const result=window.__sf3dLiveFlame?.lastResult;
      if (!result) return {error:window.__sf3dLiveFlame?.lastError,cinematic:window.kaminosCinematic.state()};
      const {glb,...receipt}=result;return receipt;
    });
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    assert.equal(report.live.presentation?.status,'registered',JSON.stringify(report.live.error));
    assert.equal(report.live.deviceTopology,'same-device');
    assert.ok(report.live.framesDuringInference>0);
    await page.waitForFunction(()=>['complete','failed'].includes(window.kaminosCinematic.state().phase),null,{timeout:0});
    report.final=await page.evaluate(()=>window.kaminosCinematic.state());
    assert.equal(report.final.phase,'complete');
    assert.equal(report.final.effective.sourceEnabled,false);
    assert.equal(report.final.effective.outputVisible,true);
    report.desktopPixels=await pixels();assert.ok(report.desktopPixels.nonblack>0);
    await page.screenshot({path:path.join(out,'live-reveal.png')});
  } else {
  report.phase='preview';
  await page.click('#kiln-preview');
  for (let i=0;i<10;i++) {
    await page.waitForTimeout(2500);
    const state = await page.evaluate(()=>({cinematic:window.kaminosCinematic.state(),frameCount:window.__kaminosVolumePrototype.debugState().frameCount}));
    const file=`frame-${String(i).padStart(2,'0')}.png`;
    await page.screenshot({path:path.join(out,file)});
    report.frames.push({file,...state});
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    assert.equal(state.cinematic.failure,null);
  }
  assert.ok(report.frames.some(row=>row.cinematic.phase==='complete'),'preview must finish');
  assert.ok(report.frames.at(-1).cinematic.effective.outputVisible,'completed output is visible');
  assert.equal(report.frames.at(-1).cinematic.effective.sourceEnabled,false);
  assert.ok(report.frames.at(-1).frameCount > report.frames[0].frameCount,'simulation advances');
  report.desktopPixels=await pixels();assert.ok(report.desktopPixels.nonblack>0);
  report.phase='restore';
  await page.click('#kiln-edit');
  report.after = await page.evaluate(()=>({camera:window.kaminosCameraDebugState(),cues:window.kaminosCinematic.read()}));
  await page.screenshot({path:path.join(out,'editor.png')});
  report.phase='save-reopen';
  const radius=page.getByLabel('work 2 radius');
  await radius.click();await radius.fill('0.3');await radius.press('Enter');
  report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));
  assert.equal(report.saved.ok,true,report.saved.error);
  const documentResponse=await fetch(`${new URL(url).origin}/api/read?root=scenes&path=${encodeURIComponent(report.saved.filename)}`);
  assert.equal(documentResponse.ok,true);
  report.savedDocument=await documentResponse.json();
  assert.equal(report.savedDocument.cinematic.work[1].radius,0.3);
  const reopen=new URL(url);const hash=new URLSearchParams(reopen.hash.slice(1));hash.set('scene',report.saved.filename);reopen.hash=hash.toString();
  await page.goto(reopen.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosCinematic?.state().armed && window.kaminosCinematic.read()?.work[1].radius===0.3 && window.__kaminosVolumePrototype?.debugState().frameCount>15);
  report.reopened=await page.evaluate(()=>({cues:window.kaminosCinematic.read(),objects:window.kaminosSceneObjectDebugState(),camera:window.kaminosCameraDebugState()}));
  assert.deepEqual(report.reopened.cues,report.savedDocument.cinematic);
  for(let i=0;i<3;i++)assert.ok(Math.abs(report.reopened.camera.position[i]-report.savedDocument.camera.position[i])<1e-8,'cinema arms only after the saved camera is restored');
  report.phase='mobile';
  await page.setViewportSize({width:390,height:844});
  await page.click('#kiln-preview');
  await page.waitForFunction(()=>window.kaminosCinematic.state().phase==='work');
  await page.screenshot({path:path.join(out,'mobile-work.png')});
  report.mobilePixels=await pixels();assert.ok(report.mobilePixels.nonblack>0);
  await page.waitForFunction(()=>window.kaminosCinematic.state().phase==='complete');
  await page.screenshot({path:path.join(out,'mobile-complete.png')});
  report.phase='repeat';
  await page.click('#kiln-preview');
  await page.waitForFunction(()=>window.kaminosCinematic.state().phase==='work');
  await page.click('#kiln-stop');
  assert.equal(await page.evaluate(()=>window.kaminosCinematic.state().phase),'idle');
  await page.click('#kiln-authoring');
  await page.screenshot({path:path.join(out,'authoring-mobile.png')});
  }
  assert.deepEqual(report.errors,[],'browser errors cannot close as a pass');
  report.status='passed';report.phase='complete';
} catch(error) {
  report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;
  if(page){
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    report.lastState=await page.evaluate(()=>({url:location.href,text:document.body.innerText,composition:window.__kaminosCompositionSetup,fire:window.__kaminosVolumePrototype?.debugState(),cinematic:window.kaminosCinematic?.state()})).catch(()=>null);
  }
} finally {if(browser)await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,out}));
