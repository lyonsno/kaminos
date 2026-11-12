// Saved-asset inspection; this adapter owns no training, scheduler or GPU device.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createParallaxPoses,captureParallaxMatrix,transformParallaxFrame,createLocalParallaxPoses,renderParallaxGallery} from '../webgpu-inference-kit/src/parallax-matrix.js';
const [inputPath]=process.argv.slice(2);
if(!inputPath)throw Error('Usage: node tools/trellis-parallax-matrix.mjs MANIFEST.json');
const config=JSON.parse(await fs.readFile(inputPath,'utf8')),out=path.resolve(config.output);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',config,inputPath,classification:'lightweight saved-checkpoint observation; no performance comparison',errors:[],consoleErrors:[]};
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await persist();let context;
try{
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE??'playwright-core');
 report.profile=await fs.mkdtemp(path.join(os.tmpdir(),'kaminos-parallax-'));
 context=await chromium.launchPersistentContext(report.profile,{executablePath:config.executable,headless:true,viewport:config.viewport??{width:1400,height:1000},deviceScaleFactor:1,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 report.phase='load';await persist();await page.goto(config.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='trellis-support');
 const invoke=(op,arg)=>page.evaluate(({op,arg})=>window.kaminosWorkbenchExperiments.invoke(op,arg),{op,arg});
 const state=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 report.runtime=await page.evaluate(()=>fetch('/api/runtime-config').then(r=>r.json()));assert.equal(report.runtime.source.repoRoot,path.resolve(config.repoRoot));
 report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());assert.equal(report.renderer.rendererBackend,'webgpu');
 report.initial=await state();assert.equal(report.initial.comparison.learnedAvailable,true);assert.equal(report.initial.comparison.checkpoint.id,config.checkpoint);assert.equal(report.initial.comparison.checkpoint.sha256,config.checkpointSha256);
 const candidate=await invoke('inspectCandidate');
 const elements=candidate.transforms.sourceWorld;
 const region=report.initial.region,center=report.initial.comparison.worldCenter;
 const frame=transformParallaxFrame({center:region.origin,normal:region.normal,tangent:region.tangent},elements);
 const setup={...frame,center,distances:config.distanceFactors?.map(f=>f*report.initial.comparison.tileSize)??[config.distance??report.initial.comparison.tileSize*2.5],elevations:config.elevations,azimuths:config.azimuths};
 report.setup=setup;report.sourceTransform=elements;
 const overview=config.overview===false?[]:createParallaxPoses(setup).map(p=>({...p,group:'overview'}));
 const localOptions=config.local===false?null:{anchors:[{id:'side-a',label:'Side A',azimuth:90,elevation:20},{id:'side-b',label:'Side B',azimuth:270,elevation:20}],yawOffsets:[-10,0,10],pitchOffsets:[-10,0,10],...config.local};
 const local=localOptions?createLocalParallaxPoses({...setup,...localOptions,distances:localOptions.distances??[setup.distances[Math.floor(setup.distances.length/2)]]}):[];
 report.poses=[...overview,...local];report.localOptions=localOptions;
 const read=async()=>{const s=await state();return {view:s.comparison.view,variant:s.comparison.requested,effective:s.comparison.effective,lighting:s.sceneLights,identity:{checkpoint:s.comparison.checkpoint,source:s.comparison.sourceIdentity,context:s.comparison.contextIdentity,backend:report.renderer.rendererBackend},comparison:s.comparison};};
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const rect=await page.evaluate(()=>{const r=[...document.querySelectorAll('canvas')].map(c=>c.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:r.x,y:r.y,width:r.width,height:r.height};});
 report.phase='matrix';await persist();
 await captureParallaxMatrix({poses:report.poses,variants:['source','learned'],adapter:{
  read,async setView(view){await invoke('setView',view);await settle();},async setVariant(value){await invoke('setComparison',value);await settle();},
  async capture({pose,variant}){const file=`${pose.id}-${variant}.png`,bytes=await page.screenshot({path:path.join(out,file),clip:rect});return {file,width:Math.round(rect.width),height:Math.round(rect.height),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};},
  async persist(matrix){report.matrix=matrix;await persist();},
 }});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
 await fs.writeFile(path.join(out,'index.html'),renderParallaxGallery({title:config.checkpoint+' · directional material study',captures:report.matrix.captures}));
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await context?.close();}catch(error){report.cleanupError=String(error.stack??error);report.status='failed';process.exitCode=1;}finally{await persist();}console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));}
