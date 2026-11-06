// kaminos-test: manual — requires a served checkout, isolated preferences file, Playwright and independent browser
// Arguments keep the host, evidence and runtime explicit.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [origin,out,expectedRoot,playwrightModule,executable,baselineUI]=process.argv.slice(2);
assert.ok(origin&&out&&expectedRoot&&playwrightModule&&executable,'origin out repo-root playwright-module independent-browser [baseline-ui]');
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(out+'/browser-');
const report={status:'running',phase:'launch',origin,expectedRoot,executable,profile,baselineUI,errors:[]};let browser;
const seed={schema:'kaminos.preferences.v1',sceneDefaults:{environment:{name:'studio',exposure:1},postprocessing:{sceneGI:{resolutionScale:.1,slices:1,steps:3}}},agentSceneDefaults:null,navigationInput:null,startupConfigured:true};
try{
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 // Only run against an explicitly isolated preference store.
 const initial=await(await fetch(origin+'/api/preferences')).json();report.storePath=initial.storePath;
 assert.ok(initial.storePath.startsWith(out+'/'),'browser conformance must not replace operator preferences');
 const seeded=await fetch(origin+'/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:initial.revision,preferences:seed})});assert.equal(seeded.status,200);
 const {chromium}=await import(playwrightModule);
 browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,viewport:{width:1040,height:800},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-angle=metal']});
 const page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',error=>{report.errors.push(String(error));console.error('PAGE',String(error));});
 if(baselineUI)await page.route('**/user-preferences-ui.mjs',async route=>route.fulfill({contentType:'text/javascript',body:await fs.readFile(baselineUI,'utf8')}));
 report.phase='open';console.log('Opening actual preferences');await page.goto(origin+'/#workspace=authoring');await page.waitForFunction(()=>window.kaminosPreferences?.startup().settled);
 await page.keyboard.press('Meta+,');await page.waitForFunction(()=>document.querySelector('#kaminos-preferences')?.open&&document.querySelector('#preferences-save')?.disabled===false);
 assert.equal(await page.locator('#preference-default-target').count(),1,'Preferences must offer the agent default authoring target');
 report.phase='author';console.log('Authoring agent defaults');await page.locator('#preference-default-target').selectOption('agentSceneDefaults');
 assert.equal(await page.locator('#preference-agent-inherit').isChecked(),true);
 await page.locator('[data-action=capture]').click();assert.equal(await page.locator('#preference-agent-inherit').isChecked(),false,'capturing inherited defaults must visibly author an agent default');
 const gi={mode:'combined',view:'scene',gain:1.25,radius:2.72,thickness:.27,slices:2,steps:6,resolutionScale:.1,denoise:2,temporal:true,temporalRefine:true,bounceFeedback:true,temporalWeight:.91,estimator:{expFactor:2.15,backfaceLighting:.2,screenSpaceSampling:false,mipSampling:true,perspectiveReconstruction:true,linearThickness:true,depthPhi:.0123,normalPhi:5.25,lumaPhi:1,aoContrast:1.35}};
 const pathInput=path=>page.locator('[data-preference-path="'+path+'"]');
 async function write(path,value){const input=pathInput(path);if(typeof value==='boolean')await input.setChecked(value);else if(await input.evaluate(node=>node.tagName==='SELECT'))await input.selectOption(value);else{await input.click();await input.fill(String(value));}}
 await page.locator('#preference-auto-scene-scale').uncheck();
 for(const [key,value] of Object.entries(gi))if(key==='estimator'){for(const [name,item]of Object.entries(value))await write('postprocessing.sceneGI.estimator.'+name,item);}else await write('postprocessing.sceneGI.'+key,value);
 await write('postprocessing.ao.enabled',true);await write('postprocessing.ao.intensity',.654321);
 await write('postprocessing.sceneGI.mode','gtao');assert.equal(await pathInput('postprocessing.ao.radius').isVisible(),true);assert.equal(await pathInput('postprocessing.sceneGI.steps').isVisible(),false);
 for(const [key,value]of Object.entries({radius:7.123,scale:.75,thickness:1.45,falloff:.37}))await write('postprocessing.ao.'+key,value);
 await write('postprocessing.sceneGI.mode','combined');assert.equal(await pathInput('postprocessing.ao.radius').isVisible(),false);
 assert.equal(await pathInput('postprocessing.sceneGI.estimator.aoContrast').isVisible(),true);
 await write('postprocessing.sceneGI.estimator.aoContrast',-1);assert.equal(await pathInput('postprocessing.sceneGI.estimator.aoContrast').evaluate(node=>node.validity.valid),false);await write('postprocessing.sceneGI.estimator.aoContrast',1.35);
 // Automatic scale preserves the tune while leaving each scene's world scale to calibration.
 await page.locator('#preference-auto-scene-scale').check();delete gi.radius;delete gi.thickness;
 await page.locator('#preferences-save').click();await page.waitForFunction(()=>document.querySelector('#preferences-status')?.textContent.startsWith('Saved new-scene'));
 report.saved=await page.evaluate(()=>window.kaminosPreferences.read().receipt.preferences);
 assert.deepEqual(report.saved.agentSceneDefaults.postprocessing.sceneGI,gi);assert.equal(report.saved.agentSceneDefaults.postprocessing.ao.intensity,.654321);
 assert.equal(report.saved.agentSceneDefaults.postprocessing.ao.radius,7.123);assert.equal(report.saved.sceneDefaults.postprocessing.sceneGI.slices,1,'agent edits must not change ordinary defaults');
 report.phase='reopen';console.log('Reopening saved preferences');await page.evaluate(()=>window.kaminosPreferences.close());await page.keyboard.press('Meta+,');await page.waitForFunction(()=>document.querySelector('#preferences-save')?.disabled===false);
 for(const [key,value]of Object.entries(gi))if(key==='estimator'){for(const [name,item]of Object.entries(value))assert.equal(await pathInput('postprocessing.sceneGI.estimator.'+name).evaluate(node=>node.type==='checkbox'?node.checked:node.value),typeof item==='boolean'?item:String(item));}else assert.equal(await pathInput('postprocessing.sceneGI.'+key).evaluate(node=>node.type==='checkbox'?node.checked:node.value),typeof value==='boolean'?value:String(value));
 assert.equal(await page.locator('#preference-auto-scene-scale').isChecked(),true);
 const misplaced=await page.locator('#kaminos-preferences .authoring-number-wrap').evaluateAll(wrappers=>wrappers.filter(wrapper=>{const input=wrapper.querySelector('input').getBoundingClientRect(),display=wrapper.querySelector('.authoring-number-display').getBoundingClientRect();return input.width>0&&(display.left<input.left-1||display.right>input.right+1);}).length);assert.equal(misplaced,0,'numeric readouts must stay inside their input hit targets');
 await page.locator('[data-preference-path="postprocessing.sceneGI.steps"]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/preferences-agent.png'});
 await page.locator('[data-preference-path="postprocessing.sceneGI.estimator.aoContrast"]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/preferences-ao.png'});
 report.phase='agent-consumer';console.log('Exercising Workbench consumer');await page.goto(origin+'/?defaults=agent&workspace=workbench&experiment=material-study&experiment_inputs='+encodeURIComponent(JSON.stringify({roughness:.8})));
 await page.waitForFunction(()=>window.kaminosPreferences?.startup().settled&&window.kaminosWorkbenchExperiments?.state().id==='material-study');
 report.startup=await page.evaluate(()=>window.kaminosPreferences.startup());report.effective=await page.evaluate(()=>window.kaminosSceneGIDebugState());report.experiment=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 assert.equal(report.startup.usesDefaults,true);assert.equal(report.startup.effective,'agent');assert.equal(report.effective.resolutionScale,.1);assert.equal(report.effective.steps,6);assert.equal(report.effective.slices,2);assert.equal(report.effective.estimator.aoContrast,1.35);assert.equal(report.experiment.roughness,.8);
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await fs.writeFile(out+'/preferences-browser-report.json',JSON.stringify(report,null,2));await browser?.close();await fs.rm(profile,{recursive:true,force:true});}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,errors:report.errors}));
