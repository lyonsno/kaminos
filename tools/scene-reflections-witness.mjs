import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [origin,out,expectedRoot]=process.argv.slice(2);
if(!origin||!out||!expectedRoot)throw Error('origin, output directory and expected repo root required');
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'source',origin,expectedRoot,executable,errors:[]};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
await publish();
let browser,profile;
try{
 report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 report.source=await(await fetch(new URL('/api/workbench-experiments',origin))).json();
 report.phase='browser';await publish();
 const {chromium}=await import(pathToFileURL(process.env.KAMINOS_PLAYWRIGHT??'/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs').href);
 profile=await fs.mkdtemp(path.join(os.tmpdir(),'kaminos-reflection-conformance-'));
 browser=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport:{width:256,height:192},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=browser.pages()[0];page.setDefaultTimeout(0);
 await page.addInitScript(()=>{Error.stackTraceLimit=40;const error=console.error;console.error=(...args)=>error(...args,new Error('console error stack').stack);});
 let rejectPage;
 const pageFailure=new Promise((_,reject)=>{rejectPage=reject;});pageFailure.catch(()=>{});
 const failPage=error=>{report.errors.push(String(error));rejectPage(error);};
 page.on('pageerror',failPage);
 page.on('requestfailed',request=>{if(report.phase==='load'&&request.resourceType()==='script')failPage(Error(`Bootstrap module failed: ${request.url()}: ${request.failure()?.errorText}`));});
 page.on('response',response=>{if(report.phase==='load'&&response.status()>=400&&response.request().resourceType()==='script')failPage(Error(`Bootstrap module HTTP ${response.status()}: ${response.url()}`));});
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push(m.text());});
 report.phase='load';await publish();
 await Promise.race([pageFailure,(async()=>{
  await page.goto(new URL('/tests/scene-reflections-native.html',origin).href);
  await page.waitForFunction(()=>window.assayLoaded||window.assayFailure);
 })()]);
 assert.equal(await page.evaluate(()=>window.assayFailure),undefined);
 report.adapter=await page.evaluate(async()=>{const adapter=await navigator.gpu.requestAdapter();return {...adapter.info.toJSON?.(),vendor:adapter.info.vendor,architecture:adapter.info.architecture};});
 assert.equal(report.adapter.vendor,'apple');
 const frames={};
 for(const enabled of [false,true]){
  report.phase=enabled?'reflecting':'baseline';await publish();frames[enabled?'on':'off']=await page.evaluate(x=>window.reflectionAssay.render(x),enabled);
  if(!enabled)report.baselineDiagnostics=[...report.errors];
  await fs.writeFile(path.join(out,enabled?'on.json':'off.json'),JSON.stringify(frames[enabled?'on':'off']));
  await page.screenshot({path:path.join(out,enabled?'on.png':'off.png')});
 }
 let difference=0,redGain=0,changed=0;
 for(let y=110;y<185;y++)for(let x=20;x<236;x++){
  const i=(y*256+x)*4,d=frames.on.pixels[i]-frames.off.pixels[i];
  difference+=Math.abs(d);redGain+=d;if(Math.abs(d)>.01)changed++;
 }
 report.comparison={difference,redGain,changed};report.effective=frames.on.state;
 assert.ok(difference>1&&redGain>1&&changed>20,'emissive scene geometry must appear reflected on the mirror receiver');
 assert.equal(frames.on.state.enabled,true,'requested reflection route must execute');
 // The pre-change consumer emits this exact diagnostic (retained fail-first
 // report). Preserve it, and reject every other renderer/runtime error.
 const inherited='THREE.TSL: Invalid generated code, expected a "vec3". Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.';
 const diagnosticKind=x=>x.split(' Error: console error stack')[0].split('\n')[0];
 const baselineKinds=new Set(report.baselineDiagnostics.map(diagnosticKind));
 const checkDiagnostics=()=>assert.ok(report.errors.every(x=>diagnosticKind(x)===inherited&&baselineKinds.has(inherited)),'no new shader/runtime diagnostic is permitted');
 checkDiagnostics();
 report.phase='projection-transition';await publish();
 await page.evaluate(()=>window.reflectionAssay.setOrthographic(true));
 const orthoOn=await page.evaluate(()=>window.reflectionAssay.render(true));
 const orthoOff=await page.evaluate(()=>window.reflectionAssay.render(false));
 let orthoError=0;for(let i=0;i<orthoOn.pixels.length;i++)orthoError=Math.max(orthoError,Math.abs(orthoOn.pixels[i]-orthoOff.pixels[i]));
 assert.equal(orthoOn.state.enabled,true);assert.equal(orthoOn.state.effective,false);assert.equal(orthoOn.state.suspensionReason,'perspective-camera-required');
 assert.equal(orthoOn.state.frames,frames.on.state.frames,'unsupported projection must not trace');
 assert.ok(orthoError<.002,'suspended receiving preserves ordinary orthographic lighting');
 await page.evaluate(()=>window.reflectionAssay.setOrthographic(false));
 const restored=await page.evaluate(()=>window.reflectionAssay.render(true));
 assert.equal(restored.state.effective,true);assert.ok(restored.state.frames>orthoOn.state.frames);
 report.projectionTransition={maximumError:orthoError,suspended:orthoOn.state,restored:restored.state};
 await fs.writeFile(path.join(out,'projection.json'),JSON.stringify({on:orthoOn,off:orthoOff,restored}));
 report.phase='renderer-replacement';await publish();
 report.replacement=await page.evaluate(()=>window.reflectionAssay.replaceRenderer());
 assert.equal(report.replacement.valid,false);assert.equal(report.replacement.resetReason,'device-replaced');
 const replacementOff=await page.evaluate(()=>window.reflectionAssay.render(false));
 const replacementOn=await page.evaluate(()=>window.reflectionAssay.render(true));
 let replacementGain=0;for(let y=110;y<185;y++)for(let x=20;x<236;x++){const i=(y*256+x)*4;replacementGain+=replacementOn.pixels[i]-replacementOff.pixels[i];}
 assert.ok(replacementGain>1,'ordinary material reflections must survive real renderer replacement');
 report.rendererReplacement={redGain:replacementGain,state:replacementOn.state};
 await fs.writeFile(path.join(out,'replacement.json'),JSON.stringify({off:replacementOff,on:replacementOn}));
 await page.screenshot({path:path.join(out,'replacement.png')});
 checkDiagnostics();
 report.phase='environment-only';await publish();await page.evaluate(()=>window.reflectionAssay.setObjectVisible(false));
 const emptyOff=await page.evaluate(()=>window.reflectionAssay.render(false));
 const emptyOn=await page.evaluate(()=>window.reflectionAssay.render(true));
 let environmentError=0;for(let i=0;i<emptyOn.pixels.length;i++)environmentError=Math.max(environmentError,Math.abs(emptyOn.pixels[i]-emptyOff.pixels[i]));
 report.environmentOnly={maximumError:environmentError};assert.ok(environmentError<.002,'screen misses preserve the existing environment without double counting');
 checkDiagnostics();
 report.status='passed';report.phase='complete';
 await page.evaluate(()=>window.reflectionAssay.dispose());
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{
 report.cleanup={complete:false};await publish();
 try{await browser?.close();}catch(error){report.cleanup.error=String(error);if(report.status==='passed'){report.status='failed';report.phase='cleanup';process.exitCode=1;}}
 await publish();
 try{if(profile)await fs.rm(profile,{recursive:true,force:true});}catch(error){report.cleanup.profileError=String(error);if(report.status==='passed'){report.status='failed';report.phase='cleanup';process.exitCode=1;}}
 report.cleanup.complete=true;await publish();
}
