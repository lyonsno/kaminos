import fs from 'node:fs';
import assert from 'node:assert/strict';
const [base,out,browserPath,playwrightPath,...flags]=process.argv.slice(2);
if(!base||!out||!browserPath||!playwrightPath)throw Error('Usage: node tools/deferred-splat-fixture.mjs BASE OUT BROWSER PLAYWRIGHT [--negative-route]');
fs.mkdirSync(out,{recursive:true});const report={ok:false,phase:'launch',base,browserPath,errors:[],cases:[]};let browser,page;
try{
 const {chromium}=await import(playwrightPath);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--use-mock-keychain','--password-store=basic']});page=await browser.newPage({viewport:{width:256,height:256}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/surface-splat-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style>'}));
 await page.goto(new URL('/surface-splat-fixture',base).href);report.phase='native-render';report.runtime=await (await page.request.get(new URL('/api/runtime-config',base).href)).json();
 report.result=await page.evaluate(async()=>{
  const T=await import('/lib/three.webgpu.js'),{createDeferredSurfaceSplats}=await import('/deferred-surface-splats.mjs');
  const renderer=new T.WebGPURenderer({antialias:false});renderer.setSize(256,256);await renderer.init();document.body.append(renderer.domElement);
  const backend=renderer.backend.isWebGPUBackend===true?'webgpu':'fallback',adapter=renderer.backend.device?.adapterInfo;
  const scene=new T.Scene();scene.background=new T.Color(.01,.01,.01);const camera=new T.PerspectiveCamera(40,1,.1,10);camera.position.set(0,0,2);camera.lookAt(0,0,0);
  const light=new T.PointLight(0xffffff,8);light.position.set(.3,.2,1);scene.add(light);
  const rows=[],foot=[];for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){rows.push(x*.1,y*.1,0,0,0,1,.8,.3,.1,0,.5,1);foot.push(1,0,0,.06,0,1,0,.06);}
  let splat=createDeferredSurfaceSplats(new Float32Array(rows),{count:81,stride:12,radius:.03},new Float32Array(foot));scene.add(splat.root);splat.set({mode:'opaque'});
  const target=new T.RenderTarget(256,256);renderer.setRenderTarget(target);
  const sample=async()=>{renderer.render(scene,camera);return Array.from(await renderer.readRenderTargetPixelsAsync(target,128,128,1,1));};
  const bright=await sample(),surface=await splat.inspectSurface(128,128);light.intensity=0;const dark=await sample();light.intensity=8;
  const occluder=new T.Mesh(new T.PlaneGeometry(.3,.3),new T.MeshBasicNodeMaterial({color:0x00ff00}));occluder.position.z=.2;scene.add(occluder);const front=await sample();occluder.position.z=-.2;const behind=await sample();scene.remove(occluder);
  renderer.setRenderTarget(null);renderer.render(scene,camera);const image=renderer.domElement.toDataURL();
  const read=splat.read();scene.remove(splat.root);splat.dispose();
  for(let i=11;i<rows.length;i+=12)rows[i]=.2;
  const glassState=[];light.intensity=0;
  for(const copies of [1,2]){
   const data=new Float32Array(Array.from({length:copies},()=>rows).flat()),f=new Float32Array(Array.from({length:copies},()=>foot).flat());
   splat=createDeferredSurfaceSplats(data,{count:81*copies,stride:12,radius:.03},f);scene.add(splat.root);splat.set({mode:'glass'});scene.add(occluder);renderer.setRenderTarget(target);
   const pixel=await sample(),s=await splat.inspectSurface(128,128);glassState.push({copies,pixel,surface:s});scene.remove(splat.root);splat.dispose();
  }
  target.dispose();renderer.dispose();return {backend,adapter,bright,dark,front,behind,surface,glassState,read,image};
 });
 fs.writeFileSync(out+'/opaque.png',Buffer.from(report.result.image.split(',')[1],'base64'));delete report.result.image;
 assert.equal(report.result.backend,flags.includes('--negative-route')?'fallback':'webgpu');
 const {bright,dark,front,behind,surface,read,image}=report.result;
 assert.ok(bright[0]>dark[0]+10,'physical light must illuminate reconstructed surface');assert.ok(front[1]>front[0]+50,'near mesh must occlude splats');assert.ok(behind[0]>behind[1],'far mesh must be occluded by surface depth');
 assert.ok(surface[0].nearest[3]>1.9&&surface[0].nearest[3]<2.1,'nearest plane must be at source depth');assert.ok(read.updates>0&&read.width===256);
 for(const g of report.result.glassState){const c=g.surface[0].sums[0],m=g.surface[0].sums[2];assert.ok(Math.abs(m[0]/c[3]-.2)<.002,'overlap must not turn material opacity into coverage alpha');assert.ok(g.pixel[1]>g.pixel[0],'glass must transmit the green opaque backdrop');}
 for(let k=0;k<3;k++)assert.ok(Math.abs(report.result.glassState[0].pixel[k]-report.result.glassState[1].pixel[k])<=2,'duplicating the same surface must preserve resolved color and opacity');
 assert.equal(report.errors.length,0);report.phase='done';report.ok=true;
}catch(e){report.error=String(e);try{await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await browser?.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,errors:report.errors}));if(!report.ok)process.exitCode=1;
