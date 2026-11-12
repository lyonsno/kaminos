// Saved-asset inspection; this adapter owns no training, scheduler or GPU device.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createParallaxPoses,captureParallaxMatrix,transformParallaxFrame} from '../webgpu-inference-kit/src/parallax-matrix.js';
const [inputPath]=process.argv.slice(2);
if(!inputPath)throw Error('Usage: node tools/trellis-parallax-matrix.mjs MANIFEST.json');
const config=JSON.parse(await fs.readFile(inputPath,'utf8')),out=path.resolve(config.output);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',config,inputPath,classification:'lightweight saved-checkpoint observation; no performance comparison',errors:[],consoleErrors:[]};
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await persist();let context;
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
 report.setup=setup;report.sourceTransform=elements;report.poses=createParallaxPoses(setup);
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
 const distances=[...new Set(report.poses.map(p=>p.distance))];
 const sections=distances.map((distance,di)=>`<div data-distance="${di}" ${di===Math.floor(distances.length/2)?'':'hidden'}>${[...new Set(report.poses.map(p=>p.elevation))].map(elevation=>`<h2>Elevation ${elevation}°</h2><div class="grid">${report.poses.filter(p=>p.distance===distance&&p.elevation===elevation).map(p=>`<section><h3>Azimuth ${p.azimuth}°</h3><div class="pair">${report.matrix.captures.filter(c=>c.pose.id===p.id).map(c=>`<figure class="${html(c.variant)}"><a href="${html(c.artifact.file)}"><img src="${html(c.artifact.file)}" loading="lazy"></a><figcaption>${html(c.variant)}</figcaption></figure>`).join('')}</div></section>`).join('')}</div>`).join('')}</div>`).join('');
 await fs.writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>TRELLIS parallax matrix</title><style>body{background:#16181b;color:#eee;font:15px system-ui;margin:20px}h1{font-size:24px}h2{font-size:18px}h3{font-size:14px;margin:6px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.pair{display:flex;gap:3px}figure{margin:0;flex:1;min-width:0}img{width:100%;display:block}section{background:#24272c;padding:4px}a{color:#9df}code{overflow-wrap:anywhere}button{padding:8px 14px;margin:4px;background:#343943;color:white;border:1px solid #738299;cursor:pointer}button[aria-pressed=true]{background:#155378}body[data-mode=source] .learned,body[data-mode=learned] .source{display:none}@media(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><h1>${html(config.checkpoint)}: parallax matrix</h1><p>Fixed lights · ${report.poses.length} camera poses · source and learned at the same pose · learned MIP 0. Elevation is above the material chart; azimuth runs around its normal. Click an image for its full capture.</p><nav>Magnification: ${distances.map((d,i)=>`<button data-pick="${i}" aria-pressed="${i===Math.floor(distances.length/2)}">${(report.initial.comparison.tileSize/d).toFixed(2)}× footprint · distance ${d.toFixed(3)}</button>`).join('')}</nav><nav>Show: ${['paired','source','learned'].map(mode=>`<button data-mode="${mode}" aria-pressed="${mode==='paired'}">${mode}</button>`).join('')}</nav><p>Checkpoint <code>${html(config.checkpointSha256)}</code> · <a href="report.json">full report</a></p>${sections}<script>document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-distance]').forEach(s=>s.hidden=s.dataset.distance!==b.dataset.pick);document.querySelectorAll('[data-pick]').forEach(x=>x.setAttribute('aria-pressed',x===b))});document.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>{document.body.dataset.mode=b.dataset.mode;document.querySelectorAll('button[data-mode]').forEach(x=>x.setAttribute('aria-pressed',x===b))});</script>`);
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await context?.close();}catch(error){report.cleanupError=String(error.stack??error);report.status='failed';process.exitCode=1;}finally{await persist();}console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));}
