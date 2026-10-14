import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [out,origin]=process.argv.slice(2);
if(!out||!origin)throw Error('explicit output and origin required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source',repoRoot:process.cwd(),origin,errors:[],claim:'native radial soft-shadow prototype, not a whole-frame performance result'};
const write=()=>fs.writeFile(out+'/shadow.json',JSON.stringify(report,null,2));await write();let browser;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.files={};for(const file of ['fire-light-field-shadow.mjs','fire-shadow-filter.mjs']){
  const response=await fetch(origin+'/'+file);assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer()),local=await fs.readFile(file);assert.deepEqual(bytes,local,'wrong serving source');report.files[file]=createHash('sha256').update(bytes).digest('hex');
 }
 report.phase='browser';await write();
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE||'playwright');
 report.browser='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await chromium.launch({executablePath:report.browser,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage({viewport:{width:600,height:600},deviceScaleFactor:1});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
 await page.goto(origin+'/fire-shadow-filter.mjs');report.phase='gpu';await write();
 report.setup=await page.evaluate(async()=>{
  const T=await import('/lib/three.webgpu.js'),{createFireLightFieldShadow}=await import('/fire-light-field-shadow.mjs');
  document.body.replaceChildren();document.body.style.margin='0';
  const renderer=new T.WebGPURenderer();await renderer.init();renderer.setSize(600,600);document.body.append(renderer.domElement);
  if(!renderer.backend.isWebGPUBackend)throw Error('native WebGPU required');
  renderer.backend.device.addEventListener('uncapturederror',e=>console.error(e.error.message));
  const scene=new T.Scene(),caster=new T.Mesh(new T.BoxGeometry(.8,1.4,.1),new T.MeshBasicMaterial());caster.position.z=2;caster.castShadow=true;scene.add(caster);
  const probe=new T.Scene(),material=new T.NodeMaterial(),plane=new T.Mesh(new T.PlaneGeometry(4,4),material);
  const pass=createFireLightFieldShadow({renderer,scene,sourceNode:T.TSL.vec3(0),receiverNode:T.TSL.positionWorld,normalNode:T.TSL.normalWorld,sourceSizeNode:T.TSL.float(.4),shadowSoftness:1,requested:true,resolution:256});
  material.fragmentNode=T.TSL.vec4(T.TSL.vec3(pass.visibility),1);material.toneMapped=false;probe.add(plane);
  const camera=new T.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=10;camera.lookAt(0,0,0);
  const target=new T.RenderTarget(256,256,{format:T.RGBAFormat,type:T.FloatType,depthBuffer:false});pass.render();
  window.softShadowFixture={renderer,scene,caster,probe,plane,material,pass,camera,target};
  return {backend:renderer.backend.constructor.name,adapter:renderer.backend.device.adapterInfo,shadow:pass.debugState()};
 });
 report.rows=[];
 for(const [name,z,softness] of [['near-hard',2.3,0],['near-soft',2.3,1],['far-hard',4.5,0],['far-soft',4.5,1],['far-restored',4.5,0]]){
  assert.ok(z<report.setup.shadow.far,'fixture receiver must lie inside the rendered cube range');
  const row=await page.evaluate(async({name,z,softness})=>{
   const f=window.softShadowFixture;f.plane.position.z=z;f.pass.setSoftness(softness);
   f.renderer.setRenderTarget(f.target);f.renderer.render(f.probe,f.camera);
   const pixels=await f.renderer.readRenderTargetPixelsAsync(f.target,0,0,256,256);
   if(!(pixels instanceof Float32Array)||pixels.length!==256*256*4||!pixels.every(Number.isFinite))throw Error('invalid native readback');
   f.renderer.setRenderTarget(null);f.renderer.render(f.probe,f.camera);
   const centerRow=Array.from({length:256},(_,i)=>pixels[(128*256+i)*4]);
   return {name,z,softness,centerRow,partial:centerRow.filter(v=>v>0&&v<1).length,min:Math.min(...centerRow),max:Math.max(...centerRow),shadow:f.pass.debugState()};
  },{name,z,softness});report.rows.push(row);await write();await page.screenshot({path:out+'/'+name+'.png'});
 }
 const rows=Object.fromEntries(report.rows.map(r=>[r.name,r]));
 assert.equal(rows['near-hard'].partial,0);assert.equal(rows['far-hard'].partial,0);
 assert.ok(rows['near-soft'].partial>0,'soft near edge must have partial coverage');
 assert.ok(rows['far-soft'].partial>rows['near-soft'].partial*2,'larger blocker-to-receiver gap must widen penumbra');
 for(const row of report.rows){assert.equal(row.min,0,'preserve opaque umbra');assert.equal(row.max,1,'preserve clear receiver');assert.equal(row.shadow.renderCount,1,'filter must reuse the rendered cube');}
 assert.deepEqual(rows['far-hard'].centerRow,rows['far-restored'].centerRow,'zero softness restores exact hard output');
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure={phase:report.phase,message:e.message,stack:e.stack};process.exitCode=1;
 if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
}finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,failure:report.failure,rows:report.rows?.map(({name,partial})=>({name,partial}))}));}
