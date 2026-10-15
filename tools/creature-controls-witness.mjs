import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateCreatureControlRead(r,setup){
 assert.equal(r.host.route,'shared-owner-scene');assert.equal(r.host.scene.rendererBackend,'webgpu');
 assert.equal(r.source.frameSha256,setup.frame_sha256);assert.equal(r.source.caseSha256,r.currentSkin.current.case_sha256);
 assert.equal(r.currentSkin.pending,null);assert.equal(r.skin.bones,28);assert.ok(r.skin.vertices>0);
 assert.ok(Number.isInteger(r.playback.frame)&&r.playback.frame>=0&&r.playback.frame<r.playback.frames);
 assert.ok(r.transform.position.every(Number.isFinite));assert.ok(r.host.id);
}
export async function witness(args){
 const out=resolve(args.out),root=realpathSync(args.root);mkdirSync(out,{recursive:true});
 const report={schema:'kaminos.creature-controls-witness.v1',status:'running',phase:'inputs',requested:args,captures:[],errors:[],actions:[]};
 let browser,context,page;
 const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
 try{
  const setup=JSON.parse(readFileSync(args.setup));report.setupSha256=hash(readFileSync(args.setup));
  const url=new URL('/index.html',args.base);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','marionette/walking-creature');url.searchParams.set('experiment_inputs',JSON.stringify(setup));report.requestedUrl=url.href;
  report.phase='browser';const {chromium}=await import(args.playwright);const executable=realpathSync(args.chrome);
  assert.ok(!executable.includes('/Applications/Google Chrome.app/'),'Independent test browser required');report.effectiveExecutable=executable;
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-mock-keychain','--password-store=basic','--no-first-run']});report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1600,height:1100},recordVideo:{dir:join(out,'video'),size:{width:1600,height:1100}}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  report.phase='load';await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.kaminosWalkingCreature==='function');
  report.effectiveUrl=page.url();report.runtimeConfig=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());assert.equal(report.runtimeConfig.source.repoRoot,root);
  report.source=[];for(const file of ['index.html','playback-controls.mjs','scene-owner-controls.mjs','experiments/creature-motion/creature-properties.mjs','experiments/creature-motion/walking.experiment.mjs','experiments/creature-motion/full-body-runtime.mjs']){const response=await page.request.get(new URL('/'+file,url).href);assert.equal(response.status(),200);const expected=hash(readFileSync(join(root,file))),actual=hash(await response.body());assert.equal(actual,expected);report.source.push({file,sha256:actual});}
  const read=()=>page.evaluate(()=>window.kaminosWalkingCreature());
  const capture=async name=>{const path=join(out,name+'.png');await page.screenshot({path});report.captures.push(path);};
  report.initial=await read();validateCreatureControlRead(report.initial,setup);assert.notEqual(report.initial.playback.status,'playing');
  assert.equal(await page.locator('#experiment-owner-slot').isVisible(),false,'Creature context still exposes the experiment picker instead of ordinary scene objects');
  assert.equal(await page.getByRole('button',{name:'Replay source',exact:true}).count(),0);assert.equal(await page.getByLabel('Creature cast',{exact:true}).isVisible(),true);
  await capture('initial');
  report.phase='replay';await page.getByRole('button',{name:'↻ Replay',exact:true}).click();await page.waitForFunction(()=>window.kaminosWalkingCreature().playback.frame>0);await page.getByRole('button',{name:'Ⅱ Pause',exact:true}).click();
  report.held=await read();assert.notEqual(report.held.playback.status,'playing');report.actions.push({kind:'replay-pause',frame:report.held.playback.frame});await capture('held');
  report.phase='scrub';const track=page.getByLabel('Playback position',{exact:true}),bounds=await track.boundingBox();assert.ok(bounds?.width>100);report.scrubBounds=[bounds];
  await page.mouse.move(bounds.x+2,bounds.y+bounds.height/2);await page.mouse.down();
  for(const f of [.05,.25,.5,.75,.99]){await page.mouse.move(bounds.x+bounds.width*f,bounds.y+bounds.height/2,{steps:3});report.scrubBounds.push(await track.boundingBox());}
  await page.mouse.up();await page.waitForFunction(()=>window.kaminosWalkingCreature().playback.status!=='playing');
  for(const b of report.scrubBounds)for(const k of ['x','y','width','height'])assert.ok(Math.abs(b[k]-bounds[k])<.1,'Scrubbing moved or resized its target');
  await track.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>window.kaminosWalkingCreature().playback.frame===1);
  report.beforeCast=await read();report.phase='cast';const target=setup.choices.find(c=>c.attachment==='distributed'&&c.cast!==report.beforeCast.currentSkin.current.cast);assert.ok(target);
  await page.getByLabel('Creature cast',{exact:true}).selectOption(target.cast);await page.waitForFunction(sha=>window.kaminosWalkingCreature().source.caseSha256===sha,target.case_sha256);
  report.afterCast=await read();validateCreatureControlRead(report.afterCast,setup);assert.equal(report.afterCast.playback.frame,1);assert.deepEqual(report.afterCast.transform,report.beforeCast.transform);await capture('cast-switch');
  report.phase='motion';const next=setup.motions.find(m=>m.id==='walk-1');await page.getByLabel('Creature motion',{exact:true}).selectOption(next.id);await page.waitForFunction(sha=>window.kaminosWalkingCreature().source.motionSha256===sha,next.motion_sha256);report.afterMotion=await read();assert.equal(report.afterMotion.source.caseSha256,target.case_sha256);assert.deepEqual(report.afterMotion.transform,report.afterCast.transform);
  await page.getByLabel('Playback speed',{exact:true}).selectOption('0.5');await page.waitForFunction(()=>window.kaminosWalkingCreature().rate===.5);
  report.phase='save-open';await page.getByText('Save / open creature',{exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save creature setup',exact:true}).click();const download=await downloadPromise;const saved=join(out,'saved-creature.json');await download.saveAs(saved);report.saved=JSON.parse(readFileSync(saved));assert.equal(report.saved.case_sha256,target.case_sha256);assert.equal(report.saved.rate,.5);
  const previousId=(await read()).host.id;
  await page.getByLabel('Open creature setup',{exact:true}).setInputFiles(saved);await page.waitForFunction(({sha,previousId})=>window.kaminosWalkingCreature().host.id!==previousId&&window.kaminosWalkingCreature().source.caseSha256===sha&&window.kaminosWalkingCreature().rate===.5,{sha:target.case_sha256,previousId});report.reopened=await read();validateCreatureControlRead(report.reopened,setup);await capture('reopened');
  report.phase='workspace';await page.getByRole('button',{name:'Authoring',exact:true}).click();assert.equal(await page.getByLabel('Creature motion',{exact:true}).isVisible(),true);assert.equal(await track.isVisible(),true);await capture('authoring');
  await page.getByRole('button',{name:'Workbench',exact:true}).click();assert.equal(await page.locator('#experiment-scene-slot #scene-object-list').isVisible(),true);await capture('workbench-return');
  report.phase='close';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.locator('.scene-owner-playback').count(),0);assert.equal(await page.locator('.creature-properties').count(),0);
  assert.deepEqual(report.errors,[]);report.status='complete';report.phase='complete';
 }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};if(page)try{await page.screenshot({path:join(out,'failure.png')});}catch{}throw error;}
 finally{if(context)await context.close().catch(e=>report.errors.push(e.message));if(browser){await browser.close();report.browserClosed=true;}persist();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];await witness(args);}
