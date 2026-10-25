import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export function assertLivePlacement(s) {
  assert.equal(s.presentation,'live-hand'); assert.equal(s.visible,true); assert.equal(s.running,true);
  assert.ok(s.received>0); assert.equal(s.state.tracking,true);
  assert.equal(s.prediction.hasHand,true); assert.equal(s.prediction.acquisition.source,'wilor_yolo_detector_bbox_only');
  assert.equal(s.prediction.acquisition.fallback,false);
  assert.equal(s.placement.valid,true); assert.equal(s.placement.vertexCount,778); assert.equal(s.placement.jointCount,21);
  assert.equal(s.identity.detector.backend,'webgpu-local'); assert.equal(s.identity.mobrecon.backend,'webgpu-local');
  assert.equal(s.inputSource.kind,'live-camera'); assert.ok(Number.isFinite(s.inputSource.frameId));
}

async function main() {
  const {values:a}=parseArgs({options:Object.fromEntries(['out','chrome','playwright','python','fixture','replay','base'].map(k=>[k,{type:'string'}]))});
  if(!a.out) throw Error('--out required');
  const out=path.resolve(a.out), root=fileURLToPath(new URL('../../',import.meta.url));
  fs.mkdirSync(out,{recursive:true});
  const report={status:'failed',phase:'preflight',root,input:'retained camera recording and native predictions; not operator-live',steps:[],errors:[]};
  const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  save(); let server,context,page,temp;
  try {
    for(const k of ['chrome','playwright','python','fixture','replay']) assert.ok(a[k],`--${k} required`);
    report.executable=fs.realpathSync(a.chrome);
    assert.ok(!report.executable.includes('/Applications/Google Chrome.app/'),'independent test browser required');
    report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    report.dirty=execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'});
    temp=fs.mkdtempSync(path.join(os.tmpdir(),'hand-reach-witness-'));
    let base=a.base;
    if(!base) {
      const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
      for(const dir of ['home','scenes','lerms','stores'])fs.mkdirSync(path.join(temp,dir));
      const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KAMINOS_')));
      const log=fs.openSync(path.join(out,'server.log'),'w');
      server=spawn(a.python,['-u','serve.py',String(port),'--volume-settings-store',path.join(temp,'stores/settings.json'),
        '--no-shared-basin-store','--volume-basin-session-store',path.join(temp,'stores/basins.json'),
        '--volume-cockpit-layout-store',path.join(temp,'stores/layout.json')],{cwd:root,stdio:['ignore',log,log],
        env:{...env,HOME:path.join(temp,'home'),KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:path.join(temp,'scenes'),KAMINOS_LERMS_PREVIEW_ROOT:path.join(temp,'lerms')}});
      fs.closeSync(log);base=`http://127.0.0.1:${port}`;
      for(;;){if(server.exitCode!==null)throw Error('server exited before admission');try{if((await fetch(`${base}/index.html`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    }
    report.base=base; report.phase='browser';save();
    const {chromium}=await import(pathToFileURL(a.playwright));
    context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:report.executable,headless:true,
      viewport:{width:1440,height:1000},args:['--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic','--no-first-run']});
    page=await context.newPage();page.setDefaultTimeout(0);
    page.on('pageerror',e=>report.errors.push(String(e)));
    await page.addInitScript(fixture=>{
      window.__reachWitness={errors:[]};
      const request=GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice=async function(...args){const d=await request.apply(this,args);d.addEventListener('uncapturederror',e=>window.__reachWitness.errors.push(e.error.message));return d;};
      navigator.mediaDevices.getUserMedia=async()=>{
        const video=document.createElement('video');video.muted=true;video.loop=true;video.src=fixture;
        await new Promise((yes,no)=>{video.onloadeddata=yes;video.onerror=()=>no(Error('retained video failed'));video.load();});
        video.currentTime=10;await video.play();window.__reachWitness.video=video;return video.captureStream();
      };
    },a.fixture);
    const invoke=(name,arg)=>page.evaluate(([name,arg])=>window.kaminosWorkbenchExperiments.invoke(name,arg),[name,arg]);
    const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
    const wait=async condition=>page.waitForFunction(async condition=>{
      if(window.__reachWitness.errors.length)throw Error(window.__reachWitness.errors.join('\n'));
      const r=await window.kaminosWorkbenchExperiments?.read();
      if(r?.error)throw Error(r.error);return r && Function('r',`return (${condition})`)(r);
    },condition);
    const capture=async name=>{
      await page.screenshot({path:path.join(out,`${name}.png`)});
      const canvas=page.locator('#viewport canvas').filter({visible:true}).first();
      const file=path.join(out,`${name}-canvas.png`);await canvas.screenshot({path:file});
      const pixels=JSON.parse(execFileSync(a.python,['-c',
        'import json,sys;import numpy as np;from PIL import Image;a=np.asarray(Image.open(sys.argv[1]).convert("RGB"));print(json.dumps(dict(width=a.shape[1],height=a.shape[0],range=int(a.max())-int(a.min()),colored=int(((a.max(2).astype(int)-a.min(2))>30).sum()))))',file],{encoding:'utf8'}));
      assert.ok(pixels.colored>50 && pixels.range>30,'scene must contain colored rendered geometry');
      return {screenshot:`${name}.png`,canvas:`${name}-canvas.png`,pixels};
    };
    const step=async(name,fn)=>{report.phase=name;save();const value=await fn();report.steps.push({name,value});save();return value;};
    report.url=`${base}/index.html?experiment=hand-reach&workspace=workbench`;
    await page.goto(report.url,{waitUntil:'load'});
    await step('open',async()=>{await wait('r.authority === "uncalibrated-hand-reach-experiment"');return read();});
    const replay=JSON.parse(fs.readFileSync(a.replay)), original=replay.frames[1];
    const prediction={...original.prediction,source:{id:original.id,path:replay.source,label:'Retained native right-hand prediction',hashes:original.sourceHashes}};
    await step('retained-right-hand',async()=>{const r=await invoke('presentRetained',prediction);assert.equal(r.visible,true);assert.equal(r.presentation,'replay-hand');return {...r,...await capture('right-hand')};});
    await step('contact-depth',async()=>{
      const tip=(await read()).state.indexTip;
      await invoke('setTarget',{position:tip});await invoke('presentRetained',prediction);
      const contact=await read();assert.equal(contact.state.contact,true);
      const image=await capture('contact');
      await invoke('setTarget',{position:[tip[0],tip[1],tip[2]-.15]});await invoke('presentRetained',prediction);
      const separated=await read();assert.equal(separated.state.contact,false);
      return {contact,separated,...image};
    });
    await step('mobile',async()=>{await page.setViewportSize({width:390,height:844});return {...await capture('mobile'),body:await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))};});
    await page.setViewportSize({width:1440,height:1000});
    await step('actual-inference',async()=>{
      await page.getByRole('button',{name:'Start camera',exact:true}).click();
      await wait('r.received >= 3 && r.visible');const first=await read();assertLivePlacement(first);
      const image=await capture('inference');
      await wait(`r.received >= ${first.received+3} && r.visible`);const later=await read();assertLivePlacement(later);
      assert.notEqual(later.inputSource.frameId,first.inputSource.frameId);
      assert.notDeepEqual(later.state.indexTip,first.state.indexTip);
      return {first,later,...image,laterImage:await capture('inference-later')};
    });
    await step('miss-clears-contact',async()=>{await invoke('setThreshold',1);await wait('r.presentation === "no-hand"');const r=await read();assert.equal(r.visible,false);assert.equal(r.state.grabbed,false);assert.equal(r.state.contact,false);return r;});
    await step('reacquire-stop',async()=>{await invoke('setThreshold',.8);await wait('r.visible');const r=await read();assertLivePlacement(r);await invoke('stop');const stopped=await read();assert.equal(stopped.running,false);assert.equal(stopped.visible,false);assert.equal(stopped.camera,null);return {r,stopped};});
    await step('close-reopen',async()=>{await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('hand-reach'));await wait('r.running === false && r.received === 0');return read();});
    report.errors.push(...await page.evaluate(()=>window.__reachWitness.errors));assert.equal(report.errors.length,0);
    report.status='passed';report.phase=null;
  }catch(error){report.error=String(error.stack);if(page){report.failureState=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.read()).catch(e=>String(e));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}
  finally{
    save();await context?.close();
    if(server && server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
    report.closed=true;save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
    process.exitCode=report.status==='passed'?0:1;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
