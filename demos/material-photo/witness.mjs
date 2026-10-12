import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { launchChrome, openPage } from '../../models/supermat/chrome-cdp.mjs';
import { validateEpisode, captureSurfaceFrame, validateComparison, validateContrastArms,validateEffectsPresentation,validateCachedRestoration } from './witness-checks.js';
import { readRawEvidence } from './witness-raw.mjs';

const {values}=parseArgs({options:{...Object.fromEntries(['repo-root','expected-commit','chrome','output','port','samples','sizes'].map(key=>[key,{type:'string'}])),contrast:{type:'boolean'},effects:{type:'boolean'},cache:{type:'boolean'}}});
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
  if(report.source.commit!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo','assets/hdr','finger-fluid-webgpu-core.js','scene-gi.mjs','scene-gi-settings.mjs','lib','models/supermat','webgpu-inference-kit/src']))throw Error('Exact clean source required');
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
  browser=await launchChrome({chrome:values.chrome,windowSize:'1440,1000',onExit:event=>{report.browserExit=event;}});
  report.browser={executable:browser.executable,product:browser.version.product,pid:browser.child.pid};
  browser.child.stderr.on('data',bytes=>{report.browserStderr=(report.browserStderr??'')+bytes.toString();});
  const sessionId=await openPage(browser.cdp,`${base}/demos/material-photo/index.html`);
  const evaluate=async(expression)=>{
    const response=await browser.cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;
  };
  const capture=async(name)=>{const shot=await browser.cdp.call('Page.captureScreenshot',{format:'png'},sessionId);const file=path.join(output,`${name}.png`);await fs.writeFile(file,Buffer.from(shot.data,'base64'));return file;};
  const click=async(selector)=>{
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('Click target hidden');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},sessionId);
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},sessionId);
  };
  await browser.cdp.call('Runtime.enable',{},sessionId);
  await evaluate("window.__materialPhotoWitnessErrors=[];addEventListener('error',e=>window.__materialPhotoWitnessErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__materialPhotoWitnessErrors.push(String(e.reason)))");
  const samples=(values.samples??'celebration,bag,orb').split(','),sizes=(values.sizes??'512').split(',').map(Number);
  if(!samples.length||samples.some(key=>!['celebration','bag','orb'].includes(key))||!sizes.length||sizes.some(size=>![512,768,1024].includes(size)))throw Error('Invalid samples or sizes');
  if(values.cache&&!sizes.includes(512))throw Error('Cache reload exercise requires the default 512 resolution');
  report.plan={samples,sizes};
  let baselinePreset;
  for(const [sampleKey,label]of [['celebration','Celebration'],['bag','Backpack'],['orb','Metal & glow']].filter(([key])=>samples.includes(key)))for(const size of sizes){
    const key=`${sampleKey}-${size}`;
    report.phase=`inference-${key}`;await persist();
    if(baselinePreset&&!await evaluate(`window.__materialPhotoActions.importPreset(${JSON.stringify(baselinePreset)})`))throw Error('Baseline preset rejected');
    await evaluate(`(async()=>{await window.__materialPhotoActions.sample(${JSON.stringify(sampleKey)});document.getElementById('material-size').value=${JSON.stringify(String(size))}})()`);
    const bytes=await fs.readFile(path.join(root,`demos/material-photo/images/${({celebration:'celebration.png',bag:'bag.webp',orb:'evil-orb.png'})[sampleKey]}`));
    const episode={source:label,requestedSize:size,inputSha256:createHash('sha256').update(bytes).digest('hex')};
    report.episodes.push(episode);await persist();
    await evaluate('window.__materialPhotoActions.infer()');
    episode.state=await evaluate('window.__materialPhoto');
    validateEpisode(episode.state,label,size);
    baselinePreset??=await evaluate('window.__materialPhotoActions.exportPreset()');
    episode.defaultPreset=await evaluate('window.__materialPhotoActions.exportPreset()');
    const settle=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate("document.getElementById('glow').checked=false;document.getElementById('glow').dispatchEvent(new Event('change'))");
    await settle();
    if(values.effects||values.contrast||values.cache){
      episode.rawEvidence={};
      for(const name of ['image','albedo','roughness','metallic','orm','plane-albedo','plane-orm']){
        const raw=await readRawEvidence(evaluate,name),file=path.join(output,`${key}-${name}.raw`);
        await fs.writeFile(file,raw.bytes);episode.rawEvidence[name]={width:raw.width,height:raw.height,type:raw.type,byteLength:raw.byteLength,file,sha256:createHash('sha256').update(raw.bytes).digest('hex')};
        await persist();
      }
    }
    if(values.effects){
      report.phase=`effects-${key}`;await persist();
      const identity=episode.state.identity.supermat;
      if(identity.activations!=='f16'||identity.fuseNorm!==true||identity.gemmPrecision!=='f16-tiles')throw Error('Expected product profile did not execute');
      await evaluate("window.__materialPhotoActions.view('materials');document.getElementById('glow').checked=true;document.getElementById('glow').dispatchEvent(new Event('change'))");
      await settle();
      const baseline=await evaluate('window.__materialPhotoActions.presentation()');
      episode.effects={};
      for(const [name,changes]of Object.entries({reflection:{bloom:false,emissionReflection:1},emitter:{bloom:false,emissionReflection:0},
        bloom:{bloom:true,emissionReflection:0,bloomIntensity:1.5,glowIntensity:4},
        'wide-bloom':{bloom:true,emissionReflection:0,bloomIntensity:1.5,bloomRadius:.9,glowIntensity:4},
        cutoff:{bloom:true,emissionReflection:0,glowThreshold:1,glowIntensity:4},
        'high-threshold':{bloom:true,emissionReflection:0,bloomThreshold:10,glowIntensity:4}})){
        const requested={...baseline.effects,...changes};
        await evaluate(`window.__materialPhotoActions.setEffects(${JSON.stringify(requested)})`);await settle();
        const presentation=await evaluate('window.__materialPhotoActions.presentation()');
        validateEffectsPresentation(presentation,requested,baseline.physicalbaseline.activeMaterial);
        const clip=await evaluate("(()=>{const r=document.querySelector('[data-canvas=materials]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
        const shot=await captureSurfaceFrame(evaluate,()=>browser.cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true},sessionId));
        const frame=path.join(output,`${key}-effects-${name}.png`);await fs.writeFile(frame,Buffer.from(shot.data,'base64'));
        episode.effects[name]={requested,presentation,frame};await persist();
      }
      await evaluate(`window.__materialPhotoActions.setEffects(${JSON.stringify(baseline.effects)});window.__materialPhotoActions.compare();document.getElementById('glow').checked=false;document.getElementById('glow').dispatchEvent(new Event('change'))`);
      await settle();
      episode.receivedDiagnostics={};
      for(const mode of ['relit','materials']){
        await evaluate(`window.__materialPhotoActions.view(${JSON.stringify(mode)});document.getElementById('gi-view').value='gi';document.getElementById('gi-view').dispatchEvent(new Event('change'))`);await settle();
        const presentation=await evaluate('window.__materialPhotoActions.presentation()');
        if(presentation.mode!==mode||presentation.gi.view!=='gi')throw Error('Wrong received-light diagnostic');
        episode.receivedDiagnostics[mode]={presentation,frame:await capture(`${key}-received-${mode}`)};
      }
      await evaluate("document.getElementById('gi-view').value='scene';document.getElementById('gi-view').dispatchEvent(new Event('change'));window.__materialPhotoActions.compare()");await settle();
    }
    if(values.contrast){
      report.phase=`contrast-${key}`;await persist();
      await evaluate("window.__materialPhotoActions.view('materials')");await settle();
      const light=await evaluate('window.__materialPhotoActions.presentation().light');
      episode.contrast={};
      for(const mode of ['original','manual','highlight']){
        const settings={mode,roughness:.5,metallic:.5};
        await evaluate(`window.__materialPhotoActions.setMaterialContrast(${JSON.stringify(settings)})`);await settle();
        const effective=await evaluate('window.__materialPhotoActions.presentation()');
        if(JSON.stringify(effective.contrast.settings)!==JSON.stringify(settings))throw Error('Contrast silently replaced requested settings');
        if(effective.mode!=='materials'||effective.map!=='surface')throw Error('Contrast captured the wrong presentation');
        episode.contrast[mode]={presentation:effective,frame:await capture(`${key}-contrast-${mode}`)};
        await evaluate('window.__materialPhotoActions.setLightHandle(.7,.25)');await settle();
        episode.contrast[mode].otherLight={presentation:await evaluate('window.__materialPhotoActions.presentation()'),frame:await capture(`${key}-contrast-${mode}-other-light`)};
        await evaluate(`window.__materialPhotoActions.setLightHandle(${light.x},${light.y})`);await settle();
        for(const role of ['roughness','metallic']){
          await evaluate(`document.getElementById('map').value=${JSON.stringify(role)};document.getElementById('map').dispatchEvent(new Event('change'))`);await settle();
          episode.contrast[mode][role]=await capture(`${key}-contrast-${mode}-${role}`);
        }
        await evaluate("window.__materialPhotoActions.view('materials')");
      }
      validateContrastArms(episode.contrast);
      validateContrastArms(Object.fromEntries(Object.entries(episode.contrast).map(([mode,arm])=>[mode,arm.otherLight])));
      await evaluate("window.__materialPhotoActions.setMaterialContrast({mode:'original'});window.__materialPhotoActions.compare()");
      episode.diagnostics={};
      for(const diagnostic of ['incoming','gi','ao']){
        await evaluate(`document.getElementById('gi-view').value=${JSON.stringify(diagnostic)};document.getElementById('gi-view').dispatchEvent(new Event('change'))`);await settle();
        const effective=await evaluate('window.__materialPhotoActions.presentation()');
        if(effective.gi.view!==diagnostic||effective.map!=='surface'||!effective.gi.enabled)throw Error('GI diagnostic did not reach surface');
        episode.diagnostics[diagnostic]={presentation:effective,frame:await capture(`${key}-diagnostic-${diagnostic}`)};
      }
      await evaluate("document.getElementById('gi-view').value='scene';document.getElementById('gi-view').dispatchEvent(new Event('change'))");
      await settle();await persist();
    }
    episode.comparison=await evaluate('window.__materialPhotoActions.presentation().comparison');
    if(!episode.comparison.enabled)throw Error('Four-view comparison is not the default');
    validateComparison(episode.comparison.views);
    episode.grid=await capture(`${key}-comparison`);
    episode.gridPixels={};
    for(const mode of ['original','photo','relit','materials']){
      const clip=await evaluate(`(()=>{const r=document.querySelector('[data-canvas=${mode}]').getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('Comparison view hidden');return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
      const frame=await browser.cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true},sessionId);
      await fs.writeFile(path.join(output,`${key}-grid-${mode}.png`),Buffer.from(frame.data,'base64'));
      episode.gridPixels[mode]=await evaluate(`window.__materialPhotoActions.pixels(${JSON.stringify('data:image/png;base64,'+frame.data)})`);
      if(episode.gridPixels[mode].range<12||episode.gridPixels[mode].nonBackground<1000)throw Error(`Blank comparison view: ${mode}`);
    }
    await evaluate("document.getElementById('glow').checked=false;document.getElementById('glow').dispatchEvent(new Event('change'))");
    await evaluate("document.getElementById('scene').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
    episode.views={};
    for(const mode of ['original','photo','relit','materials']) {
      await evaluate('window.__materialPhotoActions.compare()');await settle();
      await click(`[data-focus=${mode}]`);await settle();
      if(await evaluate('window.__materialPhotoActions.presentation().mode')!==mode)throw Error(`Physical focus click failed: ${mode}`);
      const visible=await evaluate("[...document.querySelectorAll('[data-tile]')].filter(tile=>!tile.hidden).map(tile=>tile.dataset.tile)");
      if(visible.length!==1||visible[0]!==mode)throw Error(`Focused view left other panes visible: ${mode}`);
      episode.views[mode]=await evaluate('window.__materialPhotoActions.presentation()');
      episode[mode]=await capture(`${key}-${mode}`);
    }
    validateComparison(episode.views);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.materials=await capture(`${key}-materials`);
    const clip=await evaluate("(()=>{const c=document.getElementById('scene');if(c.hidden)throw Error('Surface canvas hidden');const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
    const frame=await captureSurfaceFrame(evaluate,()=>browser.cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true},sessionId));
    episode.canvasFrame=path.join(output,`${key}-canvas.png`);
    await fs.writeFile(episode.canvasFrame,Buffer.from(frame.data,'base64'));
    episode.pixels=await evaluate(`window.__materialPhotoActions.pixels(${JSON.stringify('data:image/png;base64,'+frame.data)})`);
    if(!(episode.pixels.range>12&&episode.pixels.nonBackground>1000))throw Error('Blank surface canvas');
    report.phase=`interaction-${key}`;await persist();
    const before=await evaluate('window.__materialPhotoActions.presentation()');
    const sun=await evaluate("(()=>{const r=document.getElementById('sun').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...sun},sessionId);
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...sun,button:'left',clickCount:1},sessionId);
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:sun.x+90,y:sun.y+35,button:'left',buttons:1},sessionId);
    await browser.cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:sun.x+90,y:sun.y+35,button:'left',clickCount:1},sessionId);
    await settle();
    episode.movedLight=await evaluate('window.__materialPhotoActions.presentation()');
    if(JSON.stringify(before.light.position)===JSON.stringify(episode.movedLight.light.position))throw Error('Dragging light did not move effective directional light');
    if(JSON.stringify(before.camera.orbit)!==JSON.stringify(episode.movedLight.camera.orbit))throw Error('Light drag rotated the camera');
    episode.otherLight=await capture(`${key}-other-light`);
    episode.preset=await evaluate("(()=>{const p=window.__materialPhotoActions.exportPreset();p.settings.slices=8;p.settings.steps=24;p.settings.expFactor=3;p.settings.depthPhi=.02;return p})()");
    if(!await evaluate(`window.__materialPhotoActions.importPreset(${JSON.stringify(episode.preset)})`))throw Error('Valid tuning preset rejected');
    episode.effectivePreset=await evaluate('window.__materialPhotoActions.exportPreset()');
    if(JSON.stringify(episode.preset)!==JSON.stringify(episode.effectivePreset))throw Error('Tuning preset did not round trip');
    const invalid=structuredClone(episode.preset);invalid.settings.steps=0;
    if(await evaluate(`window.__materialPhotoActions.importPreset(${JSON.stringify(invalid)})`))throw Error('Invalid tuning preset admitted');
    if(JSON.stringify(episode.effectivePreset)!==JSON.stringify(await evaluate('window.__materialPhotoActions.exportPreset()')))throw Error('Invalid preset changed live state');
    await settle();episode.tuned=await capture(`${key}-tuned`);
    const tuning=await evaluate('window.__materialPhotoActions.presentation()');
    if(tuning.gi.debugState.estimator.expFactor!==3||tuning.gi.debugState.estimator.depthPhi!==.02||tuning.gi.settings.steps!==24)throw Error('Underlying estimator did not receive tuning');
    await evaluate("document.getElementById('glow').checked=true;document.getElementById('glow').dispatchEvent(new Event('change'))");await settle();
    episode.glowState=await evaluate('window.__materialPhotoActions.presentation()');
    if(episode.glowState.emissiveIntensity!==1)throw Error('Glow did not reach material emission');
    if(sampleKey==='orb'&&!(episode.glowState.emissionStats?.nonzero>0))throw Error('Orb emission extraction is empty');
    episode.glow=await capture(`${key}-glow`);
    episode.environments={};
    for(const name of ['studio','warehouse','sunset']){
      if(!await evaluate(`window.__materialPhotoActions.changeEnvironment(${JSON.stringify(name)})`))throw Error(`HDR environment failed: ${name}`);
      await settle();const effective=await evaluate('window.__materialPhotoActions.presentation().environment');
      if(effective.environment!==name||!effective.source||!effective.textureUUID)throw Error('HDR selection did not reach lighting');
      episode.environments[name]=effective;await capture(`${key}-${name}`);
    }
    await evaluate("document.getElementById('glow').checked=false;document.getElementById('glow').dispatchEvent(new Event('change'));window.__materialPhotoActions.compare();document.getElementById('environment-rotation').value=90;document.getElementById('environment-rotation').dispatchEvent(new Event('input'))");
    await settle();
    const rotated=await evaluate('window.__materialPhotoActions.presentation().comparison');
    validateComparison(rotated.views);
    episode.rotatedEnvironment=rotated;episode.rotated=await capture(`${key}-rotated`);
    for(const role of ['albedo','roughness','metallic']){
      await evaluate(`window.__materialPhotoActions.view('materials');document.getElementById('map').value=${JSON.stringify(role)};document.getElementById('map').dispatchEvent(new Event('change'))`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      episode[role]=await capture(`${key}-${role}`);
    }
    await evaluate("document.getElementById('map').value='normals';document.getElementById('map').dispatchEvent(new Event('change'))");
    await click('#compare');await settle();
    const restored=await evaluate('window.__materialPhotoActions.presentation().comparison');
    if(Object.values(restored.views).some(view=>view.map!=='surface'))throw Error('Comparison retained inspector maps');
    validateComparison(restored.views);
    episode.layouts=[];
    for(const width of [1100,1000]){
      await browser.cdp.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false},sessionId);await settle();
      const tiles=await evaluate("[...document.querySelectorAll('[data-tile]')].map(tile=>{const a=tile.getBoundingClientRect(),s=tile.querySelector('.view-surface').getBoundingClientRect(),l=tile.querySelector('button').getBoundingClientRect();return{mode:tile.dataset.tile,surfaceHeight:s.height,labelHeight:l.height,fits:s.bottom<=l.top+1&&l.bottom<=a.bottom+1&&s.top>=a.top-1}})");
      if(tiles.some(tile=>!tile.fits||tile.surfaceHeight<=0||tile.labelHeight<=0))throw Error(`Comparison clipped at ${width}px`);
      episode.layouts.push({width,tiles,frame:await capture(`${key}-layout-${width}`)});
    }
    await browser.cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
    await evaluate("document.getElementById('map').value='surface';document.getElementById('map').dispatchEvent(new Event('change'));window.__materialPhotoActions.compare()");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    episode.mobile=await capture(`${key}-mobile`);
    episode.overflow=await evaluate('document.documentElement.scrollWidth>innerWidth');
    if(episode.overflow)throw Error('Mobile horizontal overflow');
    await browser.cdp.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    await persist();
  }
  if(values.cache){
    report.phase='cache-restoration';await persist();
    report.cacheRestorations=[];
    const episode=report.episodes[0],sampleKey=samples[0],runCount=await evaluate('window.__materialPhoto.runs.length');
    const preset=await evaluate('window.__materialPhotoActions.exportPreset()');
    await evaluate(`window.__materialPhotoActions.sample(${JSON.stringify(sampleKey==='bag'?'orb':'bag')})`);
    for(const size of sizes){
      await evaluate(`(async()=>{document.getElementById('material-size').value=${JSON.stringify(String(size))};await window.__materialPhotoActions.sample(${JSON.stringify(sampleKey)})})()`);
      const state=await evaluate('window.__materialPhoto');validateCachedRestoration(state,episode.source,size,runCount);
      if(JSON.stringify(await evaluate('window.__materialPhotoActions.exportPreset()'))!==JSON.stringify(preset))throw Error('Restoring output reset tuning');
      const original=report.episodes.find(row=>row.source===episode.source&&row.requestedSize===size),hashes={};
      for(const name of ['image','albedo','roughness','metallic','orm','plane-albedo','plane-orm']){
        const raw=await readRawEvidence(evaluate,name);hashes[name]=createHash('sha256').update(raw.bytes).digest('hex');
        if(hashes[name]!==original.rawEvidence[name].sha256)throw Error(`Cached ${name} bytes changed at ${size}`);
      }
      report.cacheRestorations.push({size,state:{status:state.status,cache:state.cache.source,runCount:state.runs.length},hashes,frame:await capture(`cached-${size}`)});
    }
    // Reload the same independent profile, not a second inference invocation.
    report.preReloadErrors=await evaluate('window.__materialPhotoWitnessErrors');
    report.preReloadGpuErrors=await evaluate('window.__materialPhoto.gpuErrors??[]');
    await browser.cdp.call('Page.navigate',{url:`${base}/demos/material-photo/index.html?sample=${sampleKey}`},sessionId);
    await evaluate(`new Promise(resolve=>{const check=()=>{const s=window.__materialPhoto;if(s&&(['cached','error'].includes(s.status)||(s.status==='loaded'&&!document.getElementById('run').disabled)))resolve();else setTimeout(check,100)};check()})`);
    const reloaded=await evaluate('window.__materialPhoto');validateCachedRestoration(reloaded,episode.source,512,0);
    report.cacheReload={status:reloaded.status,runCount:reloaded.runs.length,frame:await capture('cache-reload')};
    report.phase='source-photo-color';await persist();
    const points=await evaluate(`(async()=>{
      const THREE=await import('../../lib/three.webgpu.js');
      const {MaterialPhotoViewer}=await import('./viewer.js');
      const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:256px;height:256px;z-index:9999';
      const canvas=document.createElement('canvas');host.append(canvas);document.body.append(host);
      const gpu=await navigator.gpu.requestAdapter(),device=await gpu.requestDevice();
      const v=new MaterialPhotoViewer();await v.init(canvas,device,{interactive:false});
      const data=new Uint8Array(256*256*4),levels=[32,96,160,224];
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){const p=(y*256+x)*4;data.set([levels[Math.floor(x/64)],levels[Math.floor(x/64)],levels[Math.floor(x/64)],255],p);}
      v.setImage({width:256,height:256,data});v.orbit.set(0,0);v.target.set(0,0);v.current.set(0,0);v.render();
      window.__photoColorProbe={v,device,host};await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return levels.map((expected,i)=>{const p=new THREE.Vector3((i+.5)/4-.5,0,0).project(v.camera);return {expected,x:Math.round((p.x+1)*128),y:Math.round((1-p.y)*128)}});
    })()`);
    const shot=await browser.cdp.call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:256,height:256,scale:1}},sessionId);
    report.colorProbe={points,frame:path.join(output,'source-photo-gray.png')};await fs.writeFile(report.colorProbe.frame,Buffer.from(shot.data,'base64'));
    report.colorProbe.pixels=await evaluate(`(async()=>{const b=await createImageBitmap(await(await fetch(${JSON.stringify('data:image/png;base64,'+shot.data)})).blob()),c=new OffscreenCanvas(256,256),ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();return ${JSON.stringify(points)}.map(p=>({...p,actual:Array.from(ctx.getImageData(p.x,p.y,1,1).data)}))})()`);
    if(report.colorProbe.pixels.some(p=>p.actual.slice(0,3).some(value=>Math.abs(value-p.expected)>2)))throw Error('Original photograph changes source gray levels');
    await evaluate('(async()=>{const {v,device,host}=window.__photoColorProbe;await v.dispose();device.destroy();host.remove()})()');
  }
  report.errors=[...(report.preReloadErrors??[]),...await evaluate('window.__materialPhotoWitnessErrors??[]')];
  report.gpuErrors=[...(report.preReloadGpuErrors??[]),...await evaluate('window.__materialPhoto.gpuErrors??[]')];
  if(report.gpuErrors.length)throw Error('Uncaptured GPU errors');
  if(report.errors.length)throw Error('Uncaught browser errors');
  if(git(['rev-parse','HEAD'])!==report.source.commit)throw Error('Source moved during witness');
  report.phase='complete';report.status='passed';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{report.browserBeforeCleanup=browser?{exitCode:browser.child.exitCode,signalCode:browser.child.signalCode}:null;await browser?.close();await stopServer();await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error??null,report:path.join(output,'report.json')}));}
