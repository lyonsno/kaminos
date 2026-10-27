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

export function assertRuntimeSource(runtime, expectedCommit) {
  assert.equal(typeof expectedCommit,'string','requested revision required');
  assert.ok(expectedCommit.length > 0,'requested revision required');
  assert.equal(runtime.source?.commit,expectedCommit,'served revision must match requested source');
  assert.equal(runtime.source.dirty,false,'served source must not be dirty or unverified');
  assert.ok(typeof runtime.source.repoRoot === 'string' && runtime.source.repoRoot.length > 0,'served root required');
}

export function assertFingerContactResponse(before,after,{minimumImpulse=1e-4}={}) {
  assert.equal(before.backend,'cannon-es-cpu');assert.equal(after.backend,'cannon-es-cpu');
  assert.ok(Array.isArray(before.fingerContactImpulses)&&Array.isArray(after.fingerContactImpulses),'finger normal impulse provenance required');
  const prior=new Map(before.fingerContactImpulses.map(c=>[c.proxy,c.normalImpulse]));
  const contacts=after.fingerContactImpulses.map(c=>({...c,normalImpulse:c.normalImpulse-(prior.get(c.proxy)??0)}));
  assert.ok(contacts.every(c=>c.object==='cube'&&typeof c.finger==='string'&&Number.isFinite(c.normalImpulse)&&c.normalImpulse>=0),'valid finger normal impulse interval required');
  const normalImpulse=contacts.reduce((n,c)=>n+c.normalImpulse,0);
  assert.ok(normalImpulse>minimumImpulse,'meaningful solved finger normal impulse required; gravity/contact rows alone do not qualify');
  assert.equal(after.grabbed,false,'finger response must not use pinch attachment');
  return {normalImpulse,contacts:contacts.filter(c=>c.normalImpulse>0),authority:'simulated-finger-to-cube-normal-impulse'};
}

async function main() {
  const {values:a}=parseArgs({options:Object.fromEntries(['out','chrome','playwright','python','fixture','replay','base','expected-commit'].map(k=>[k,{type:'string'}]))});
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
    report.profile=path.join(temp,'profile');
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
    report.base=base;
    report.runtime=await fetch(`${base}/api/runtime-config`).then(r=>{assert.ok(r.ok,'runtime source must be observable');return r.json();});
    assertRuntimeSource(report.runtime,a['expected-commit']??report.commit);
    report.phase='browser';save();
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
    const wait=async condition=>page.evaluate(async condition=>{
      for(;;) {
        if(window.__reachWitness.errors.length)throw Error(window.__reachWitness.errors.join('\n'));
        const r=await window.kaminosWorkbenchExperiments?.read();
        if(r?.error)throw Error(r.error);
        if(r && Function('r',`return (${condition})`)(r))return;
        await new Promise(requestAnimationFrame);
      }
    },condition);
    const capture=async name=>{
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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
    await step('open',async()=>{
      await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
      await page.evaluate(async()=>{
        const api=window.kaminosWorkbenchExperiments,entry=api.list().find(e=>e.id==='hand-reach');
        if(!entry||entry.error)throw Error(entry?.error??'Hand reach is not in the experiment catalogue');
        if(api.state().id!=='hand-reach')await api.open('hand-reach');
      });
      await wait('r.authority === "uncalibrated-hand-reach-experiment"');return read();
    });
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
    await step('physical-contact',async()=>{
      await invoke('setPhysicsPaused',true);
      await invoke('setCube',{position:[0,.1825,0],size:.045});
      const source={id:'deterministic-open-index-contact',authority:'synthetic-physics-fixture-not-neural-input'};
      await invoke('presentContactFixture',{source,proxies:[{id:'index-tip',finger:'index',position:[-.065,.186,.014],radius:.008}]});
      const before=await read();assert.equal(before.state.backend,'cannon-es-cpu');
      for(let i=0;i<120;i++){
        await invoke('presentContactFixture',{source,proxies:[{id:'index-tip',finger:'index',position:[-.065+i*.00065,.186,.014],radius:.008}]});
        await invoke('advancePhysics',1/120);
      }
      const after=await read();assert.ok(after.state.cubePosition[0]>.01,'open finger must push cube');
      assert.ok(Math.abs(after.state.cubeQuaternion[1])+Math.abs(after.state.cubeQuaternion[2])>.015,'off-centre contact rotates cube');
      assert.equal(after.state.grabbed,false);assert.ok(after.state.contactEvents>0);
      const image=await capture('physical-contact');
      await invoke('setPhysicsPaused',false);
      return {source,before,after,...image};
    });
    await step('actual-inference',async()=>{
      await page.getByRole('button',{name:'Start camera',exact:true}).click();
      await wait('r.received >= 3 && r.visible');const first=await read();assertLivePlacement(first);
      const image=await capture('inference');
      await wait(`r.received >= ${first.received+3} && r.visible`);const later=await read();assertLivePlacement(later);
      assert.notEqual(later.inputSource.frameId,first.inputSource.frameId);
      assert.notDeepEqual(later.state.indexTip,first.state.indexTip);
      return {first,later,...image,laterImage:await capture('inference-later')};
    });
    await step('inferred-hand-contact',async()=>{
      await invoke('setPhysicsPaused',true);
      const before=await read();assertLivePlacement(before);
      const tip=before.state.proxies.find(p=>p.id==='index-3-4/4');assert.ok(tip,'actual inferred index collider required');
      const cubePosition=tip.position.map((v,i)=>v+(i===0?.025:0));
      await invoke('setCube',{position:cubePosition,size:.045});
      const events=before.state.contactEvents;
      for(let i=0;i<30;i++)await invoke('advancePhysics',1/120);
      const after=await read();assertLivePlacement(after);
      assert.ok(after.state.contactEvents>events,'actual inferred hand must generate solver contact');
      const response=assertFingerContactResponse(before.state,after.state);
      assert.equal(after.state.grabbed,false,'actual contact must not use pinch attachment');
      assert.ok(Math.hypot(...after.state.cubePosition.map((v,i)=>v-cubePosition[i]))>.001,'contact exercise moves the dynamic cube');
      const image=await capture('inferred-hand-contact');
      await invoke('setPhysicsPaused',false);
      return {setup:'cube placed beside current inferred index collider; not an autonomous grasp',input:before.inputSource,response,before,after,...image};
    });
    await step('miss-clears-contact',async()=>{await invoke('setThreshold',1);await wait('r.presentation === "no-hand"');const r=await read();assert.equal(r.visible,false);assert.equal(r.state.grabbed,false);assert.equal(r.state.contact,false);return r;});
    await step('reacquire-stop',async()=>{await invoke('setThreshold',.8);await wait('r.visible');const r=await read();assertLivePlacement(r);await invoke('stop');const stopped=await read();assert.equal(stopped.running,false);assert.equal(stopped.visible,false);assert.equal(stopped.camera,null);return {r,stopped};});
    await step('retained-trial',async()=>{
      const exported=await invoke('exportTrial'),trial=JSON.parse(exported.text);
      fs.writeFileSync(path.join(out,'trial.json'),exported.text);
      assert.ok(trial.frames.length>0,'camera inputs and outputs must survive stop');
      const hand=trial.frames.find(row=>row.prediction?.hasHand);
      assert.ok(hand?.prediction.nativeVertices.length===2334,'native geometry retained');
      assert.ok(hand.image.startsWith('data:image/png;base64,'),'exact RGB frame retained as PNG');
      assert.ok(hand.effective.placement.valid,'effective placement retained');
      fs.writeFileSync(path.join(out,'trial-input.png'),Buffer.from(hand.image.split(',')[1],'base64'));
      const reopened=await page.evaluate(async id=>{
        const {readHandReachTrial}=await import('/models/mobrecon/hand-reach-retention.js');
        const r=await readHandReachTrial({id});
        return {id:r.id,status:r.status,frames:r.frames.length,imageBytes:r.frames[0].image.size};
      },trial.id);
      assert.equal(reopened.frames,trial.frames.length);assert.ok(reopened.imageBytes>0);
      return {...reopened,artifact:'trial.json',sourceImage:'trial-input.png'};
    });
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
