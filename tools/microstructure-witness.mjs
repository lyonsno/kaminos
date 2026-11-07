import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const [server,source,browserPath,puppeteerRoot,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/microstructure-witness.mjs SERVER SOURCE BROWSER PUPPETEER_ROOT OUTPUT');
fs.mkdirSync(output,{recursive:true});
const report={ok:false,phase:'launch',server,source,browserPath,repoRoot:process.cwd(),errors:[],gpuErrors:[],captures:[]};
let browser,page;
try{
  if(browserPath.includes('/Applications/Google Chrome.app/'))throw Error('Independent automation browser required');
  const require=createRequire(path.join(puppeteerRoot,'package.json')),puppeteer=require('puppeteer');
  report.profile=fs.mkdtempSync(path.join(output,'profile-'));
  browser=await puppeteer.launch({executablePath:browserPath,userDataDir:report.profile,headless:true,defaultViewport:{width:1200,height:850,deviceScaleFactor:1},protocolTimeout:0,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
  report.browserPid=browser.process().pid;fs.writeFileSync(path.join(output,'start.json'),JSON.stringify(report,null,2));
  console.log(`Owned Chrome for Testing PID ${report.browserPid}`);
  page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('pageerror',e=>report.errors.push(String(e.stack??e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.evaluateOnNewDocument(()=>{
    window.__microGpuErrors=[];const request=GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice=async function(...args){const d=await request.apply(this,args);d.addEventListener('uncapturederror',e=>window.__microGpuErrors.push(e.error.message??String(e.error)));return d;};
  });
  report.phase='load';const url=new URL(server);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','trellis-microstructure');url.searchParams.set('experiment_inputs',JSON.stringify({source,mode:'fine'}));report.url=url.href;
  await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
  await new Promise(r=>setTimeout(r,2000));
  report.entry=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),body:document.body.innerText.slice(-3000)}));
  report.state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  assert.equal(report.state.sourceSHA256,'666d39062d19c819d9fd1d6546201fa7ff5a0be7515d9db5836eea246409253a');
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return a?.info?{vendor:a.info.vendor,architecture:a.info.architecture,isFallbackAdapter:a.info.isFallbackAdapter}:null;});
  assert.equal(report.adapter?.vendor,'apple');assert.equal(report.adapter?.isFallbackAdapter,false);
  report.phase='render';
  for(const [pose,position]of [['front',null],['reverse',[-.3,.38,-.32]],['grazing',[.36,.24,.07]]]){
    if(position)await page.evaluate(position=>window.__kaminosSetSceneCameraFrame(position,[0,.2,0]),position);
    for(const mode of ['fine','coarse','carrier']){
    if(mode==='coarse')await page.select('select[aria-label="Surface representation"]',mode);
    else await page.evaluate(mode=>window.kaminosWorkbenchExperiments.invoke('mode',mode),mode);
    const state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
    assert.equal(state.mode,mode);
    await new Promise(r=>setTimeout(r,600));
    await page.screenshot({path:path.join(output,pose+'-'+mode+'.png')});
    const pixels=await page.evaluate(async mode=>{
      await new Promise(requestAnimationFrame);
      const source=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      const target=document.createElement('canvas');target.width=source.width;target.height=source.height;const ctx=target.getContext('2d');ctx.drawImage(source,0,0);
      const bytes=ctx.getImageData(0,0,target.width,target.height).data;
      window.__microWitnessPixels??={};window.__microWitnessPixels[mode]=bytes;
      let foreground=0;for(let i=0;i<bytes.length;i+=4)if(Math.max(Math.abs(bytes[i]-bytes[0]),Math.abs(bytes[i+1]-bytes[1]),Math.abs(bytes[i+2]-bytes[2]))>15)foreground++;
      return {width:target.width,height:target.height,foreground,png:target.toDataURL('image/png')};
    },mode);
    assert.ok(pixels.foreground>1000,'Missing visible surface in captured canvas');
    fs.writeFileSync(path.join(output,pose+'-'+mode+'-canvas.png'),Buffer.from(pixels.png.split(',')[1],'base64'));delete pixels.png;
    report.captures.push({pose,mode,state,pixels});
    report.gpuErrors=await page.evaluate(()=>window.__microGpuErrors);
    assert.equal(report.gpuErrors.length,0,report.gpuErrors.join('\n'));
    }
    const compare=await page.evaluate(()=>{
      const compare=(a,b)=>{let squared=0,changed=0,major=0,max=0;for(let i=0;i<a.length;i+=4){let m=0;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);squared+=d*d;max=Math.max(max,d);m=Math.max(m,d);}if(m>0)changed++;if(m>8)major++;}return {rmse:Math.sqrt(squared/(a.length/4*3)),changedPixels:changed,majorPixels:major,max};};
      return {carrier:compare(window.__microWitnessPixels.fine,window.__microWitnessPixels.carrier),coarse:compare(window.__microWitnessPixels.fine,window.__microWitnessPixels.coarse)};
    });
    (report.comparisons??=[]).push({pose,...compare});
    assert.ok(compare.coarse.majorPixels>1000,'Coarse negative control must visibly differ');
    assert.ok(compare.carrier.majorPixels<compare.coarse.majorPixels*.1,'Carrier must preserve fine pixels substantially better than coarse merging');
  }
  report.errors=report.errors.filter(e=>!e.includes('favicon.ico'));assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.phase='complete';report.ok=true;
}catch(error){report.error=String(error.stack??error);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
