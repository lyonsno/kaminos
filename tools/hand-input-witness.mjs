import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {launchChrome} from '../models/supermat/chrome-cdp.mjs';
import {assertHandObservation} from './hand-input-witness-checks.mjs';
const {values:args}=parseArgs({options:{out:{type:'string'},base:{type:'string'},chrome:{type:'string'},root:{type:'string'},fixture:{type:'string'},infer:{type:'boolean'},page:{type:'string'}}});
if(!args.out)throw Error('--out required');
await fs.mkdir(args.out,{recursive:true});
const report={status:'failed',phase:'setup',requested:args,steps:[],errors:[],browserClosed:false};
const save=()=>fs.writeFile(path.join(args.out,'report.json'),JSON.stringify(report,null,2));
await save();let browser,evaluate,call;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
  for(const key of ['base','chrome','root'])if(!args[key])throw Error('--'+key+' required');
  report.runtime=await fetch(args.base+'/api/runtime-config').then(r=>r.json());
  if(report.runtime.source.repoRoot!==args.root)throw Error('Wrong served checkout');
  let fixture;
  if(args.infer){
    const bytes=await fs.readFile(args.fixture);
    report.input={kind:'retained-camera-still',path:args.fixture,sha256:createHash('sha256').update(bytes).digest('hex'),capture:'repeated static 10Hz fixture; mirrored variant explicitly derived'};
    fixture='data:image/jpeg;base64,'+bytes.toString('base64');
  }
  browser=await launchChrome({chrome:args.chrome,windowSize:'1440,1000'});
  report.browser={executable:browser.executable,version:browser.version.product,pid:browser.child.pid};
  const {targetId}=await browser.cdp.call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.cdp.call('Target.attachToTarget',{targetId,flatten:true});
  call=(method,params)=>browser.cdp.call(method,params,sessionId);
  await call('Page.enable');await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__handsWitness={errors:[],tracks:[],mirror:false,blank:false};
    addEventListener('error',e=>__handsWitness.errors.push(e.message));
    addEventListener('unhandledrejection',e=>__handsWitness.errors.push(String(e.reason)));
    const requestDevice=GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice=async function(...args){const d=await requestDevice.apply(this,args);d.addEventListener('uncapturederror',e=>__handsWitness.errors.push(e.error.message));return d;};
    if(${!!args.infer})navigator.mediaDevices.getUserMedia=async()=>{
      const img=new Image();img.src=${JSON.stringify(fixture??'')};await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');const draw=()=>{ctx.save();ctx.fillStyle='#777';ctx.fillRect(0,0,canvas.width,canvas.height);if(!__handsWitness.blank){if(__handsWitness.mirror){ctx.translate(canvas.width,0);ctx.scale(-1,1);}ctx.drawImage(img,0,0);}ctx.restore();};
      draw();const timer=setInterval(draw,100);const stream=canvas.captureStream(10);
      for(const track of stream.getTracks()){__handsWitness.tracks.push(track);const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}return stream;
    };`});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{while(!await evaluate(expression)){const errors=await evaluate('__handsWitness.errors');if(errors.length)throw Error(errors.join('\n'));await sleep(100);}};
  const shot=async name=>{const {data}=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(args.out,name+'.png'),Buffer.from(data,'base64'));};
  report.phase='page';await save();
  report.url=args.base+(args.page??'/?workspace=workbench');await call('Page.navigate',{url:report.url});
  await wait('!!window.kaminosHands');
  await sleep(500);
  await evaluate('kaminosHands.openSettings()');await shot('controls-off');
  const bounds=await evaluate(`(()=>{const r=document.querySelector('.hand-input-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
  if(bounds.left<0||bounds.right>bounds.width||bounds.bottom>bounds.height)throw Error('Hand controls clip the viewport');
  if(await evaluate('kaminosHands.read().enabled'))throw Error('Hand input started without activation');
  if(args.infer){
    for(const model of ['spiralconv','dsconv','wilor']){
      report.phase=model;await save();
      await evaluate(`kaminosHands.setModel(${JSON.stringify(model)})`);
      if(!await evaluate('kaminosHands.read().enabled'))await evaluate('kaminosHands.setEnabled(true)');
      await wait(`kaminosHands.read().phase==='error'||kaminosHands.read().last?.hands.some(h=>h.handedness==='right')`);
      const row=await evaluate(`({state:kaminosHands.read(),view:kaminosHands.visualization()})`);Object.assign(row,{model,side:'right'});assertHandObservation(row);
      report.steps.push(row);await shot(model+'-right');await save();
    }
    report.phase='left-auto';await save();
    await evaluate(`kaminosHands.setAuto('right',false)`);await evaluate('__handsWitness.mirror=true');
    await wait(`kaminosHands.read().phase==='error'||kaminosHands.read().last?.hands.some(h=>h.handedness==='left')`);
    const left=await evaluate('({state:kaminosHands.read(),view:kaminosHands.visualization()})');Object.assign(left,{model:'wilor',side:'left'});assertHandObservation(left);report.steps.push(left);await shot('left');
    report.phase='absence';await evaluate('__handsWitness.blank=true');
    await wait(`kaminosHands.read().last?.hands.length===0||kaminosHands.read().phase==='error'`);
    const absent=await evaluate('({state:kaminosHands.read(),view:kaminosHands.visualization()})');
    if(absent.state.phase==='error'||absent.view.visible)throw Error('Detector miss failed to clear the virtual hand');
    report.steps.push({absence:absent});
    await evaluate('kaminosHands.setEnabled(false)');
    if(await evaluate('__handsWitness.tracks.some(t=>t.readyState!=="ended")'))throw Error('Camera tracks survived Stop');
    if(await evaluate('kaminosHands.visualization().visible'))throw Error('Stopped hand remains visible');
  }
  report.phase='mobile';await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await shot('mobile');
  const mobile=await evaluate(`(()=>{const r=document.querySelector('.hand-input-popover').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom};})()`);
  if(mobile.left<0||mobile.right>390||mobile.bottom>844)throw Error('Mobile hand popover clips');
  report.errors=await evaluate('__handsWitness.errors');
  if(report.errors.length)throw Error(report.errors.join('\n'));
  report.status='passed';report.phase='complete';
}catch(error){report.error=String(error.stack??error);}
finally{
  if(evaluate){try{await evaluate('window.kaminosHands?.setEnabled(false)');}catch{}}
  if(browser){await browser.close();report.browserClosed=browser.child.exitCode!==null||browser.child.signalCode!==null;}
  await save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,out:args.out,error:report.error}));
if(report.status!=='passed')process.exitCode=1;
