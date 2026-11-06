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
let browser,profile;
try{
 report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 report.source=await(await fetch(new URL('/api/workbench-experiments',origin))).json();
 const {chromium}=await import(pathToFileURL(process.env.KAMINOS_PLAYWRIGHT??'/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs').href);
 profile=await fs.mkdtemp(path.join(os.tmpdir(),'kaminos-reflection-conformance-'));
 browser=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport:{width:256,height:192},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=browser.pages()[0];page.setDefaultTimeout(0);
 await page.addInitScript(()=>{Error.stackTraceLimit=40;const error=console.error;console.error=(...args)=>error(...args,new Error('console error stack').stack);});
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push(m.text());});
 report.phase='load';await page.goto(new URL('/tests/scene-reflections-native.html',origin).href);
 await page.waitForFunction(()=>window.assayLoaded||window.assayFailure);
 assert.equal(await page.evaluate(()=>window.assayFailure),undefined);
 report.adapter=await page.evaluate(async()=>{const adapter=await navigator.gpu.requestAdapter();return {...adapter.info.toJSON?.(),vendor:adapter.info.vendor,architecture:adapter.info.architecture};});
 assert.equal(report.adapter.vendor,'apple');
 const frames={};
 for(const enabled of [false,true]){
  report.phase=enabled?'reflecting':'baseline';frames[enabled?'on':'off']=await page.evaluate(x=>window.reflectionAssay.render(x),enabled);
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
 report.phase='environment-only';await page.evaluate(()=>window.reflectionAssay.setObjectVisible(false));
 const emptyOff=await page.evaluate(()=>window.reflectionAssay.render(false));
 const emptyOn=await page.evaluate(()=>window.reflectionAssay.render(true));
 let environmentError=0;for(let i=0;i<emptyOn.pixels.length;i++)environmentError=Math.max(environmentError,Math.abs(emptyOn.pixels[i]-emptyOff.pixels[i]));
 report.environmentOnly={maximumError:environmentError};assert.ok(environmentError<.002,'screen misses preserve the existing environment without double counting');
 checkDiagnostics();
 report.status='passed';report.phase='complete';
 await page.evaluate(()=>window.reflectionAssay.dispose());
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');if(profile)await fs.rm(profile,{recursive:true,force:true});}
