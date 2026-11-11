// Small native scene/readout check; no performance comparison.
import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
const [out,sceneFile]=process.argv.slice(2);assert(out,'Caller-owned output directory required');await fs.mkdir(out,{recursive:true});
const root=process.cwd(),report={root,expectedCommit:process.env.EXPECTED_COMMIT??null,phase:'source-preflight',status:'running',errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();let context,server,log;
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(report.expectedCommit!==null)assert.equal(report.commit,report.expectedCommit);
 report.phase='launch';await save();
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin='http://127.0.0.1:'+port;report.origin=origin;
 log=await fs.open(out+'/server.log','a');server=spawn('python3',['-u','serve.py',String(port)],{cwd:root,env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1',...(process.env.KAMINOS_DIAGNOSTIC_SCENES?{KAMINOS_SCENES_DIR:process.env.KAMINOS_DIAGNOSTIC_SCENES}:{})},stdio:['ignore',log.fd,log.fd]});
 const {setTimeout:pause}=await import('node:timers/promises');for(;;){try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}if(server.exitCode!==null)throw Error('Server failed');await pause(100);}
 assert.equal(report.runtime.source.repoRoot,root);
 report.browser=process.env.KAMINOS_TEST_BROWSER;assert(report.browser&&!report.browser.includes('/Google Chrome.app/'),'Independent browser executable required');
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.browser,headless:true,viewport:{width:960,height:720},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.setDefaultTimeout(0);
 report.phase='native-mask';await save();await page.goto(origin+'/tests/neural-shading-render-native.html');await page.waitForFunction(()=>window.neumipRenderLoaded||window.neumipRenderFailure);assert.equal(await page.evaluate(()=>window.neumipRenderFailure),undefined);
 report.identity=await page.evaluate(()=>window.neumipRenderAssay.identity);assert.equal(report.identity.backend,'WebGPU');assert.match(JSON.stringify(report.identity.adapter),/apple/i);
 report.cases=[];
 for(const [scale,reject] of [[.25,false],[.25,true],[1,false]]){
  const r=await page.evaluate(([s,reject])=>window.neumipRenderAssay.diagnose(s,reject),[scale,reject]);report.cases.push({scale,reject,...r});await save();
  assert(r.neuralPixels>100);assert.equal(r.receivingPassIncluded,false);assert.equal(r.readbackBytes,16);
  if(reject||scale===1){assert.equal(r.fullRatePixels,r.neuralPixels);assert.equal(r.reconstructedPixels,0);}
  else assert(r.reconstructedPixels/r.neuralPixels>.9,'Flat neural face should accept compatible coarse support');
 }
 await page.screenshot({path:out+'/native.png'});await page.evaluate(()=>window.neumipRenderAssay.dispose());assert.deepEqual(report.errors,[]);
 if(sceneFile){
  report.phase='native-readout-ui';await save();
  await page.goto(origin+'/?workspace=authoring#scene='+encodeURIComponent(sceneFile));
  await page.waitForFunction(()=>window.kaminosSceneLoadPresentation?.().document.phase==='idle'&&window.kaminosNeuralShading?.diagnostics&&window.kaminosMaterials?.read().bindings.length===1);
  await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());
  assert.equal(await page.evaluate(()=>window.kaminosNeuralShading.diagnostics.read().status),'off');
  await page.locator('[data-inspector-context="scene"]').click();await page.locator('#authoring-render-slot > summary').click();
  await page.locator('#scene-neural-fallback-readout button').first().click();
  await page.waitForFunction(()=>['snapshot','failed','stale'].includes(window.kaminosNeuralShading.diagnostics.read().status));
  report.ui=await page.evaluate(()=>({readout:window.kaminosNeuralShading.diagnostics.read(),text:document.getElementById('scene-neural-fallback-readout').textContent,scene:window.kaminosWorkbenchSceneState()}));await save();assert.equal(report.ui.readout.status,'snapshot',report.ui.text);assert.equal(report.ui.scene.rendererBackend,'webgpu');
  await page.screenshot({path:out+'/readout-ui.png'});
  await page.evaluate(()=>window.kaminosNeuralShading.setScale(.5));assert.equal(await page.evaluate(()=>window.kaminosNeuralShading.diagnostics.read().status),'stale');assert.equal(await page.evaluate(()=>window.kaminosNeuralShading.diagnostics.read().result),null);
  await page.locator('#scene-neural-fallback-readout button').nth(1).click();assert.equal(await page.evaluate(()=>window.kaminosNeuralShading.diagnostics.read().status),'off');
 }

 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{try{await context?.close();}catch(error){report.cleanupError=error.stack;report.status='failed';process.exitCode=1;}server?.kill('SIGTERM');try{await log?.close();}catch(error){report.cleanupLogError=error.stack;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
