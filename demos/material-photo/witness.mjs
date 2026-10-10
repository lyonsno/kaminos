import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { launchChrome, openPage } from '../../models/supermat/chrome-cdp.mjs';
import { validateEpisode } from './witness-checks.js';

const {values}=parseArgs({options:Object.fromEntries(['repo-root','expected-commit','chrome','output','port'].map(key=>[key,{type:'string'}]))});
const output=path.resolve(values.output??'material-photo-witness');
const report={status:'failed',phase:'arguments',requested:values,episodes:[],errors:[],command:process.argv};
let browser,server;
const persist=async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');};
const stopServer=async()=>{if(server&&server.exitCode===null){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await ended;}};
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{report.error=`Interrupted ${signal}`;await browser?.close();await stopServer();await persist();process.exit(1);});
try{
  await persist();
  for(const key of ['repo-root','expected-commit','chrome','output'])if(!values[key])throw Error(`--${key} required`);
  const root=await fs.realpath(values['repo-root']);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  report.source={root,commit:git(['rev-parse','HEAD'])};
  if(report.source.commit!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo','scene-gi.mjs','lib','models/supermat','webgpu-inference-kit/src']))throw Error('Exact clean source required');
  const port=Number(values.port??18741),base=`http://127.0.0.1:${port}`;
  report.phase='server';await persist();
  server=spawn('/usr/bin/python3',['-u','serve.py',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
  let serverText='';server.stdout.on('data',b=>{serverText+=b;});server.stderr.on('data',b=>{serverText+=b;});
  for(;;){if(server.exitCode!==null)throw Error(`Server exited: ${serverText}`);
    try{const response=await fetch(`${base}/demos/material-photo/index.html`);if(response.ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));}
  const served=await(await fetch(`${base}/demos/material-photo/main.js`)).text();
  if(served!==await fs.readFile(path.join(root,'demos/material-photo/main.js'),'utf8'))throw Error('Wrong served checkout');
  report.phase='browser';await persist();
  browser=await launchChrome({chrome:values.chrome,windowSize:'1440,1000'});
  report.browser={executable:browser.executable,product:browser.version.product,pid:browser.child.pid};
  const sessionId=await openPage(browser.cdp,`${base}/demos/material-photo/index.html`);
  const evaluate=async(expression)=>{
    const response=await browser.cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;
  };
  const capture=async(name)=>{const shot=await browser.cdp.call('Page.captureScreenshot',{format:'png'},sessionId);const file=path.join(output,`${name}.png`);await fs.writeFile(file,Buffer.from(shot.data,'base64'));return file;};
  await browser.cdp.call('Runtime.enable',{},sessionId);
  for(const [key,label]of [['celebration','Celebration'],['bag','Backpack'],['orb','Metal & glow']]){
    report.phase=`inference-${key}`;await persist();
    await evaluate(`window.__materialPhotoActions.sample(${JSON.stringify(key)})`);
    const bytes=await fs.readFile(path.join(root,`demos/material-photo/images/${({celebration:'celebration.png',bag:'bag.webp',orb:'evil-orb.png'})[key]}`));
    const episode={source:label,inputSha256:createHash('sha256').update(bytes).digest('hex')};
    report.episodes.push(episode);await persist();
    await evaluate('window.__materialPhotoActions.infer()');
    episode.state=await evaluate('window.__materialPhoto');
    validateEpisode(episode.state,label);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.materials=await capture(`${key}-materials`);
    const clip=await evaluate("(()=>{const c=document.getElementById('scene');if(c.hidden)throw Error('Surface canvas hidden');const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
    const frame=await browser.cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true},sessionId);
    episode.canvasFrame=path.join(output,`${key}-canvas.png`);
    await fs.writeFile(episode.canvasFrame,Buffer.from(frame.data,'base64'));
    episode.pixels=await evaluate(`window.__materialPhotoActions.pixels(${JSON.stringify('data:image/png;base64,'+frame.data)})`);
    if(!(episode.pixels.range>12&&episode.pixels.nonBackground>1000))throw Error('Blank surface canvas');
    await evaluate("document.getElementById('light').value=80;document.getElementById('light').dispatchEvent(new Event('input'))");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.otherLight=await capture(`${key}-other-light`);
    await evaluate("window.__materialPhotoActions.view('original')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.original=await capture(`${key}-original`);
    for(const role of ['albedo','roughness','metallic']){
      await evaluate(`window.__materialPhotoActions.view('materials');document.getElementById('map').value=${JSON.stringify(role)};document.getElementById('map').dispatchEvent(new Event('change'))`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      episode[role]=await capture(`${key}-${role}`);
    }
    await browser.cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
    await evaluate("document.getElementById('map').value='surface';document.getElementById('map').dispatchEvent(new Event('change'))");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.mobile=await capture(`${key}-mobile`);
    episode.overflow=await evaluate('document.documentElement.scrollWidth>innerWidth');
    if(episode.overflow)throw Error('Mobile horizontal overflow');
    await browser.cdp.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    await persist();
  }
  if(git(['rev-parse','HEAD'])!==report.source.commit)throw Error('Source moved during witness');
  report.phase='complete';report.status='passed';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser?.close();await stopServer();await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error??null,report:path.join(output,'report.json')}));}
