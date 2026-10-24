// Ordinary visual/integration smoke; intentionally makes no timing claim.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),origin=args.get('--url'),repo=resolve(args.get('--repo'));
mkdirSync(out,{recursive:true});const report={status:'running',phase:'identity',requested:{origin,repo},errors:[]};let browser,page;
const write=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));write();
try{
 report.server=await verifyAuthoringServer({origin,repoRoot:repo});
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:resolve(out,'profile'),width:1440,height:1000});
 const {chromium}=await import(args.get('--playwright'));
 browser=await chromium.launchPersistentContext(report.launch.args.find(v=>v.startsWith('--user-data-dir=')).slice(16),{executablePath:report.launch.executable,headless:true,viewport:{width:1440,height:1000},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=browser.pages()[0];page.on('pageerror',e=>report.errors.push(String(e)));
 report.phase='opening';await page.goto(new URL('/?workspace=workbench&experiment=ash-deposition',origin).href);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-deposition');
 report.effective={url:page.url(),mount:await page.evaluate(()=>window.kaminosWorkbenchExperiments.state())};
 const invoke=(name,input)=>page.evaluate(([n,i])=>window.kaminosWorkbenchExperiments.invoke(n,i),[name,input]);
 report.initial=await invoke('read');write();assert.equal(report.initial.collision.valid,true);assert.equal(report.initial.collision.backend,'gpu');
 await page.screenshot({path:resolve(out,'empty.png')});
 if(args.get('--negative-unmounted')==='yes'){await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await invoke('read');throw Error('Negative control incorrectly accepted an unmounted experiment');}
 report.phase='deposition';write();await invoke('deposit',{amount:600,radius:.55});
 await page.evaluate(async()=>{while((await window.kaminosWorkbenchExperiments.read()).activeCells>0)await new Promise(requestAnimationFrame);});
 report.settled=await invoke('read');assert.equal(report.settled.activeCells,0);assert.ok(Math.abs(report.settled.mass-600)<1e-6);assert.ok(report.settled.visibleBlocks>0);
 await page.screenshot({path:resolve(out,'settled.png')});
 report.phase='contact';await invoke('play',false);report.contact=await invoke('press',{radius:.25});assert.ok(report.contact.lastContact.displaced>0);assert.ok(Math.abs(report.contact.mass-600)<1e-6);
 await page.screenshot({path:resolve(out,'contact.png')});
 const checkpoint=await invoke('checkpoint');writeFileSync(resolve(out,'checkpoint.json'),JSON.stringify(checkpoint));
 report.phase='fresh-page-restore';await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-deposition');await invoke('play',false);
 await invoke('restore',checkpoint);assert.deepEqual(await invoke('checkpoint'),checkpoint);
 report.restored=await invoke('read');await page.screenshot({path:resolve(out,'restored.png')});
 const bad=structuredClone(checkpoint);bad.identity.cellSize*=2;let rejected=false;try{await invoke('restore',bad);}catch{rejected=true;}assert.ok(rejected);assert.deepEqual(await invoke('checkpoint'),checkpoint);
 report.phase='continued-deposition';await invoke('deposit',{amount:60,radius:.4});report.continued=await invoke('read');assert.ok(Math.abs(report.continued.mass-660)<1e-6);
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastPage=await page.evaluate(()=>({text:document.body.innerText,mount:window.kaminosWorkbenchExperiments?.state()})).catch(String);await page.screenshot({path:resolve(out,'failed.png')}).catch(()=>{});}process.exitCode=1;
}finally{await browser?.close();report.browserClosed=true;write();console.log(JSON.stringify({status:report.status,phase:report.phase,report:resolve(out,'report.json'),error:report.error}));}
