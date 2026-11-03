// Normal scene, frozen simulation: only the diagnostic display changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [origin,out,basin,executable,playwright]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source-identity',source:null,origin,executable,errors:[],views:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await save();let browser,page;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.phase='launch';await save();
 assert.ok(executable&&!executable.includes('/Google Chrome.app/'));
 const {chromium}=await import(playwright);
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport:{width:1200,height:850}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.runtime=await (await page.request.get(`${origin}/api/runtime-config`)).json();assert.equal(report.runtime.source.repoRoot,process.cwd());assert.equal(report.runtime.source.commit,report.source);
 report.phase='load';await save();await page.goto(`${origin}/index.html?workspace=authoring`);
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),basin);
 const control=async(id,value)=>page.evaluate(({id,value})=>{const c=document.getElementById(id);if(!c)throw Error(`Missing ${id}`);c.value=value;c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));assertValue();function assertValue(){if(c.value!==value)throw Error('Rejected control');}},{id,value:String(value)});
 await control('volume-render-scale',.5);await control('volume-steps',64);await control('volume-look-freeze',0);await control('volume-world-smoke','on');
 await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[10,6,13],target:[0,3,0]});});
 report.phase='settle';await save();await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState?.().worldSmoke?.steps>=180);
 await control('volume-look-freeze',1);
 const read=()=>page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
 report.state=await read();assert.ok(/^webgpu:/i.test(report.state.backend)&&!/swiftshader|software/i.test(report.state.backend));
 for(const mode of ['off','bounds','contributions','off']){
  report.phase=mode;await save();
  await page.locator('#selected-world-smoke-overlay').selectOption(mode);
  await page.waitForFunction(mode=>window.__kaminosVolumePrototype.debugState().worldSmokeOverlay===mode,mode);
  await page.locator('#selected-world-smoke-overlay').scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const state=await read();assert.equal(state.simStepCount,report.state.simStepCount,'overlay must not step or reset simulation');
  const view={mode,legend:await page.locator('#world-smoke-overlay-legend').textContent(),step:state.simStepCount,path:`${out}/${report.views.length}-${mode}.png`};
  assert.match(view.legend,/World volume 27× fine/);await page.screenshot({path:view.path});report.views.push(view);
 }
 report.phase='world-disabled';await control('volume-world-smoke','off');await control('volume-look-freeze',0);
 await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().worldSmoke?.effective==='off');
 await page.locator('#selected-world-smoke-overlay').selectOption('contributions');
 assert.match(await page.locator('#world-smoke-overlay-legend').textContent(),/Awaiting active world field/);
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;if(page)try{await page.screenshot({path:`${out}/failure.png`});}catch{}}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
