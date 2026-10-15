import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
const [out,origin]=process.argv.slice(2);
if(!out||!origin)throw Error('explicit evidence directory and serving origin required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source',origin,errors:[]};
const write=()=>fs.writeFile(out+'/shadow.json',JSON.stringify(report,null,2));await write();let browser;
try{
 const response=await fetch(origin+'/fire-light-field-shadow.mjs');assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());report.moduleSha256=createHash('sha256').update(bytes).digest('hex');
 report.browser='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 report.phase='browser';await write();browser=await chromium.launch({executablePath:report.browser,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
 await page.goto(origin+'/fire-light-field-shadow.mjs');report.phase='gpu';await write();
 report.result=await page.evaluate(async()=>{
  const T=await import('/lib/three.webgpu.js');
  const {createFireLightFieldShadow}=await import('/fire-light-field-shadow.mjs');
  const renderer=new T.WebGPURenderer();await renderer.init();renderer.setSize(64,64);
  if(!renderer.backend.isWebGPUBackend)throw Error('native WebGPU required');
  const scene=new T.Scene(),caster=new T.Mesh(new T.BoxGeometry(.8,1,1.2),new T.MeshBasicMaterial());
  caster.position.set(2,0,0);caster.castShadow=true;scene.add(caster);
  const receiver=T.TSL.uniform(new T.Vector3(4,0,0)),normal=T.TSL.uniform(new T.Vector3(-1,0,0));
  const pass=createFireLightFieldShadow({renderer,scene,sourceNode:T.TSL.vec3(0),receiverNode:receiver,normalNode:normal,requested:true,resolution:64});
  const probeScene=new T.Scene();probeScene.environment=new T.CubeTexture();
  const material=new T.NodeMaterial();material.envMap=null;material.toneMapped=false;
  material.fragmentNode=T.TSL.vec4(pass.visibility,0,0,1);
  const plane=new T.Mesh(new T.PlaneGeometry(2,2),material);probeScene.add(plane);
  const camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;
  const target=new T.RenderTarget(4,4,{format:T.RGBAFormat,type:T.FloatType,depthBuffer:false});
  const rows=[];
  try{
   for(const rotation of [0,Math.PI,3.19931436567164]){
    probeScene.environmentRotation.y=rotation;pass.render();
    for(const [name,position,expected] of [['blocked',[4,0,0],0],['clear',[-4,0,0],1],['clear-z',[0,0,4],1],['blocked-oblique',[4,.2,.3],0]]){
     receiver.value.set(...position);normal.value.copy(receiver.value).negate().normalize();
     renderer.setRenderTarget(target);renderer.render(probeScene,camera);
     const pixels=await renderer.readRenderTargetPixelsAsync(target,1,1,1,1);
     if(!(pixels instanceof Float32Array)||pixels.length!==4||!pixels.every(Number.isFinite))throw Error('invalid native probe');
     rows.push({rotation,name,position,expected,visibility:pixels[0]});
    }
   }
   const device=renderer.backend.device;
   return {backend:renderer.backend.constructor.name,adapter:device.adapterInfo,coordinateSystem:renderer.coordinateSystem,shadow:pass.debugState(),rows};
  }finally{pass.dispose();target.dispose();plane.geometry.dispose();material.dispose();caster.geometry.dispose();caster.material.dispose();probeScene.environment.dispose();renderer.dispose();}
 });
 await write();assert.deepEqual(report.errors,[]);
 for(const row of report.result.rows)assert.ok(Math.abs(row.visibility-row.expected)<1e-5,`${row.name} at environment rotation ${row.rotation}: expected ${row.expected}, got ${row.visibility}`);
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure={phase:report.phase,message:e.message,stack:e.stack};process.exitCode=1;}
finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,failure:report.failure?.message,rows:report.result?.rows}));}
