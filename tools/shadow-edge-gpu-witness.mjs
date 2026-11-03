import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [origin,out,filterRevision]=process.argv.slice(2);assert(origin&&out);await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),origin,executable:process.env.KAMINOS_TEST_BROWSER,errors:[]};
const write=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await write();let context;
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/shadow-edge-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'/shadow-edge-fixture');
 if(filterRevision){const code=execFileSync('git',['show',filterRevision+':fire-shadow-filter.mjs'],{encoding:'utf8'});report.filterRevision=filterRevision;await page.route('**/fire-shadow-filter.mjs',r=>r.fulfill({contentType:'text/javascript',body:code}));}
 report.runtime=await (await page.request.get(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,process.cwd());report.phase='native-render';await write();
 report.signal=await page.evaluate(async()=>{
  const T=await import('/lib/three.webgpu.js'),{radialSoftVisibility}=await import('/fire-shadow-filter.mjs');
  const renderer=new T.WebGPURenderer({antialias:false});renderer.setSize(33,1);await renderer.init();
  if(!renderer.backend.isWebGPUBackend)throw Error('native WebGPU required');const device=renderer.backend.device,errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
  const {vec3,vec4,float,uv,uniform,step}=T.TSL;
  const edge=uniform(false,'bool'),softness=uniform(1),ray=vec3(uv().x.sub(.5).mul(.5),0,1).normalize(),delta=ray.mul(2).div(ray.z);
  const sampleDepth=d=>d.x.greaterThanEqual(0).select(float(20),float(1));
  const v=radialSoftVisibility({sampleDepth,delta,normal:vec3(0,0,1),distance:delta.length(),bias:float(.001),sourceRadius:float(0),softness,hardVisibility:step(delta.length().sub(.001),sampleDepth(ray)),complementary:uniform(false,'bool'),blockerSamples:2,filterSamples:2,edgeFilter:edge,resolution:8});
  const material=new T.NodeMaterial();material.fragmentNode=vec4(vec3(v),1);material.toneMapped=false;
  const scene=new T.Scene(),geometry=new T.PlaneGeometry(2,2),mesh=new T.Mesh(geometry,material);scene.add(mesh);const camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;
  const target=new T.RenderTarget(33,1,{type:T.HalfFloatType});renderer.setRenderTarget(target);
  const read=async()=>{await renderer.renderAsync(scene,camera);const a=await renderer.readRenderTargetPixelsAsync(target,0,0,33,1);return Array.from({length:33},(_,i)=>T.DataUtils.fromHalfFloat(a[i*4]));};
  const nearest=await read();edge.value=true;const pcss=await read();softness.value=0;const hard=await read();
  const validation=(await device.popErrorScope())?.message??null,raw=renderer.backend.adapter?.info??device.adapterInfo,info={vendor:raw?.vendor,architecture:raw?.architecture,description:raw?.description};if(!info.vendor||/swiftshader/i.test(JSON.stringify(info)))throw Error('native adapter identity missing or fallback');target.dispose();geometry.dispose();material.dispose();renderer.dispose();return {nearest,pcss,hard,validation,errors,info};
 });assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.errors,[]);
 for(const key of ['pcss','hard']){const v=report.signal[key];assert(Math.abs(v[16]-.5)<.01,`${key} edge midpoint`);assert(v[15]<.5&&v[17]>.5,`${key} both sides interpolate`);assert(Math.abs(v[17]-v[15])<.13,`${key} no binary jump`);assert(v.every(x=>Number.isFinite(x)&&x>=0&&x<=1));}
 assert.equal(report.signal.nearest[15],0);assert.equal(report.signal.nearest[17],1);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure}));}
