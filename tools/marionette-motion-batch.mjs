import fs from 'node:fs/promises';
import {publishMotionView} from './marionette-motion-view.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome,sourceIdentity,startServer} from '../models/flux2-klein/cdp-harness.mjs';

export function validateMotion(raw,joints) {
  if(raw?.route!=='unimate.text-to-motion.webgpu-local.v0'||raw.textEncoder!=='browser T5'||!raw.prompt?.trim()||!Number.isInteger(raw.seed)||!/^[a-f0-9]{64}$/.test(raw.assetCondSha256??''))throw new Error('missing or fallback motion identity');
  if(raw?.status!=='completed'||raw.frames!==60||raw.joints!==joints)throw new Error('incomplete or wrong skeleton');
  if(raw.cooperative!==true||raw.controllerNorm!=='valid-joints')throw new Error('wrong effective route');
  for(const [name,n] of Object.entries({positions:60*joints*3,localRotations:60*joints*4,rootTranslation:180,rootFacing:240,offsets:joints*3,features:60*joints*12}))
    if(!Array.isArray(raw[name])||raw[name].length!==n||!raw[name].every(Number.isFinite))throw new Error(`partial or nonfinite ${name}`);
  if(raw.positions.every(v=>v===0)||raw.offsets.every(v=>v===0))throw new Error('blank skeleton');
  return raw;
}

export async function run({argv=process.argv.slice(2),launch=launchChrome,serve=startServer,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const args=argv, opt=n=>args[args.indexOf(n)+1];
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(opt('--out'));
 await fs.mkdir(output,{recursive:true});
 const bundle=path.resolve(opt('--bundle')),weights=path.resolve(opt('--weights')),t5=path.resolve(opt('--t5'));
 const report={status:'running',phase:'inputs',source:sourceIdentity(root),requestedInputs:{bundle,weights,t5,cases:opt('--cases')},cases:[],requestedBrowser:opt('--chrome'),startedAt:new Date().toISOString()};
 let browser,server;const save=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 const capture=async file=>{const shot=await browser.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(file,Buffer.from(shot.result.data,'base64'));};
 try {
  await save();
  const index=JSON.parse(await fs.readFile(path.join(bundle,'demo.json'),'utf8'));report.bundle=index;
  report.phase='cases-input';await save();
  const cases=JSON.parse(await fs.readFile(opt('--cases'),'utf8'));report.requestedCases=cases;
  report.phase='launch';await save();
  const served=await serve({'/weights/':weights,'/demo/':bundle,'/t5/':t5,'/':root});server=served.server;
  report.pageUrl=served.origin+'/models/unimate/index.html';
  browser=await launch(opt('--chrome'),['--window-size=1280,800'],report,{profileDir:path.join(output,'chrome-profile')});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await browser.navigate(report.pageUrl,'Boolean(window.__unimateDemo)');
  for(;;){const s=await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo))',false);if(s.phase==='ready')break;if(s.phase==='failed')throw new Error(s.error);await pause(500);}
  if(!await browser.evaluate('window.__unimateDemoInstance.hasTextEncoder()'))throw new Error('browser T5 fallback');
  for(let c=0;c<cases.length;c++){
   const task=cases[c],dir=path.join(output,String(c).padStart(2,'0'));await fs.mkdir(dir,{recursive:true});
   report.phase='generate';report.activeCase=task;await save();
   let rawPath=null;
   try {
   await browser.evaluate(`(()=>{window.__marionetteBatch={phase:'running',raw:null,error:null};window.__unimateDemoInstance.generate(${JSON.stringify(task)}).then(r=>{window.__marionetteBatch={phase:'done',raw:{status:'completed',frames:r.motion.frames,joints:r.motion.joints,
    positions:Array.from(r.motion.positions),localRotations:Array.from(r.motion.localRotations),rootTranslation:Array.from(r.motion.rootTranslation),rootFacing:Array.from(r.motion.rootFacing),offsets:Array.from(r.motion.offsets),features:Array.from(r.features),
    prompt:r.prompt,seed:r.seed,textEncoder:r.textEncoder,route:'unimate.text-to-motion.webgpu-local.v0',controllerNorm:'valid-joints',cooperative:r.cooperative,
    cfgScale:r.cfgScale,sampling:r.sampling,wallMs:r.wallMs,frameStats:r.frameStats,evaluations:r.evaluations,dutyCount:r.dutyCount,longestDutyMs:r.longestDutyMs,steps:r.steps},error:null};}).catch(e=>{window.__marionetteBatch.phase='failed';window.__marionetteBatch.error=String(e.stack??e);});return true;})()`,false);
   for(;;){const s=await browser.evaluate('({phase:window.__marionetteBatch.phase,error:window.__marionetteBatch.error})',false);if(s.phase==='done')break;if(s.phase==='failed')throw new Error(s.error);await pause(500);}
   const raw=await browser.evaluate('window.__marionetteBatch.raw');raw.assetCondSha256=index.assetCondSha256;raw.skeleton=index.skeleton;raw.source=report.source;
   rawPath=path.join(dir,'motion.raw.json');await fs.writeFile(rawPath,JSON.stringify(raw));
   validateMotion(raw,index.skeleton.joints);
   if(raw.prompt!==task.text||raw.seed!==task.seed)throw new Error('requested/effective motion mismatch');
   if(raw.cfgScale!==(task.cfgScale??3)||raw.sampling!=='dopri5-valid-joints')throw new Error('requested/effective sampler mismatch');
   await fs.writeFile(path.join(dir,'motion.json'),JSON.stringify(raw));
   for(let f=0;f<12;f++){await capture(path.join(dir,`frame-${String(f).padStart(2,'0')}.png`));await pause(167);}
   report.cases.push({task,validation:'accepted-schema',rawPath,path:path.join(dir,'motion.json'),cfgScale:raw.cfgScale,sampling:raw.sampling,wallMs:raw.wallMs,evaluations:raw.evaluations,frameStats:raw.frameStats});
   }catch(e){
    report.cases.push({task,validation:'rejected',rawPath,error:String(e.stack??e)});
    try{await browser.evaluate('Boolean(window.__unimateDemoInstance)',false);}catch(runtimeError){
      for(const task of cases.slice(c+1))report.cases.push({task,validation:'unattempted',error:String(runtimeError)});
      throw e;
    }
   }
   await save();
  }
  if(report.cases.some(c=>c.validation!=='accepted-schema'))throw new Error('one or more candidates rejected; raw evidence retained');
  report.status='completed';report.phase='complete';delete report.activeCase;
  await save();
  const viewOrigin=args.includes('--view-origin')?opt('--view-origin'):process.env.KAMINOS_VIEW_ORIGIN??null;
  report.view=await publishMotionView({reportPath:path.join(output,'report.json'),origin:viewOrigin});
 }catch(e){report.status='failed';report.error=String(e.stack??e);await save();report.view=await publishMotionView({reportPath:path.join(output,'report.json')});throw e;}
 finally{await browser?.close();server?.close();report.finishedAt=new Date().toISOString();await save();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await run();
