import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {materialComponents} from '../structural-material-solid-surface.mjs';
import {elasticSupportBonds,buildFixedCellShell,visibleFixedCellFaces} from '../structural-material-bounded-fragments.mjs';
import {buildAxialChunkFixture} from '../structural-material-stone-fixture.js';
import {requireChunkStage,requireMovedPieceFracture,requireStoneProducerParticipation,requirePublishedStoneSurface} from './stone-chunk-chain-evidence.mjs';

const [url,out,playwrightPath,executable,compositionPath]=process.argv.slice(2);
if(!out)throw Error('Explicit persistent output required');
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'setup',url,inputs:[],checks:[],errors:[],claim:'Procedural axial detach, translation and repeated injury control; not tumbling, calibrated stone or a performance ceiling'};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,passed,detail)=>{report.checks.push({name,passed:Boolean(passed),detail});save();if(!passed)throw Error(name);};
let browser,page;save();
try{
 report.source=JSON.parse(fs.readFileSync(compositionPath));
 for(const file of ['structural-material-stone-fixture.js','structural-material-solid-topology.mjs','structural-material-coherent-chunks-gpu.js','structural-material-chunk-integration.js','dist/structural-material-chunk-integration.js','tools/stone-chunk-chain-evidence.mjs','tools/stone-chunk-smoke.mjs'])report.source.stoneFiles[file]=createHash('sha256').update(fs.readFileSync(path.join(report.source.stoneRoot,file))).digest('hex');
 report.browser={executable:fs.realpathSync(executable)};
 check('independent browser',!report.browser.executable.includes('/Google Chrome.app/'));
 const {chromium}=await import(pathToFileURL(playwrightPath));
 report.browser.profile=path.resolve(out,'browser-profile');report.browser.args=['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal','--use-mock-keychain','--password-store=basic'];save();
 browser=await chromium.launchPersistentContext(report.browser.profile,{executablePath:report.browser.executable,headless:true,viewport:{width:1440,height:1000},args:report.browser.args});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);
 const producerFixture=process.env.STONE_PARTICIPATION==='producer';
 if(process.env.STONE_PARTICIPATION&&!producerFixture)throw Error('Unknown smoke participation');
 if(producerFixture){
  const original=fs.readFileSync(path.join(report.source.stoneRoot,'structural-material-workbench-host.mjs'),'utf8'),anchor="async options=>(await import('./structural-material-shard-view.js')).createStoneRuntime(options)";
  if(original.split(anchor).length!==2)throw Error('Exact producer fixture factory anchor required');
  const effective=original.replace(anchor,`async options=>{const {createStoneRuntime}=await import('./structural-material-shard-view.js');const api=await createStoneRuntime({...options,participation:'producer'});const proof={...api.viewport,callbacks:window.__stoneSharedHost.identity().callbacks,scene:options.host.scene.uuid,roots:api.roots.map(root=>({id:root.uuid,parentBefore:root.parent?.uuid??null}))};for(const root of api.roots)options.host.scene.add(root);proof.roots.forEach((entry,i)=>entry.parentAfter=api.roots[i].parent?.uuid??null);window.__stoneProducerFixture={proof,api,host:options.host};return api;}`);
  fs.writeFileSync(path.join(out,'producer-fixture-host.mjs'),effective);report.producerFixture={claim:'actual-producer-with-derived-mount-fixture-not-common-scene-session-adoption',sourceSha256:createHash('sha256').update(original).digest('hex'),effectiveSha256:createHash('sha256').update(effective).digest('hex')};save();
  await page.route('**/__stone/structural-material-workbench-host.mjs',route=>route.fulfill({body:effective,contentType:'text/javascript'}));
 }
 let rejectLoad;const failure=new Promise((_,reject)=>{rejectLoad=reject;});failure.catch(()=>{});
 page.on('pageerror',e=>{report.errors.push(e.message);save();rejectLoad(e);});
 page.on('console',m=>{if(m.type()==='error'){(report.consoleErrors??=[]).push(m.text());save();if(/WebGPU|shader|WGSL|validation/i.test(m.text()))rejectLoad(Error(m.text()));}});
 page.on('response',r=>{if(r.status()>=400){(report.httpFailures??=[]).push({status:r.status(),url:r.url()});save();if(r.request().resourceType()==='script')rejectLoad(Error(`Module ${r.status()}: ${r.url()}`));}});
 report.phase='load';save();await page.goto(url);
 const loaded=await Promise.race([page.waitForFunction(()=>{if(window.__stoneSharedHost?.runtime())return{loaded:true};const t=document.querySelector('.owner-experiment-status')?.textContent;return t&&!t.startsWith('Opening ')&&t!=='Stone fracture'?{failure:t}:false;}),failure]);
 const load=await loaded.jsonValue();if(load.failure)throw Error(load.failure);
 if(producerFixture){report.producerFixture.effective=await page.evaluate(()=>window.__stoneProducerFixture?.proof);requireStoneProducerParticipation(report.producerFixture.effective);check('effective manual producer and unparented mount',true,report.producerFixture.effective);}
 const invoke=async(name,input)=>{report.inputs.push({name,input});save();return page.evaluate(async({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});};
 await invoke('hold');
 for(const [file,sha] of Object.entries(report.source.stoneFiles)){const response=await page.request.get(new URL('/__stone/'+file,url).href);check('source '+file,response.ok()&&createHash('sha256').update(await response.body()).digest('hex')===sha);}
 const fixture=buildAxialChunkFixture();
 const acquire=async name=>{
  await page.evaluate(async producerFixture=>{const api=window.__stoneSharedHost.runtime();await api.settle({surface:false});if(producerFixture){if(api.publish().status!=='published')throw Error('Manual publication incomplete');window._kaminosDirty?.();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}},producerFixture);
  const stage=await page.evaluate(async()=>{const r=window.__stoneSharedHost.runtime();return{status:r.experimentStatus(),witness:r.witness({resources:false}),motion:await r.coherentMotion()};});
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(stage));
  requireChunkStage({status:stage.status,state:stage.witness.state,motion:stage.motion});
  const s=stage.witness.state,labels=materialComponents(s.model.points,elasticSupportBonds(fixture.tetrahedra,s.bonds,s.stresses)),groups=new Map();
  labels.forEach((root,i)=>{if(!groups.has(root))groups.set(root,[]);groups.get(root).push(i);});
  stage.groups=[...groups.values()];report.lastTrustworthy={stage:name,runId:s.runId,steps:s.steps};save();
  if(producerFixture){const publication=await page.evaluate(async()=>{const api=window.__stoneSharedHost.runtime();return{surface:await api.surfacePositions(),counts:await api.exposedFaceCounts()};});fs.writeFileSync(path.join(out,name+'.publication.json'),JSON.stringify(publication));const shell=buildFixedCellShell({...fixture,bonds:s.bonds}),expected=visibleFixedCellFaces(shell,elasticSupportBonds(fixture.tetrahedra,s.bonds,s.stresses)).length;check('matching published pose and exposed topology '+name,true,requirePublishedStoneSurface(publication.surface,publication.counts,s,expected));}
  await page.screenshot({path:path.join(out,name+'.png')});return stage;
 };
 const point=(s,i)=>s.state.slice(i*16+4,i*16+7),dead=s=>s.bonds.filter((v,i)=>i%4===2&&v===0).length;
 const center=(s,nodes)=>[0,1,2].map(k=>nodes.reduce((sum,i)=>sum+point(s,i)[k],0)/nodes.length);
 report.phase='intact';const intact=await acquire('intact');report.effective=intact.status;
 check('one initial attached component',intact.groups.length===1);
 report.phase='axial-injury';const first=await page.evaluate(()=>window.__stoneSharedHost.runtime().rayPick([10,.13,.07],[-1,0,0]));report.firstPick=first;save();check('native right lobe contact',first?.faceIndex>=0);
 await invoke('grip',{pieceId:0,...first});await invoke('move',[.12,0,0]);await invoke('step',20);await invoke('release');await invoke('step',1);
 const detached=await acquire('detached'),s=detached.witness.state;
 const candidates=detached.groups.filter(g=>g.length>20&&!g.some(i=>s.state[i*16+11]===1));
 const nodes=candidates.reduce((a,b)=>a.length>b.length?a:b,[]);report.detached={nodes,groupSizes:detached.groups.map(g=>g.length),deadBonds:dead(s)};save();
 check('substantial material lobe separated',nodes.length>20&&dead(s)>0,report.detached);
 const owner=detached.motion.ownership[nodes[0]*4+3];check('whole component coherently owned',owner>0&&nodes.every(i=>detached.motion.ownership[i*4+3]===owner));
 report.phase='translation';await page.evaluate(()=>window.__stoneSharedHost.runtime().fixtureGravity(9.81));await invoke('step',12);
 const moved=await acquire('moved'),ms=moved.witness.state,a=center(s,nodes),b=center(ms,nodes);
 const shapeError=Math.max(...nodes.flatMap(i=>point(ms,i).map((v,k)=>Math.abs((v-b[k])-(point(s,i)[k]-a[k])))));
 check('acquired shape retained during motion',shapeError<3e-5,{shapeError});
 check('material center actually moved',Math.hypot(...a.map((v,k)=>v-b[k]))>.005,{before:a,after:b});
 check('free motion preserves damage',s.bonds.every((v,i)=>i%4!==2||v===ms.bonds[i]));
 report.phase='floor-contact';await invoke('step',60);const landed=await acquire('landed'),ls=landed.witness.state,lc=center(ls,nodes);
 const floorSurface=await page.evaluate(()=>window.__stoneSharedHost.runtime().surfacePositions());fs.writeFileSync(path.join(out,'landed.surface.json'),JSON.stringify(floorSurface));
 const low=Math.min(...floorSurface.flatMap(p=>p.gpu.map(v=>v[1])));
 check('finite-cell floor prevents surface penetration',low>=-1-3e-5,{localFloor:-1,minimumSurfaceY:low});
 check('coherent lobe reached the floor',Math.min(...nodes.map(i=>point(ls,i)[1]))<-.65);
 const landedError=Math.max(...nodes.flatMap(i=>point(ls,i).map((v,k)=>Math.abs((v-lc[k])-(point(s,i)[k]-a[k])))));
 check('contact retains acquired component shape',landedError<3e-5,{shapeError:landedError});
 report.phase='secondary-injury';await page.evaluate(()=>window.__stoneSharedHost.runtime().fixtureGravity(0));
 const second=await page.evaluate(c=>window.__stoneSharedHost.runtime().rayPick([c[0],c[1],10],[0,0,-1]),lc);report.secondPick=second;save();check('moved material native contact',second?.faceIndex>=0);
 await invoke('grip',{pieceId:0,...second});
 const held=await acquire('second-down');check('contact belongs to moved lobe',nodes.includes(held.witness.lastPick?.cellAnchor),held.witness.lastPick);
 check('grip begins without rest pose snap',nodes.every(i=>point(held.witness.state,i).every((v,k)=>Math.abs(v-point(ls,i)[k])<3e-5)));
 await invoke('step',1);const awake=await acquire('awake');check('gripped component resumes material solve',nodes.every(i=>awake.motion.ownership[i*4+3]===0));
 await invoke('tension',180);await invoke('move',[0,.5,0]);await invoke('step',20);await invoke('release');await invoke('step',1);
 const repeated=await acquire('refractured'),rs=repeated.witness.state;
 check('prior damage retained',s.bonds.every((v,i)=>i%4!==2||v!==0||rs.bonds[i]===0));
 const {inside:additional,outside}=requireMovedPieceFracture(awake.witness.state,rs,nodes);report.secondaryFracture={inside:additional.length,outside:outside.length};
 check('same moved lobe fractures internally again',additional.length>0,{additional});report.additional=additional;
 if(producerFixture){report.phase='producer-shutdown';report.producerShutdown=await page.evaluate(async()=>{const {api,host}=window.__stoneProducerFixture,parents=api.roots.map(root=>root.parent?.uuid);const stopped=await api.quiesce(),retained=api.roots.every((root,i)=>root.parent?.uuid===parents[i]);let refused=false;try{await api.advance();}catch(error){refused=/closed/.test(error.message);}await api.dispose();host.renderer.render(host.scene,host.camera);await host.device.queue.onSubmittedWorkDone();return {stopped,retained,refused,removed:api.roots.every(root=>root.parent===null),complete:api.disposalStatus().complete};});check('quiescence retains roots and complete disposal preserves shared renderer',report.producerShutdown.stopped.resourcesRetained&&report.producerShutdown.retained&&report.producerShutdown.refused&&report.producerShutdown.removed&&report.producerShutdown.complete,report.producerShutdown);}
 check('no runtime errors',report.errors.length===0&&!(report.consoleErrors?.length),{errors:report.errors,console:report.consoleErrors});report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};process.exitCode=1;if(page)try{await page.screenshot({path:path.join(out,'failure.png')});}catch(e){report.retentionError=e.message;}}
finally{if(browser){await browser.close();report.browser.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure}));}
