import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {validateShredWitness} from '../tools/shred-witness-contract.mjs';

const [root, sourceScene, sourceOffer, out] = process.argv.slice(2);
assert.ok(root && sourceScene && sourceOffer && out, 'root scene offer-report output required');
const steps = Number(process.env.SHRED_STEPS ?? 3);
const profile = process.env.SHRED_PROFILE === '1';
const report = {ok:false, phase:'source', root, sourceScene, sourceOffer, steps, profile, arms:[], errors:[], warnings:[]};
await fs.mkdir(out, {recursive:true});
let writing = Promise.resolve();
const save = () => {
  const snapshot = JSON.stringify(report,null,2);
  writing = writing.then(()=>fs.writeFile(out+'/report.json',snapshot));
  return writing;
};
let browser, page, server;
try {
  await save();
  report.head = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.dirty = execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
  report.sourceDiff = execFileSync('git',['diff','--binary','HEAD'],{cwd:root,encoding:'utf8'});
  const sceneBytes = await fs.readFile(sourceScene);
  await fs.writeFile(out+'/source-scene.json',sceneBytes);
  report.sourceSha256 = createHash('sha256').update(sceneBytes).digest('hex');
  const scene = JSON.parse(sceneBytes);
  const presetId = scene.composition?.flame?.presetId;
  if (presetId) {
    assert.ok(process.env.SHRED_BASIN_STORE, 'referenced basin store must be explicit');
    const basinPath = process.env.SHRED_BASIN_STORE+'/presets/'+presetId+'.json';
    const basinBytes = await fs.readFile(basinPath);
    await fs.mkdir(out+'/basins/presets',{recursive:true});
    await fs.writeFile(out+'/basins/presets/'+presetId+'.json',basinBytes);
    report.basin = {path:basinPath,sha256:createHash('sha256').update(basinBytes).digest('hex')};
  }
  report.fixtureChanges = [];
  for (const object of scene.objects ?? []) for (const id of ['volume-render-detail','volume-render-detail-scale','volume-render-detail-fine']) {
    if (Object.hasOwn(object.volumeMaterial?.settings ?? {},id)) {
      report.fixtureChanges.push({object:object.id,id,previous:object.volumeMaterial.settings[id],reason:'retired displacement control'});
      delete object.volumeMaterial.settings[id];
    }
  }
  await fs.mkdir(out+'/scenes',{recursive:true});
  await fs.writeFile(out+'/scenes/shred-comparison.kaminos.json',JSON.stringify(scene,null,2));
  const probe = net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
  const port = probe.address().port; await new Promise(r=>probe.close(r));
  report.origin = 'http://127.0.0.1:'+port;
  server = spawn('python3',['serve.py',String(port)],{cwd:root,env:{...process.env,
    KAMINOS_SCENES_DIR:out+'/scenes', KAMINOS_VOLUME_SETTINGS_STORE:out+'/basins',
    KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:out+'/layouts'},stdio:['ignore','pipe','pipe']});
  for (const stream of [server.stdout,server.stderr]) stream.on('data',s=>{void fs.appendFile(out+'/server.log',s);});
  for (;;) {
    if (server.exitCode !== null) throw Error('owned server exited '+server.exitCode);
    try {await fetch(report.origin+'/api/runtime-config'); break;} catch {await new Promise(r=>setTimeout(r,100));}
  }
  const {verifyAuthoringServer} = await import(pathToFileURL(root+'/scene-authoring-witness-identity.mjs'));
  report.serving = await verifyAuthoringServer({origin:report.origin,repoRoot:root});
  const prior = JSON.parse(await fs.readFile(sourceOffer));
  const url = new URL(prior.offer); url.host = new URL(report.origin).host;
  const hash = new URLSearchParams(url.hash.slice(1)); hash.set('scene','shred-comparison.kaminos.json');
  hash.set('volume_resolution','32'); hash.set('volume_steps','8'); hash.set('volume_render_scale','0.4');
  url.hash = hash.toString(); report.url = url.href;
  report.executable = process.env.CHROMIUM_EXECUTABLE;
  assert.ok(report.executable?.includes('Google Chrome for Testing'), 'independent browser required');
  const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  browser = await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,
    args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu'],viewport:{width:1100,height:820}});
  page = browser.pages()[0]; page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
  let rejectFatal; const fatal = new Promise((_,reject)=>{rejectFatal=reject;}); fatal.catch(()=>{});
  const step = p => Promise.race([p,fatal]);
  process.once('SIGTERM',()=>rejectFatal(Error('witness cancelled')));
  page.on('pageerror',e=>{report.errors.push(e.message);void save();rejectFatal(e);});
  page.on('console',m=>{if (['error','warning'].includes(m.type())) {
    report.warnings.push(m.text()); void save();
    if (/invalid shader|error while|validation|device lost|error occurred|PRESET LOAD FAILED/i.test(m.text())) rejectFatal(Error(m.text()));
  }});
  report.phase = 'load'; await save(); await step(page.goto(report.url,{waitUntil:'domcontentloaded'}));
  await step(page.waitForFunction(()=>window.kaminosWorkbenchExperimentError || window.__kaminosVolumePrototype?.debugState().error ||
    (window.kaminosWorkbenchExperiments?.state().id==='flame' && window.__kaminosVolumePrototype?.debugState().active)));
  report.initial = await page.evaluate(()=>({experiment:window.kaminosWorkbenchExperiments?.state(),
    error:window.kaminosWorkbenchExperimentError || window.__kaminosVolumePrototype?.debugState().error,
    runtime:window.__kaminosVolumePrototype?.debugState()}));
  await save(); assert.ok(!report.initial.error, report.initial.error);
  const invoke = (op,input) => step(page.evaluate(({op,input})=>{document.activeElement?.blur();return window.kaminosWorkbenchExperiments.invoke(op,input);},{op,input}));
  await invoke('setPaused',true); await invoke('select','domain');
  report.controls = {'volume-resolution':'32','volume-steps':8,'volume-render-scale':.4,'volume-ray-noise-animated':false,
    'volume-fine-velocity':0,'volume-appearance-model':'authored'};
  await invoke('setControls',report.controls);
  assert.equal((await page.evaluate(()=>window.kaminosLocalLiquidState())).mounted,false,'water must not be mounted');
  const arms = process.env.SHRED_ARMS ? JSON.parse(process.env.SHRED_ARMS) : [{mode:'authored',split:false},{mode:'shred-only',split:false},{mode:'shred-only',split:true},{mode:'authored',split:true}];
  report.requestedArms=arms;
  for (const arm of arms) {
    const label = arm.mode+(arm.split?'-split':'-combined'); report.phase = label; await save();
    await invoke('setControls',{'volume-appearance-model':arm.mode,'volume-fine-velocity':arm.split?16:0});
    const replay = await step(page.evaluate(steps=>window.__kaminosVolumePrototype.sampleDeterministicReplayFrame({steps,startTimeMs:1000,timeStepMs:1000/60}),steps));
    const captured = await step(page.evaluate(async()=>{
      const r = window.__kaminosVolumePrototype;
      const frame = await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
      if (!frame.ok || frame.simAdvanced || !frame.image) throw Error('missing held image');
      const canvas = document.createElement('canvas'); canvas.width=frame.image.width;canvas.height=frame.image.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.image.rgba),canvas.width,canvas.height),0,0);
      const exp = await r.beginDebugFullFieldExport();
      if (exp.status !== 'captured') throw Error('full field capture failed: '+JSON.stringify(exp));
      try {
        return {state:r.debugState(),exp,png:canvas.toDataURL().split(',')[1],
          fluid:r.readDebugFullFieldExportChunk({sessionId:exp.sessionId,kind:'fluid',floatCount:exp.cellCount*16}),
          front:r.readDebugFullFieldExportChunk({sessionId:exp.sessionId,kind:'front',floatCount:exp.cellCount})};
      } finally {r.releaseDebugFullFieldExport({sessionId:exp.sessionId});}
    }));
    const fluid = Buffer.from(captured.fluid.base64,'base64'), front = Buffer.from(captured.front.base64,'base64');
    await fs.writeFile(out+'/'+label+'.fluid.f32',fluid); await fs.writeFile(out+'/'+label+'.front.f32',front);
    await fs.writeFile(out+'/'+label+'.png',Buffer.from(captured.png,'base64'));
    const field = new Float32Array(fluid.buffer,fluid.byteOffset,fluid.byteLength/4);
    const fronts = new Float32Array(front.buffer,front.byteOffset,front.byteLength/4);
    const summary = validateShredWitness({state:captured.state,replay,field,front:fronts},{...arm,steps,cells:captured.exp.cellCount});
    delete captured.fluid;delete captured.front;delete captured.png;
    report.arms.push({label,replay,...captured,summary}); await save();
  }
  if (profile) {
    report.phase='profile'; report.profiles=[]; await save();
    await invoke('setControls',{'volume-fine-velocity':0});
    for (let pair=0;pair<4;pair++) for (const mode of ['authored','shred-only']) {
      await invoke('setControls',{'volume-appearance-model':mode});
      await step(page.evaluate(()=>window.__kaminosVolumePrototype.sampleDeterministicReplayFrame({steps:60,startTimeMs:1000,timeStepMs:1000/60})));
      const timing = await step(page.evaluate(appearanceModel=>window.__kaminosVolumePrototype.sampleSimGpuProfile({steps:32,appearanceModel}),mode));
      report.profiles.push({pair,mode,timing});await save();
      assert.equal(timing.status,'sampled',timing.reason); assert.equal(timing.validSimSteps,32);
    }
  }
  report.ok=true;report.phase='complete';
} catch (error) {
  report.error=String(error.stack); process.exitCode=1;
  await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});
} finally {
  await browser?.close();
  if (server && server.exitCode===null) {server.kill('SIGTERM');await once(server,'exit');}
  await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,out}));
}
