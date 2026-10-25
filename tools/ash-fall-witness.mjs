// Actual Workbench consumer; every failure retains route identity and terminal evidence.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),origin=args.get('--url'),repo=resolve(args.get('--repo')),cellSize=Number(args.get('--cell-size')??.03);
mkdirSync(out,{recursive:true});let browser,page;
const report={status:'running',phase:'identity',requested:{origin,repo,cellSize},errors:[],consoleErrors:[],frames:[],interventions:[]};
const write=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));write();
try{
 report.server=await verifyAuthoringServer({origin,repoRoot:repo});report.hashes={};
 for(const path of ['tools/ash-fall-witness.mjs','ash/gpu-patch.mjs','ash/fall-gpu.mjs','ash/fall-plan.mjs','experiments/ash-gpu-deposition.experiment.mjs']){const response=await fetch(new URL(path,origin));assert.ok(response.ok);const hash=b=>createHash('sha256').update(b).digest('hex'),served=hash(Buffer.from(await response.arrayBuffer()));assert.equal(served,hash(readFileSync(resolve(repo,path))));report.hashes[path]=served;}
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:resolve(out,'profile'),width:1440,height:1000});
 const {chromium}=await import(args.get('--playwright'));browser=await chromium.launchPersistentContext(resolve(out,'profile'),{executablePath:report.launch.executable,headless:true,viewport:{width:1440,height:1000},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 if(args.get('--negative-frozen')==='yes'){
  const sourcePath=resolve(repo,'ash/fall-gpu.mjs'),original=readFileSync(sourcePath,'utf8');
  const needle='pass.dispatchWorkgroups(Math.ceil(capacity/64));',replacement='if(!globalThis.__ashFallWitnessFreeze)pass.dispatchWorkgroups(Math.ceil(capacity/64));';
  assert.ok(original.includes(needle),'fault injector must identify transport dispatch');const injected=original.replace(needle,replacement);writeFileSync(resolve(out,'injected-fall-gpu.mjs'),injected);
  report.faultInjection={kind:'suppress transport dispatch after initial release',originalSha256:createHash('sha256').update(original).digest('hex'),effectiveSha256:createHash('sha256').update(injected).digest('hex'),active:false};
  await browser.route('**/ash/fall-gpu.mjs',route=>route.fulfill({status:200,contentType:'text/javascript',body:injected}));
 }
 page=browser.pages()[0];page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const invoke=async(name,input)=>{report.interventions.push({name,input:name==='restore'?'retained checkpoint':input});write();return page.evaluate(([n,i])=>window.kaminosWorkbenchExperiments.invoke(n,i),[name,input]);};
 const url=new URL('/?workspace=workbench&experiment=ash-gpu-deposition',origin);url.searchParams.set('experiment_inputs',JSON.stringify({cellSize}));
 report.phase='mount';await page.goto(url.href);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-gpu-deposition'||document.body.innerText.includes('Experiments unavailable:'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-gpu-deposition');
 await invoke('play',false);report.initial=await invoke('read');assert.equal(report.initial.backend,'webgpu-pair-exchange');assert.equal(report.initial.falling.backend,'webgpu-ballistic-parcels');assert.equal(report.initial.layout.cellSize,cellSize);
 const snapshot=async name=>{const s=await invoke('snapshot');writeFileSync(resolve(out,name+'.json'),JSON.stringify(s));assert.ok(Math.abs(s.patch.retainedVolume-s.patch.volume)<Math.max(1e-7,s.patch.volume*1e-4),'all introduced material must remain deposited, airborne, or pending');return s;};
 const capture=async name=>{await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});await invoke('settleFrame');const state=await invoke('read');assert.deepEqual(state.errors,[]);await page.screenshot({path:resolve(out,name+'.png')});report.frames.push({name,state});write();};
 await capture('00-empty');const emptyPixels=await page.locator('#kaminos-host-renderer-canvas').screenshot();
 report.phase='burst';const volume=page.getByRole('spinbutton',{name:'Burst volume',exact:true});await volume.click();await volume.fill('.06');await volume.press('Tab');await page.getByRole('button',{name:'Release ash',exact:true}).click();await invoke('advance',{steps:1});
 const airborne=await snapshot('01-airborne');assert.ok(airborne.patch.falling.particles.some((v,i)=>i%8===3&&v>0),'burst must create actual airborne parcels');assert.equal(airborne.patch.depositedVolume,0);if(args.get('--negative-hidden')==='yes')await invoke('visibility',false);await capture('01-airborne');
 const airbornePixels=await page.locator('#kaminos-host-renderer-canvas').screenshot();
 report.airborneChangedPixels=await page.evaluate(async([a,b])=>{const decode=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height).data;};const x=await decode(a),y=await decode(b);let changed=0;for(let i=0;i<x.length;i+=4)if(Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])>20)changed++;return changed;},[emptyPixels.toString('base64'),airbornePixels.toString('base64')]);assert.ok(report.airborneChangedPixels>40,'actual canvas must show airborne ash');
 if(args.get('--negative-frozen')==='yes'){await page.evaluate(()=>{globalThis.__ashFallWitnessFreeze=true;});report.faultInjection.active=true;write();}
 for(let i=1;i<=6;i++){await invoke('advance',{steps:10});const progress=await snapshot('fall-'+i);if(i===1){assert.ok(progress.patch.steps>airborne.patch.steps,'advance must execute before motion is judged');assert.notDeepEqual(progress.patch.falling.particles,airborne.patch.falling.particles,'requested advancement must move airborne ash');}await capture('fall-'+i);}
 const settled=await snapshot('settled');assert.ok(settled.patch.depositedVolume>settled.patch.volume*.75,'most released ash must reach the pile; parcels deflected by contact remain conserved');assert.ok(Math.abs(settled.patch.volume-.06)<1e-8);
 report.phase='continued-emission';await invoke('setSource',{position:[.35,report.initial.identity.groundY+1.15,1.05],rate:.012,spread:.22});await page.getByRole('button',{name:'Start emitting',exact:true}).click();await invoke('advance',{steps:30});await capture('08-source-moved');const emitting=await snapshot('emitting');assert.ok(emitting.patch.volume>.0719&&emitting.patch.volume<.0721);assert.ok(emitting.patch.falling.particles.some((v,i)=>i%8===3&&v>0));
 report.phase='continuation';await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-gpu-deposition');await invoke('play',false);await invoke('restore',emitting);const restored=await snapshot('restored');assert.deepEqual(restored.patch.values,emitting.patch.values);assert.deepEqual(restored.patch.falling,emitting.patch.falling);for(const key of ['position','rate','spread','emitting'])assert.deepEqual(restored.emitter[key],emitting.emitter[key]);report.restoredEmitterIds={before:emitting.emitter.objectId,after:restored.emitter.objectId};await capture('09-restored-in-flight');await invoke('emit',false);
 report.phase='live';const beforeLive=(await invoke('read')).steps;await invoke('play',true);report.liveFrames=await page.evaluate(async()=>{const frames=[];for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);frames.push(await window.kaminosWorkbenchExperiments.read());}return frames;});await invoke('play',false);assert.ok((await invoke('read')).steps>beforeLive+2,'ordinary host frames must advance fallout');await capture('10-live-fall');
 report.phase='contact';await invoke('moveContact',{position:[-.5,report.initial.identity.groundY+.10,1.0],radius:.18});for(let i=0;i<=6;i++){await invoke('moveContact',{position:[-.5+i*.15,report.initial.identity.groundY+.10,1.0]});await invoke('advance',{steps:4});await capture('contact-'+i);}
 const final=await snapshot('final');report.mass={introduced:final.patch.volume,retained:final.patch.retainedVolume,deposited:final.patch.depositedVolume};assert.ok(final.patch.depositedVolume>.06);
 const bad=structuredClone(final);bad.patch.falling.state[0]=0x7fc00000;await assert.rejects(()=>invoke('restore',bad));assert.deepEqual((await snapshot('after-rejected-restore')).patch.values,final.patch.values);
 if(args.get('--profile')==='yes'){
  report.phase='profile';report.profile={};await invoke('emit',false);await invoke('advance',{steps:90});report.profile.rest=await invoke('profile',{samples:24});report.profile.contact=await invoke('profile',{samples:24,transport:false,motion:true});await invoke('emit',true);report.profile.emitting=await invoke('profile',{samples:24});await invoke('emit',false);
  // Full displayed frames, including GPU completion, retained separately from compute timestamps.
  for(const [name,visible,playing,emission] of [['scene',false,false,false],['rest',true,true,false],['fall',true,true,true]]){
   await invoke('visibility',visible);await invoke('emit',emission);await invoke('play',playing);await page.evaluate(async()=>{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);});
   report.profile[name+'Frames']=await page.evaluate(async()=>{const samples=[];let previous=performance.now();for(let i=0;i<36;i++){await new Promise(requestAnimationFrame);await window.kaminosWorkbenchExperiments.invoke('settleFrame');const now=performance.now();samples.push(now-previous);previous=now;}return samples;});
  }
  await invoke('emit',false);await invoke('play',false);await invoke('visibility',true);
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastPage=await page.evaluate(()=>({text:document.body.innerText,mount:window.kaminosWorkbenchExperiments?.state()})).catch(String);await page.screenshot({path:resolve(out,'failed.png')}).catch(()=>{});}process.exitCode=1;
}finally{await browser?.close();report.browserClosed=true;write();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}
