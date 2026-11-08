import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';

export function assertAlphaRuntime(expected,actual){
  if(!actual||actual.repoRoot!==expected.repoRoot||actual.branch!==expected.branch||actual.commit!==expected.commit||actual.dirty!==false)throw Error('Effective alpha renderer differs from expected clean source');
}
export function assertAlphaPixels(pixels){
  assert.ok(pixels.foregroundChanged>100,'No visible alpha object relative to its hidden scene');
}

async function main(){
  const [server,output,browseRoot,chrome,puppeteerRoot,...assets]=process.argv.slice(2);
  if(!output)throw Error('Usage: alpha-ladder-witness.mjs SERVER OUT BROWSE_ROOT CHROME PUPPETEER_ROOT ASSET...; --serve as CHROME starts files only');
  fs.mkdirSync(output,{recursive:true});
  const report={ok:false,phase:'source',server,repoRoot:fs.realpathSync(process.cwd()),errors:[],gpuErrors:[],captures:[],claimCeiling:'Saved alpha-only representation comparison; no performance benchmark or fidelity acceptance'};
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  try{if(chrome==='--serve'){
    const log=fs.openSync(path.join(output,'server.log'),'a'),port=new URL(server).port;
    const child=spawn('/usr/bin/python3',['serve.py',port],{cwd:process.cwd(),env:{...process.env,KAMINOS_GENERATED_MESH_DIR:browseRoot},detached:true,stdio:['ignore',log,log]});
    try{await new Promise((resolve,reject)=>child.once('spawn',resolve).once('error',reject));child.unref();}finally{fs.closeSync(log);}
    report.serverPid=child.pid;report.phase='files-only-server';report.browseRoot=browseRoot;report.ok=true;save();console.log(JSON.stringify(report));return;
  }}catch(error){report.error=String(error.stack??error);report.phase='server-start';save();throw error;}
  let browser,page;
  try{
    report.expected={repoRoot:report.repoRoot,branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
    report.actual=(await (await fetch(new URL('/api/runtime-config',server))).json()).source;assertAlphaRuntime(report.expected,report.actual);
    if(chrome.includes('/Applications/Google Chrome.app/'))throw Error('Independent testing browser required');
    const require=createRequire(path.join(puppeteerRoot,'package.json')),puppeteer=require('puppeteer');
    const configurations={grass:{source:'/api/read?root=generated-meshes&path=grass-source%2F',ladder:'/api/read?root=generated-meshes&path=grass-r3%2F',analytical:'/api/read?root=generated-meshes&path=grass-analytical%2F'},kiln:{source:'/api/read?root=generated-meshes&path=kiln%2Fsource%2F',ladder:'/api/read?root=generated-meshes&path=kiln%2Fladder%2F'}};
    report.inputs={assets:Object.fromEntries((assets.length?assets:['grass','kiln']).map(key=>[key,configurations[key]])),asset:assets[0]??'grass',count:4000,mode:'learned'};
    if(Object.values(report.inputs.assets).some(v=>!v))throw Error('Unknown source asset');
    const url=new URL(server);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','trellis-alpha-ladder');url.searchParams.set('experiment_inputs',JSON.stringify(report.inputs));report.url=url.href;
    report.phase='launch';report.profile=fs.mkdtempSync(path.join(output,'profile-'));
    browser=await puppeteer.launch({executablePath:chrome,userDataDir:report.profile,headless:true,protocolTimeout:0,defaultViewport:{width:1100,height:800,deviceScaleFactor:1},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
    report.browserPid=browser.process().pid;save();console.log(`Owned Chrome for Testing PID ${report.browserPid}`);
    page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
    page.on('pageerror',e=>report.errors.push(String(e.stack??e)));
    await page.evaluateOnNewDocument(()=>{window.__alphaGpu={errors:[],adapters:[]};const method=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...args){const i=this.info;window.__alphaGpu.adapters.push({vendor:i.vendor,architecture:i.architecture,isFallbackAdapter:i.isFallbackAdapter});const d=await method.apply(this,args);d.addEventListener('uncapturederror',e=>window.__alphaGpu.errors.push(String(e.error)));return d;};});
    report.phase='load';await page.goto(report.url,{waitUntil:'domcontentloaded'});
    const admission=await page.waitForFunction(()=>{
      if(window.kaminosWorkbenchExperimentError)return {error:window.kaminosWorkbenchExperimentError};
      return document.querySelector('select[aria-label="Alpha representation"]')?.value==='learned';
    },{polling:'mutation'});
    const admitted=await admission.jsonValue();await admission.dispose();if(admitted?.error)throw Error(admitted.error);
    const initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
    assert.equal(initial.asset,report.inputs.asset);assert.equal(initial.mode,'learned');assert.equal(initial.count,4000);
    await new Promise(resolve=>setTimeout(resolve,1500));
    report.adapter=await page.evaluate(()=>window.__alphaGpu.adapters[0]);assert.equal(report.adapter?.vendor,'apple');assert.equal(report.adapter?.isFallbackAdapter,false);
    report.phase='capture';
    for(const asset of Object.keys(report.inputs.assets)){
      await page.evaluate(asset=>window.kaminosWorkbenchExperiments.invoke('show',{asset,count:4000,mode:'learned'}),asset);
      await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('frame'));
      const first=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
      assert.equal(first.asset,asset);
      const object=await page.evaluate(id=>window.kaminosSceneObjectDebugState().find(r=>r.id===id),first.objectId);report[`${asset}Object`]=object;assert.ok(object?.worldBounds);
      const target=object.worldBounds.min.map((v,i)=>(v+object.worldBounds.max[i])/2),span=Math.hypot(...object.worldBounds.min.map((v,i)=>object.worldBounds.max[i]-v));
      for(const [pose,offset]of [['front',[.9,.55,1]],['reverse',[-.9,.55,-1]],['grazing',[1,.08,.15]]]){
        await page.evaluate(({target,position})=>window.__kaminosSetSceneCameraFrame(position,target),{target,position:target.map((v,i)=>v+offset[i]*span)});
        const controls=report.inputs.assets[asset].analytical?[[2000,'existing'],[4000,'existing'],[16000,'existing']]:[];
        for(const [count,mode]of [[2000,'analytic'],[2000,'baked'],[2000,'learned'],[4000,'analytic'],[4000,'baked'],[4000,'learned'],[16000,'analytic'],...controls,[4000,'reference']]){
          if(mode==='analytic'&&count===16000){
            await page.$eval('input[aria-label="Carrier density"]',e=>{e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));});
            await page.waitForFunction(async()=>(await window.kaminosWorkbenchExperiments.read())?.count===16000);
          }else await page.evaluate(value=>window.kaminosWorkbenchExperiments.invoke('show',value),{asset,count,mode});
          const state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(state.mode,mode);assert.equal(state.asset,asset);if(!['reference','existing'].includes(mode))assert.equal(state.count,count);
          await new Promise(resolve=>setTimeout(resolve,450));
          const name=`${asset}-${pose}-${mode}-${state.count}`;
          await page.screenshot({path:path.join(output,`${name}.png`)});
          const pixels=await page.evaluate(async id=>{const settle=async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);};await settle();const source=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0],c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.drawImage(source,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data,png=c.toDataURL('image/png');let foregroundChanged=0;try{window.kaminosSceneVisibility.set(id,false);await settle();ctx.drawImage(source,0,0);const hidden=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-hidden[i])+Math.abs(data[i+1]-hidden[i+1])+Math.abs(data[i+2]-hidden[i+2])>30)foregroundChanged++;}finally{window.kaminosSceneVisibility.set(id,true);await settle();}return {width:c.width,height:c.height,foregroundChanged,png};},state.objectId);
          assertAlphaPixels(pixels);const png=Buffer.from(pixels.png.split(',')[1],'base64');pixels.sha256=crypto.createHash('sha256').update(png).digest('hex');fs.writeFileSync(path.join(output,`${name}-canvas.png`),png);delete pixels.png;
          report.gpuErrors=await page.evaluate(()=>window.__alphaGpu.errors);assert.deepEqual(report.gpuErrors,[]);assert.deepEqual(report.errors,[]);
          report.captures.push({name,asset,pose,count:state.count,mode,state,pixels});save();
        }
      }
    }
    // Leave a cheap new candidate selected, not the dense source draw.
    await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('show',{count:4000,mode:'learned'}));
    report.terminal=(await (await fetch(new URL('/api/runtime-config',server))).json()).source;assertAlphaRuntime(report.expected,report.terminal);
    report.ok=true;report.phase='done';
  }catch(error){report.error=String(error.stack??error);process.exitCode=1;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
  finally{try{await browser?.close();report.browserClosed=true;}finally{save();}}
  console.log(JSON.stringify({ok:report.ok,phase:report.phase,captures:report.captures.length,error:report.error,browserClosed:report.browserClosed}));
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(new URL(import.meta.url)))await main();
