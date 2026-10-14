#!/usr/bin/env node
// Independent-browser witness for the shared bench. All outputs are caller-owned.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, i, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
  return pairs;
}, []));
if (!args.out) throw Error('--out required');
const out = path.resolve(args.out); mkdirSync(out, {recursive:true});
const report = {schema:'kaminos.shared-making-witness.v1', status:'running', phase:'arguments',
  startedAt:new Date().toISOString(), requested:args, effective:{}, checks:[], errors:[]};
const save = () => writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2));
const check = (name, condition, detail) => { report.checks.push({name,ok:!!condition,detail});save();assert.ok(condition,name); };
let browser;
try {
  for (const key of ['origin','playwright','browser','root']) assert.ok(args[key],`--${key} required`);
  const executable=realpathSync(args.browser);
  assert.ok(!/Google Chrome\.app\//.test(executable),'use an independent browser');
  report.phase='server';save();
  const response=await fetch(new URL('/api/runtime-config',args.origin));assert.ok(response.ok);
  const runtime=await response.json();report.effective.server=runtime.source;
  check('served checkout has source identity',!!runtime.source?.commit,runtime.source);
  check('requested checkout is the served checkout',realpathSync(runtime.source.root||runtime.source.repoRoot||runtime.source.checkout||'')===realpathSync(args.root),runtime.source);
  report.phase='browser';save();
  const {chromium}=await import(pathToFileURL(path.resolve(args.playwright)));
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-renderer-backgrounding']});
  report.effective.browser={executable,version:browser.version()};
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  report.phase='home';save();
  await page.goto(new URL('/index.html',args.origin).href,{waitUntil:'load'});
  await page.waitForFunction(()=>window.kaminosWorkspace&&window.kaminosSceneAuthoring&&window.kaminosWorkbenchExperiments);
  await page.screenshot({path:path.join(out,'home.png')});
  const home=await page.evaluate(()=>({workspace:window.kaminosWorkspace.state(),bench:window.kaminosWorkbenchState(),tab:window.__kaminosActiveTab()}));
  check('Workbench opens on the shared bench',home.workspace.mode==='workbench'&&home.tab==='making-bench',home);
  report.phase='scene';save();
  const subject=await page.evaluate(()=>{
    const id=window.kaminosSceneAuthoring.addMesh('box',{width:1,height:.25,depth:.3});
    window.renameSceneObject(id,'Continuity beam');window.kaminosSetSceneObjectTransform(id,{position:[.7,.8,0]});
    window.kaminosSetCameraDebugPose({position:[3,2,4],target:[0,.6,0]});
    return {id,objects:window.kaminosSceneObjectDebugState(),selection:window.kaminosSelection.read(),camera:window.kaminosCameraDebugState()};
  });
  await page.evaluate(()=>window.__kaminosSetActiveTab('volume'));
  await page.locator('[data-workspace-mode="authoring"]').click();
  check('Authoring retains the original transform controls',await page.locator('#authoring-gizmo-slot #tb-gizmo-rotate').isVisible());
  await page.locator('[data-workspace-mode="workbench"]').click();
  check('bench has the original transform controls',await page.locator('#experiment-making-tools #tb-gizmo-rotate').isVisible());
  check('bench has the live scene tree',await page.locator('#making-bench-tree #scene-object-list').isVisible());
  const returned=await page.evaluate(()=>({tab:window.__kaminosActiveTab(),objects:window.kaminosSceneObjectDebugState(),selection:window.kaminosSelection.read(),camera:window.kaminosCameraDebugState()}));
  check('Workbench navigation returns home',returned.tab==='making-bench',returned.tab);
  check('navigation preserves object identity and pose',JSON.stringify(subject.objects)===JSON.stringify(returned.objects),{before:subject.objects,after:returned.objects});
  check('navigation preserves selection',JSON.stringify(subject.selection)===JSON.stringify(returned.selection));
  check('navigation preserves camera',JSON.stringify(subject.camera.position)===JSON.stringify(returned.camera.position)&&JSON.stringify(subject.camera.target)===JSON.stringify(returned.camera.target));
  await page.evaluate(()=>window.__kaminosSetActiveTab('assets'));
  check('explicit tools remain reachable',await page.evaluate(()=>window.__kaminosActiveTab()==='assets'));
  await page.locator('[data-workspace-mode="workbench"]').click();
  check('Workbench button also returns home from a lab',await page.evaluate(()=>window.__kaminosActiveTab()==='making-bench'));
  await page.evaluate(id=>window.kaminosSetSceneObjectTransform(id,{rotation:[0,0,.4]}),subject.id);
  await page.locator('#authoring-undo').click();
  check('bench Undo restores a shared scene edit',await page.evaluate(id=>window.kaminosSceneObjectDebugState().find(o=>o.id===id).transform.rotation[2]===0,subject.id));
  await page.locator('#authoring-redo').click();
  check('bench Redo reapplies the shared scene edit',await page.evaluate(id=>Math.abs(window.kaminosSceneObjectDebugState().find(o=>o.id===id).transform.rotation[2]-.4)<1e-8,subject.id));
  report.phase='save';save();
  const saved=await page.evaluate(()=>window.saveSceneAs({result:true}));
  check('ordinary scene save succeeds',saved.ok,saved);report.effective.saved=saved;
  const restore=new URL(saved.url);restore.searchParams.set('workspace','workbench');
  await page.goto(restore.href,{waitUntil:'load'});
  await page.waitForFunction(id=>window.kaminosWorkbenchExperiments&&window.kaminosSceneObjectDebugState?.().some(o=>o.id===id),subject.id);
  check('saved scene reopens on the bench',await page.evaluate(()=>window.__kaminosActiveTab()==='making-bench'));
  await page.screenshot({path:path.join(out,'restored.png')});
  report.phase='authoring-control-ownership';save();
  await page.locator('[data-workspace-mode="authoring"]').click();
  await page.evaluate(()=>window.kaminosSelectSceneRimLight());
  check('Rim Light leaves Authoring transform controls visible',await page.locator('#authoring-gizmo-slot #tb-gizmo-rotate').isVisible());
  await page.evaluate(()=>window.kaminosSceneAuthoring.addWaterEmitter());
  check('Add Water Emitter leaves Authoring transform controls visible',await page.locator('#authoring-gizmo-slot #tb-gizmo-rotate').isVisible());
  await page.evaluate(()=>window.__kaminosSetActiveTab('assets'));
  check('repeated Assets selection preserves Authoring controls',await page.locator('#authoring-gizmo-slot #tb-gizmo-rotate').isVisible());
  await page.screenshot({path:path.join(out,'authoring-controls.png')});
  await page.locator('[data-workspace-mode="workbench"]').click();
  check('bench reacquires controls after authoring additions',await page.locator('#experiment-making-tools #tb-gizmo-rotate').isVisible());
  if(args.asset){
    report.phase='arm-scene';save();
    await page.goto(new URL('/index.html',args.origin).href,{waitUntil:'load'});
    await page.waitForFunction(()=>window.kaminosWorkbenchExperiments&&window.kaminosAgentVantage);
    await page.locator('#making-bench-file').setInputFiles(path.resolve(args.asset));
    await page.waitForFunction(()=>window.kaminosSceneObjectDebugState().some(o=>o.type==='glb'));
    const arm=await page.evaluate(()=>{
      const row=window.kaminosSceneObjectDebugState().find(o=>o.type==='glb');
      window.renameSceneObject(row.id,'Straight boom arm');
      const center=row.worldBounds.min.map((v,i)=>(v+row.worldBounds.max[i])/2);
      window.kaminosSetCameraDebugPose({position:[center[0]+2.6,center[1]+.8,center[2]+1.8],target:center});
      window.kaminosFrameSelected();return row;
    });
    report.effective.arm={input:path.resolve(args.asset),object:arm};save();
    await page.evaluate(async id=>{
      const pilot='hostile-stunt-department';
      await window.kaminosAgentVantage.run('launch',{pilot,label:'Hostile Stunt Department'});
      await window.kaminosAgentVantage.run('orbit',{pilot,target:id,azimuth:45,elevation:20});
      window.kaminosSelection.set([id],id);
      const label=document.getElementById('composition-label');label.value='Flame carousel · first arm';label.dispatchEvent(new Event('change',{bubbles:true}));
    },arm.id);
    const scene=await page.evaluate(()=>window.saveSceneAs({result:true}));
    check('arm is retained in an ordinary scene',scene.ok&&scene.document.objects.some(o=>o.id===arm.id),{filename:scene.filename});
    report.effective.armScene=scene;save();
    await page.goto(scene.url,{waitUntil:'load'});
    await page.waitForFunction(id=>window.kaminosWorkbenchExperiments&&window.kaminosSceneObjectDebugState?.().some(o=>o.id===id),arm.id);
    check('arm reopens on the shared bench',await page.evaluate(()=>window.__kaminosActiveTab()==='making-bench'));
    await page.screenshot({path:path.join(out,'arm-scene.png')});
  }
  check('no uncaught page errors',report.errors.length===0,report.errors);
  report.status='passed';report.phase='complete';
} catch(error) {report.status='failed';report.error=error.stack||String(error);process.exitCode=1;}
finally {report.finishedAt=new Date().toISOString();save();await browser?.close();console.log(JSON.stringify({status:report.status,phase:report.phase,report:path.join(out,'report.json'),error:report.error},null,2));}
