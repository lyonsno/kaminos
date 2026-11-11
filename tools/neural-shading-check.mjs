// Native production material/cache conformance, using the installed author checkpoint.
// No performance measurement. Caller owns all output, browser and server lifetimes.
import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
const [out]=process.argv.slice(2);assert(out,'Output directory required');
const root=process.cwd(),report={root,phase:'source-identity',status:'running',errors:[]};
await fs.mkdir(out,{recursive:true});const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
let context,server,log,spawnError;
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.phase='launch';await save();
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='http://127.0.0.1:'+port;report.origin=origin;
 log=await fs.open(out+'/server.log','a');
 server=spawn('python3',['-u','serve.py',String(port)],{cwd:root,env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:out+'/scenes'},stdio:['ignore',log.fd,log.fd]});server.on('error',e=>spawnError=e);await log.close();log=null;
 const {setTimeout:pause}=await import('node:timers/promises');
 for(;;){if(spawnError)throw spawnError;try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}if(server.exitCode!==null)throw Error('Server failed');await pause(100);}
 assert.equal(report.runtime.source.repoRoot,root);
 report.browser=process.env.KAMINOS_TEST_BROWSER;assert(report.browser&&!report.browser.includes('/Google Chrome.app/'),'Independent browser required');
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.browser,headless:true,viewport:{width:1080,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='native';await save();await page.goto(origin+'/tests/neural-shading-render-native.html');
 await page.waitForFunction(()=>window.neumipRenderLoaded||window.neumipRenderFailure);assert.equal(await page.evaluate(()=>window.neumipRenderFailure),undefined);
 report.identity=await page.evaluate(()=>window.neumipRenderAssay.identity);assert.equal(report.identity.backend,'WebGPU');
 assert.match(JSON.stringify(report.identity.adapter),/apple/i,'Apple hardware identity required for this native check');
 report.samples=[];
 for(const count of [1,8])for(const [scale,reuse] of [[1,false],[1,true],[.75,true],[.5,true],[.25,true]]){
  const r=await page.evaluate(([count,scale,reuse])=>window.neumipRenderAssay.render(count,scale,reuse),[count,scale,reuse]);
  const key=`${count}-${scale}-${reuse}`;await fs.writeFile(out+'/shader-'+key+'.wgsl',r.shader.fragmentShader);delete r.shader;
  await fs.writeFile(out+'/native-'+key+'.json',JSON.stringify(r));report.samples.push({count,scale,reuse,samples:r.samples,cache:r.cache});await save();
  if(scale===1)for(const sample of r.samples)for(let c=0;c<3;c++)assert.ok(Math.abs(sample.actual[c]-sample.expected[c])<.0001+Math.abs(sample.expected[c])*.002,'full-rate native radiance must match the independent author reference');
  if(scale<1){
   assert.ok(r.events.indexOf('capture:end')<r.events.indexOf('source:draw'),'capture finishes before the source scene draw starts');
   assert.ok(r.events.indexOf('source:end')<r.events.indexOf('beauty:draw'),'source finishes before the beauty scene draw starts');
   for(const sample of r.samples)for(let c=0;c<3;c++)assert.ok(Math.abs(sample.actual[c]-sample.reducedExpected[c])<.0001+Math.abs(sample.reducedExpected[c])*.003,'reduced-rate native radiance matches independent coarse author reconstruction');
  }
  assert.equal(r.cache.requestedScale,scale);if(scale<1)assert.deepEqual(r.cache.resolution,[Math.floor(64*scale),Math.floor(64*scale)]);
  assert.ok(r.raw.every(Number.isFinite),'no nonfinite rendered pixels');
 }
 for(const rejection of ['none','normal','material']){
  const variant={sentinel:true,rejectNormal:rejection==='normal',rejectMaterial:rejection==='material',near:.01,far:107,distance:8};
  const r=await page.evaluate(variant=>window.neumipRenderAssay.render(1,1,true,variant),variant);
  await fs.writeFile(out+'/far-sentinel-'+rejection+'.json',JSON.stringify(r));report.samples.push({variant,samples:r.samples});await save();
  for(const sample of r.samples){const expected=rejection==='none'?[.25,.5,.75]:sample.expected;for(let c=0;c<3;c++)assert.ok(Math.abs(sample.actual[c]-expected[c])<.0001+Math.abs(expected[c])*.002,'the source sentinel must be reused at workshop near/far distances, and incompatible normals/materials must fall back');}
 }
 const prepared=await page.evaluate(()=>window.neumipRenderAssay.render(1,.5,true,{precompile:true}));
 await fs.writeFile(out+'/precompiled-native.json',JSON.stringify(prepared));
 assert.deepEqual(prepared.pipelineBuilds.filter(x=>x.target!=='other'),[],'prepared unchanged capture/source/beauty must draw without compiling more native world pipelines');
 assert.equal(prepared.nesting.capture,prepared.nesting.source,'capture preparation uses the same effective render nesting as source');
 for(const sample of prepared.samples)for(let c=0;c<3;c++)assert.ok(Math.abs(sample.actual[c]-sample.reducedExpected[c])<.0001+Math.abs(sample.reducedExpected[c])*.003,'precompiled production passes preserve reconstruction');
 assert.deepEqual(report.errors,[]);
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{try{await context?.close();}catch(error){report.cleanupError=error.stack;report.status='failed';process.exitCode=1;}server?.kill('SIGTERM');try{await log?.close();}catch(error){report.logCleanupError=error.stack;report.status='failed';process.exitCode=1;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
