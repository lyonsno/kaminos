import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {verifyAuthoringServer} from './scene-authoring-witness-identity.mjs';
import {compositionRestoreUrl} from './scene-authoring.mjs';
const {values:v}=parseArgs({options:{origin:{type:'string'},out:{type:'string'},scene:{type:'string'},playwright:{type:'string'},greenroom:{type:'string'},owner:{type:'string'},'baseline-index':{type:'string'}}});
assert.ok(v.out && path.isAbsolute(v.out),'explicit output directory required');await fs.mkdir(v.out,{recursive:true});
const r={status:'running',phase:'arguments',requested:v,root:process.cwd(),startedAt:new Date().toISOString(),errors:[]};
const save=()=>fs.writeFile(path.join(v.out,'report.json'),JSON.stringify(r,null,2));await save();
const savedPoseEqual=(actual,expected)=>{for(const key of ['position','rotation','scale']){assert.equal(actual[key].length,3);for(let i=0;i<3;i++)assert.ok(actual[key][i]===expected[key][i],`${key}[${i}] changed through persistence`);}};
let browser,page,lease;
try {
 for(const key of ['origin','scene','playwright','greenroom','owner'])assert.ok(v[key],`--${key} required`);
 r.phase='source';r.source=await verifyAuthoringServer({origin:v.origin,repoRoot:process.cwd()});
 for(const name of ['scene-edit-session.mjs','scene-placement-tools.mjs']) {
  const raw=await(await fetch(new URL(name,v.origin))).text(),local=await fs.readFile(name,'utf8');assert.equal(raw,local,`wrong served source ${name}`);
  r.source.hashes[name]=createHash('sha256').update(raw).digest('hex');
 }
 const scene=await(await fetch(`${v.origin}/api/read?root=scenes&path=${encodeURIComponent(v.scene)}`)).json();
 await fs.writeFile(path.join(v.out,'input-scene.json'),JSON.stringify(scene,null,2));
 for(const entry of scene.objects){const response=await fetch(new URL(entry.source,v.origin));assert.ok(response.ok,`missing asset ${entry.source}`);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length);r.asset={source:entry.source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
 r.phase='lease';await save();
 r.lease=JSON.parse(execFileSync(v.greenroom,['lease','claim','--owner',v.owner,'--agent-id','placement-witness','--repo-root',process.cwd(),'--pid',String(process.pid),'--effective-route',`${v.origin} Chrome WebGPU kiln placement`,'--backend','webgpu','--device','apple-gpu','--profile','browser-smoke','--supports-checkpoints','--ttl-seconds','3600'],{encoding:'utf8'}));lease=r.lease.lease_id;assert.ok(lease);
 const {chromium}=await import(pathToFileURL(v.playwright));
 browser=await chromium.launch({channel:'chrome',headless:false,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:1,recordVideo:{dir:path.join(v.out,'video')}});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
 page.on('pageerror',e=>r.errors.push(e.message));page.on('dialog',async d=>{r.errors.push(`unexpected dialog: ${d.message()}`);await d.dismiss();});
 if(v['baseline-index'])await page.route(url=>url.origin===v.origin && ['/', '/index.html'].includes(url.pathname),async route=>{const response=await route.fetch();const body=await fs.readFile(v['baseline-index'],'utf8');r.baselineIndexHash=createHash('sha256').update(body).digest('hex');await route.fulfill({response,body});});
 r.phase='load';r.url=compositionRestoreUrl(scene.composition,v.scene,v.origin);await save();await page.goto(r.url);
 await page.waitForFunction(()=>window.kaminosSceneObjectDebugState?.().length && window.__kaminosVolumePrototype?.debugState().frameCount>25,null,{timeout:120000});
 r.runtime=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());assert.equal(r.runtime.active,true);assert.equal(r.runtime.error,null);assert.match(r.runtime.backend,/WebGPU/);
 assert.equal(new URL(page.url()).searchParams.get('settings_preset'),scene.composition.flame.presetId);
 const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const shot=async name=>{await frames();await page.screenshot({path:path.join(v.out,`${name}.png`)});};
 const current=()=>page.evaluate(()=>window.kaminosSceneObjectDebugState().find(o=>o.id==='kiln').transform);
 const press=key=>page.keyboard.press(key);
 const inside=async()=>{await page.locator('#viewport').hover({position:{x:700,y:500}});await page.evaluate(()=>document.activeElement?.blur());};
 await shot('before');r.before=await current();await inside();
 r.phase='modal-start';await press('g');
 assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState?.().modal?.operation),'translate','G must begin a modal placement instead of leaving pose editing inert');
 await press('x');await page.keyboard.type('0.25');await shot('move');r.moved=await current();
 assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().gizmoVisible),false,'modal axis owns feedback without an overlaid gizmo');
 assert.ok(Math.abs(r.moved.position[0]-r.before.position[0]-.25)<1e-10);
 r.phase='operation-switch';await press('r');await page.keyboard.type('15');r.rotated=await current();assert.deepEqual(r.rotated.position,r.moved.position);
 assert.ok(Math.abs(r.rotated.rotation[0]-Math.PI/12)<1e-10);await shot('rotate');
 await press('Escape');assert.deepEqual(await current(),r.before);assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),0);
 r.phase='commit-undo-redo';await press('g');await press('x');await page.keyboard.type('0.25');await press('r');await page.keyboard.type('15');await press('Enter');r.accepted=await current();
 assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),1);await press('Meta+z');assert.deepEqual(await current(),r.before);await press('Meta+Shift+z');assert.deepEqual(await current(),r.accepted);
 r.phase='native-gizmo';await page.evaluate(()=>window.setGizmoMode('translate'));await frames();
 const origin=await page.evaluate(()=>{const l=document.querySelector('#scene-edit-overlay line'),b=document.getElementById('viewport').getBoundingClientRect();return {x:b.left+Number(l.getAttribute('x1')),y:b.top+Number(l.getAttribute('y1'))+5};});
 const dragGizmo=async()=>{await page.mouse.move(origin.x+65,origin.y);await page.mouse.down();assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().gizmoDragging),true,'actual native X handle must acquire drag');await page.mouse.move(origin.x+95,origin.y,{steps:4});assert.notDeepEqual(await current(),r.accepted);};
 await dragGizmo();await page.mouse.up();assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),2);await press('Meta+z');assert.deepEqual(await current(),r.accepted);
 await dragGizmo();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.deepEqual(await current(),r.accepted);assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().gizmoDragging),false);await page.mouse.move(origin.x+120,origin.y);await page.mouse.up();assert.deepEqual(await current(),r.accepted);assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().gizmoEditing),false);
 r.phase='snap-scale-plane';await press('g');await press('x');await page.keyboard.type('0.26');await page.keyboard.down('Control');assert.ok(Math.abs((await current()).position[0]-r.accepted.position[0]-.3)<1e-10);await page.keyboard.up('Control');await press('Escape');
 await press('s');await page.keyboard.type('1.25');assert.deepEqual((await current()).scale,r.accepted.scale.map(x=>x*1.25));await press('Escape');
 await press('g');await press('Shift+z');await page.mouse.move(1110,560);assert.equal((await current()).position[2],r.accepted.position[2]);assert.notDeepEqual((await current()).position,r.accepted.position);await press('Escape');
 r.phase='agent-operation';await page.evaluate(()=>window.kaminosSetSceneObjectTransform('kiln',{position:[2,3,4]}));assert.deepEqual((await current()).position,[2,3,4]);await press('Meta+z');assert.deepEqual(await current(),r.accepted);
 r.phase='local-frame';await press('g');await press('y');await press('y');await page.keyboard.type('0.1');r.local=await current();assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().modal.frame),'local');assert.ok(Math.abs(r.local.position[2]-r.accepted.position[2])>.001);await shot('local-axis');await press('Escape');
 r.phase='pointer-confirm-cancel';await press('g');await press('z');await page.keyboard.type('0.2');await page.mouse.click(1100,500,{button:'right'});assert.deepEqual(await current(),r.accepted);
 await press('g');await press('z');await page.keyboard.type('0.2');await page.mouse.click(1100,500);r.clicked=await current();assert.ok(Math.abs(r.clicked.position[2]-r.accepted.position[2]-.2)<1e-10);assert.equal((await page.evaluate(()=>window.kaminosSceneObjectDebugState())).find(o=>o.id==='kiln').active,true);
 r.phase='relative-field';const input=page.locator('[data-transform-field="position.x"]'),grip=page.locator('[data-transform-field="position.x"]').locator('..').locator('.transform-axis');await grip.scrollIntoViewIfNeeded();const box=await grip.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2,{steps:6});await page.mouse.up();
 r.dragged=await current();assert.ok(Math.abs(r.dragged.position[0]-r.clicked.position[0]-.3)<1e-9);await shot('relative-field');
 r.phase='text-cancel';await input.fill('1.23456789');await press('Escape');assert.deepEqual(await current(),r.dragged);
 await input.fill('1.23456789');await press('Enter');assert.equal((await current()).position[0],1.23456789);
 // Native cursor movement stays in the text field and cannot start rotation/scale.
 await input.focus();await press('Meta+ArrowLeft');assert.equal(await page.evaluate(()=>window.kaminosPlacementDebugState().modal),null);await input.blur();
 r.phase='save-guard';await inside();await press('g');await press('x');await page.keyboard.type('9');assert.equal(await page.evaluate(()=>window.saveScene()),false);await press('Escape');
 r.phase='save-reopen';r.savedPose=await current();assert.equal(await page.evaluate(()=>window.saveScene()),true);
 const saved=await(await fetch(`${v.origin}/api/read?root=scenes&path=${encodeURIComponent(v.scene)}`)).json();await fs.writeFile(path.join(v.out,'saved-scene.json'),JSON.stringify(saved,null,2));savedPoseEqual(saved.objects[0].transform,r.savedPose);assert.equal(saved.objects[0].source,scene.objects[0].source);
 r.reopenUrl=compositionRestoreUrl(saved.composition,v.scene,v.origin);await page.goto(r.reopenUrl);await page.waitForFunction(()=>window.kaminosSceneObjectDebugState?.().length===1 && window.__kaminosVolumePrototype?.debugState().frameCount>25,null,{timeout:120000});savedPoseEqual(await current(),r.savedPose);await shot('reopened');
 r.phase='capture';await page.locator('#composition-label').fill('Modal placement study');assert.equal(await page.evaluate(()=>window.captureComposition()),true);await shot('final');
 r.phase='busy-admission';let releasePreset,sawPreset;const held=new Promise(resolve=>releasePreset=resolve),requested=new Promise(resolve=>sawPreset=resolve);
 await page.route('**/api/volume-settings-presets',async route=>{if(route.request().method()==='POST'){sawPreset();await held;}await route.continue();});
 const capture=page.evaluate(()=>window.captureComposition()).then(value=>({value}),error=>({error}));await requested;
 try {
  r.busyRejection=await page.evaluate(()=>{try{window.kaminosSetSceneObjectTransform('kiln',{position:[9,9,9]});return null;}catch(error){return error.message;}});assert.match(r.busyRejection,/authoring/);savedPoseEqual(await current(),r.savedPose);
 } finally {releasePreset();const captured=await capture;await page.unroute('**/api/volume-settings-presets');if(captured.error)throw captured.error;assert.equal(captured.value,true);}
 r.phase='correction-admission';const ply='ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 1\n';await fs.writeFile(path.join(v.out,'correction-fixture.ply'),ply);
 await page.route('**/placement-correction-fixture.ply',route=>route.fulfill({contentType:'application/octet-stream',body:ply}));
 await page.evaluate(async()=>{await window.greenroomImportSplat('/placement-correction-fixture.ply','placement-correction-fixture.ply',{}, {clear:false,metadata:{id:'correction-fixture',splat:{correction:{centroidOffset:[.1,0,0]}}}});await window.enterSplatCorrectionMode('correction-fixture');});
 assert.equal(await page.evaluate(()=>window.kaminosSplatPreviewDebugState('correction-fixture')?.totalPointCount),3,'fixture must traverse the actual PLY preview importer');
 r.correctionBefore=await page.evaluate(()=>window.kaminosSplatCorrectionModeDebugState());assert.equal(r.correctionBefore.active,true);
 r.correctionRejection=await page.evaluate(()=>{try{window.kaminosSetSceneObjectTransform('correction-fixture',{position:[9,9,9]});return null;}catch(error){return error.message;}});assert.match(r.correctionRejection,/correction/);
 const cp=page.locator('[data-transform-field="position.x"]');await cp.fill('7');await cp.blur();const cg=cp.locator('..').locator('.transform-axis');await cg.scrollIntoViewIfNeeded();const cb=await cg.boundingBox();await page.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2);await page.mouse.down();await page.mouse.move(cb.x+40,cb.y);await page.mouse.up();
 r.correctionAfter=await page.evaluate(()=>window.kaminosSplatCorrectionModeDebugState());assert.deepEqual(r.correctionAfter,r.correctionBefore,'rejected placement and observation preserve the full correction session');
 // A deliberate zero-delta correction action is distinct from observation:
 // the existing correction tool marks it dirty, but its authored values stay put.
 r.correctionTouched=await page.evaluate(()=>window.kaminosSetSplatCorrectionDraftTransform({}));assert.deepEqual(r.correctionTouched.sceneTransform,r.correctionBefore.sceneTransform);assert.deepEqual(r.correctionTouched.draftCorrection,r.correctionBefore.draftCorrection);assert.deepEqual(r.correctionTouched.savedCorrection,r.correctionBefore.savedCorrection);assert.deepEqual(r.correctionTouched.cropTargetTransform,r.correctionBefore.cropTargetTransform);
 await page.evaluate(()=>{window.exitSplatCorrectionMode({revert:true,silent:true});window.removeSceneObject('correction-fixture');window.selectSceneObject('kiln');});await page.unroute('**/placement-correction-fixture.ply');
 r.finalRuntime=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());assert.equal(r.finalRuntime.error,null);assert.deepEqual(r.errors,[]);
 await context.tracing.stop({path:path.join(v.out,'trace.zip')});await context.close();r.status='passed';r.phase='complete';
} catch(error) {r.status='failed';r.error=error.stack||String(error);process.exitCode=1;if(page)try{await page.screenshot({path:path.join(v.out,'failed.png')});r.lastState=await page.evaluate(()=>({edit:window.kaminosPlacementDebugState?.(),info:document.getElementById('info-bar')?.textContent,volume:window.__kaminosVolumePrototype?.debugState?.()}));}catch(e){r.captureError=String(e);}await fs.writeFile(path.join(v.out,'failure.json'),JSON.stringify({phase:r.phase,error:r.error}));}
finally {if(browser)await browser.close();if(lease)try{r.release=JSON.parse(execFileSync(v.greenroom,['lease','release',lease,'--released-by',v.owner,'--reason','placement witness terminal; owned browser closed'],{encoding:'utf8'}));}catch(e){r.releaseError=String(e);process.exitCode=1;}r.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:r.status,phase:r.phase,report:path.join(v.out,'report.json')}));}
