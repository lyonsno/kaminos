import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];
const out=resolve(args.out);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'inputs',requested:args,captures:[],errors:[]};
const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
let context,profile,page;persist();
try{
 const setup=JSON.parse(readFileSync(args.setup));
 const url=new URL('/index.html',args.base);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','marionette/paw-articulation');url.searchParams.set('experiment_inputs',JSON.stringify(setup));report.url=url.href;
 const {chromium}=await import(args.playwright);const executable=realpathSync(args.chrome);assert.ok(!executable.includes('/Applications/Google Chrome.app/'));
 profile=mkdtempSync(join(tmpdir(),'marionette-paw-cft-'));report.effectiveExecutable=executable;report.profile=profile;
 report.phase='browser';context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,viewport:{width:1600,height:1100},args:['--use-mock-keychain','--password-store=basic','--no-first-run']});
 page=context.pages()[0]??await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 report.phase='load';await page.goto(url.href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='marionette/paw-articulation');
 report.runtime=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());assert.equal(report.runtime.source.repoRoot,realpathSync(args.root));
 const file='experiments/creature-motion/paw-articulation.experiment.mjs',response=await page.request.get(new URL('/'+file,url).href);
 const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(await response.body()),sha(readFileSync(join(args.root,file))));
 const invoke=(name,value)=>page.evaluate(({name,value})=>window.kaminosWorkbenchExperiments.invoke(name,value),{name,value});
 const read=()=>invoke('inspect');
 const capture=async name=>{await page.screenshot({path:join(out,name+'.png')});report.captures.push(name+'.png');};
 report.phase='neutral';const neutral=await read();writeFileSync(join(out,'neutral.json'),JSON.stringify(neutral));
 assert.deepEqual(neutral.bodies.map(b=>b.bones),[28,32]);assert.ok(neutral.registration?.some(r=>r.id===neutral.objectId&&r.objectVisible));
 assert.equal(neutral.bodies[0].caseSha256,setup.casts[0].original.case_sha256);assert.equal(neutral.bodies[1].caseSha256,setup.casts[0].candidate.case_sha256);
 assert.ok(neutral.geometry.every(a=>a.length>0&&a.every(Number.isFinite)));await capture('neutral');
 report.phase='articulation';report.poses=[];
 for(const joint of ['forelimb-left-toe','forelimb-right-toe','hindlimb-left-toe','hindlimb-right-toe']){
  await invoke('pose',{joint,angle:25});const posed=await read();writeFileSync(join(out,joint+'.json'),JSON.stringify(posed));
  assert.ok(posed.geometry.every(a=>a.every(Number.isFinite)));assert.ok(posed.geometry[1].some((v,i)=>Math.abs(v-neutral.geometry[1][i])>1e-5));
  report.poses.push({joint,bodies:posed.bodies});
 }
 await capture('hind-paw-flex');
 report.phase='controls';await page.getByLabel('Paw joint',{exact:true}).selectOption('forelimb-left-toe');
 await page.getByLabel('Toe rotation degrees',{exact:true}).fill('-25');await page.getByLabel('Toe rotation degrees',{exact:true}).press('Tab');
 assert.equal((await read()).angle,-25);await capture('fore-paw-flex');
 const held=await read();await assert.rejects(()=>invoke('pose',{joint:'wrong-joint',angle:20}));assert.equal((await read()).angle,held.angle);
 await page.getByRole('button',{name:'Neutral',exact:true}).click();const reset=await read();assert.deepEqual(reset.geometry,neutral.geometry);
 report.phase='reopen';await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='marionette/paw-articulation');
 assert.deepEqual((await read()).bodies.map(b=>b.bones),[28,32]);await capture('reopened');
 report.phase='close';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 assert.equal((await page.evaluate(()=>window.kaminosSceneObjectDebugState())).some(r=>r.id===neutral.objectId),false);
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.error=error.stack;if(page){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});report.failureState=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText})).catch(e=>({error:e.message}));}throw error;}
finally{if(context)await context.close();if(profile)rmSync(profile,{recursive:true});persist();}
